// MCP Server Manager — discover, install, and manage MCP servers via the official registry

import { loadConfig, saveConfig } from '../../config/index.js';
import type { DaedalusConfig } from '../../config/index.js';
import pc from 'picocolors';

const REGISTRY_BASE = 'https://registry.modelcontextprotocol.io';
const REGISTRY_TIMEOUT = 10_000;

// ── Types ──────────────────────────────────────────────────────

export interface RegistryServerEntry {
  name: string;
  title?: string;
  description: string;
  version: string;
  repository?: { url?: string; source?: string };
  websiteUrl?: string;
  remotes?: Array<{
    type: string;
    url: string;
    headers?: Array<{
      name: string;
      description?: string;
      isRequired?: boolean;
      isSecret?: boolean;
      placeholder?: string;
    }>;
  }>;
  packages?: Array<{
    registryType: string;
    identifier: string;
    version?: string;
    transport?: { type: string };
    environmentVariables?: Array<{
      name: string;
      description?: string;
      isRequired?: boolean;
      isSecret?: boolean;
    }>;
  }>;
}

interface RegistryResponse {
  servers: Array<{
    server: RegistryServerEntry;
    _meta: Record<string, any>;
  }>;
  metadata: {
    count: number;
    nextCursor?: string;
  };
}

// ── Registry API ────────────────────────────────────────────────

function registryFetch(path: string): Promise<Response> {
  const url = `${REGISTRY_BASE}${path}`;
  return fetch(url, { signal: AbortSignal.timeout(REGISTRY_TIMEOUT) });
}

/** Collect up to `limit` latest-is-true servers from the registry */
export async function fetchAllServers(limit = 100): Promise<RegistryServerEntry[]> {
  const seen = new Map<string, RegistryServerEntry>();
  let cursor: string | undefined;
  const perPage = Math.min(limit, 100);

  while (seen.size < limit) {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const resp = await registryFetch(`/v0.1/servers?limit=${perPage}${cursorParam}`);
    if (!resp.ok) throw new Error(`Registry API error: ${resp.status}`);

    const data = (await resp.json()) as RegistryResponse;
    for (const entry of data.servers) {
      const s = entry.server;

      // Only keep the latest-is-true version of each server
      const meta = entry._meta?.['io.modelcontextprotocol.registry/official'];
      if (meta?.isLatest && !seen.has(s.name)) {
        seen.set(s.name, s);
      }
    }

    if (!data.metadata.nextCursor) break;
    cursor = data.metadata.nextCursor;
  }

  return Array.from(seen.values());
}

/** Search the registry by keyword (matches name, title, description) */
export async function searchRegistry(query: string, limit = 20): Promise<RegistryServerEntry[]> {
  const all = await fetchAllServers(limit * 3); // fetch more for filtering
  const q = query.toLowerCase();

  const scored = all
    .filter(s => {
      const name = s.name.toLowerCase();
      const title = (s.title || '').toLowerCase();
      const desc = s.description.toLowerCase();
      return name.includes(q) || title.includes(q) || desc.includes(q);
    })
    .map(s => {
      let score = 0;
      const name = s.name.toLowerCase();
      const title = (s.title || '').toLowerCase();
      if (name === q) score += 100;
      else if (name.includes(q)) score += 50;
      if (title === q) score += 80;
      else if (title.includes(q)) score += 30;
      if (s.description.toLowerCase().includes(q)) score += 10;
      return { server: s, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(s => s.server);
}

/** Get the latest version of a specific server by name */
export async function fetchServerByName(name: string): Promise<RegistryServerEntry | null> {
  const encoded = encodeURIComponent(name);
  const resp = await registryFetch(`/v0.1/servers/${encoded}/versions/latest`);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Registry API error: ${resp.status}`);
  const data = (await resp.json()) as { server: RegistryServerEntry };
  return data.server;
}

// ── Config helpers ──────────────────────────────────────────────

export interface MCPServerInstallConfig {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

/** Build a Daedalus MCP server config from a registry entry */
export function registryEntryToConfig(entry: RegistryServerEntry): MCPServerInstallConfig | null {
  const shortName = entry.name.includes('/') ? entry.name.split('/').pop()! : entry.name;

  // Prefer packages (local install) over remotes (remote URL)
  if (entry.packages && entry.packages.length > 0) {
    const pkg = entry.packages[0];
    const [command, ...args] = packageToCommand(pkg);
    if (!command) return null;
    return {
      name: shortName,
      transport: 'stdio',
      command,
      args,
      enabled: true,
    };
  }

  // Fall back to remote endpoint
  if (entry.remotes && entry.remotes.length > 0) {
    const remote = entry.remotes[0];
    const headers: Record<string, string> = {};
    if (remote.headers) {
      for (const h of remote.headers) {
        if (h.isRequired && !h.isSecret) {
          headers[h.name] = '';
        }
      }
    }
    return {
      name: shortName,
      transport: 'http',
      url: remote.url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      enabled: true,
    };
  }

  return null;
}

function packageToCommand(pkg: { registryType: string; identifier: string }): string[] {
  switch (pkg.registryType) {
    case 'npm':
      return ['npx', '-y', pkg.identifier];
    case 'pypi':
      return ['uvx', pkg.identifier];
    case 'go':
      return ['go', 'run', pkg.identifier];
    default:
      return [];
  }
}

// ── Config file operations ──────────────────────────────────────

/** Add an MCP server config to the Daedalus config file */
export function addServerToConfig(config: MCPServerInstallConfig): { success: boolean; message: string } {
  const cfg = loadConfig();
  const servers = cfg.tools.mcpServers as Record<string, any>;

  if (servers[config.name]) {
    return { success: false, message: `Server "${config.name}" is already installed. Use /mcp remove first or edit config.json directly.` };
  }

  const entry: Record<string, any> = {
    transport: config.transport,
    enabled: config.enabled,
  };

  if (config.transport === 'stdio') {
    entry.command = config.command;
    entry.args = config.args;
  } else {
    entry.url = config.url;
    if (config.headers) entry.headers = config.headers;
  }

  servers[config.name] = entry;
  saveConfig(cfg);
  return { success: true, message: `Installed MCP server: ${config.name}` };
}

/** Remove an MCP server from the config */
export function removeServerFromConfig(name: string): { success: boolean; message: string } {
  const cfg = loadConfig();
  const servers = cfg.tools.mcpServers as Record<string, any>;

  if (!servers[name]) {
    return { success: false, message: `Server "${name}" is not installed.` };
  }

  delete servers[name];
  saveConfig(cfg);
  return { success: true, message: `Removed MCP server: ${name}` };
}

/** List installed MCP servers */
export function listInstalledServers(): Array<{ name: string; transport: string; enabled: boolean }> {
  const cfg = loadConfig();
  const servers = cfg.tools.mcpServers as Record<string, any>;
  return Object.entries(servers).map(([name, s]) => ({
    name,
    transport: s.transport || 'unknown',
    enabled: s.enabled !== false,
  }));
}

/** Toggle an MCP server on/off */
export function toggleServer(name: string, enabled: boolean): { success: boolean; message: string } {
  const cfg = loadConfig();
  const servers = cfg.tools.mcpServers as Record<string, any>;

  if (!servers[name]) {
    return { success: false, message: `Server "${name}" is not installed.` };
  }

  servers[name].enabled = enabled;
  saveConfig(cfg);
  return { success: true, message: `${enabled ? 'Enabled' : 'Disabled'} MCP server: ${name}` };
}
