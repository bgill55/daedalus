// MCP Server Manager — discover, install, and manage MCP servers via the official registry and Smithery

import { loadConfig, saveConfig } from '../../config/index.js';

const REGISTRY_BASE = 'https://registry.modelcontextprotocol.io';
const SMITHERY_BASE = 'https://api.smithery.ai';
const REQUEST_TIMEOUT = 10_000;

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
  _smithery?: boolean;
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

// ── Smithery types ───────────────────────────────────────────────

interface SmitheryServerEntry {
  id: string;
  qualifiedName: string;
  namespace: string;
  displayName: string;
  description: string;
  verified: boolean;
  useCount: number;
  remote: boolean;
  isDeployed: boolean;
  homepage: string;
}

interface SmitheryListResponse {
  servers: SmitheryServerEntry[];
  pagination: {
    currentPage: number;
    pageSize: number;
    totalPages: number;
    totalCount: number;
  };
}

// ── Registry API ────────────────────────────────────────────────

function registryFetch(path: string): Promise<Response> {
  const url = `${REGISTRY_BASE}${path}`;
  return fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
}

// ── Smithery API ────────────────────────────────────────────────

function smitheryFetch(path: string): Promise<Response> {
  const url = `${SMITHERY_BASE}${path}`;
  return fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
}

function smitheryToRegistryEntry(s: SmitheryServerEntry): RegistryServerEntry {
  return {
    name: s.qualifiedName,
    title: s.displayName || s.qualifiedName,
    description: s.description,
    version: 'latest',
    websiteUrl: s.homepage,
    remotes: [{
      type: 'smithery',
      url: s.homepage,
    }],
    _smithery: true,
  };
}

/** Search Smithery registry by keyword */
async function searchSmithery(query: string, limit = 20): Promise<RegistryServerEntry[]> {
  const url = `/servers?q=${encodeURIComponent(query)}&pageSize=${Math.min(limit, 100)}&fields=id,qualifiedName,displayName,description,verified,useCount,remote,isDeployed,homepage`;
  const resp = await smitheryFetch(url);
  if (!resp.ok) return [];
  const data = (await resp.json()) as SmitheryListResponse;
  return data.servers.slice(0, limit).map(smitheryToRegistryEntry);
}

/** Fetch all Smithery servers across pages */
async function fetchAllSmitheryServers(limit = 100): Promise<RegistryServerEntry[]> {
  const seen = new Map<string, RegistryServerEntry>();
  let page = 1;
  const perPage = Math.min(limit, 100);

  while (seen.size < limit) {
    const resp = await smitheryFetch(`/servers?pageSize=${perPage}&page=${page}&fields=id,qualifiedName,displayName,description,verified,useCount,remote,isDeployed,homepage`);
    if (!resp.ok) break;
    const data = (await resp.json()) as SmitheryListResponse;
    for (const s of data.servers) {
      if (!seen.has(s.qualifiedName)) {
        seen.set(s.qualifiedName, smitheryToRegistryEntry(s));
      }
    }
    if (page >= data.pagination.totalPages) break;
    page++;
  }

  return Array.from(seen.values()).slice(0, limit);
}

/** Fetch a specific Smithery server by qualified name */
async function fetchSmitheryServerByName(name: string): Promise<RegistryServerEntry | null> {
  const resp = await smitheryFetch(`/servers/${encodeURIComponent(name)}?fields=id,qualifiedName,displayName,description,verified,useCount,remote,isDeployed,homepage`);
  if (resp.status === 404) return null;
  if (!resp.ok) return null;
  const data = (await resp.json()) as SmitheryServerEntry;
  return smitheryToRegistryEntry(data);
}

// ── Combined registry helpers ────────────────────────────────────

/** Score a server entry against a search query */
function scoreEntry(s: RegistryServerEntry, q: string): number {
  let score = 0;
  const name = s.name.toLowerCase();
  const title = (s.title || '').toLowerCase();
  if (name === q) score += 100;
  else if (name.includes(q)) score += 50;
  if (title === q) score += 80;
  else if (title.includes(q)) score += 30;
  if (s.description.toLowerCase().includes(q)) score += 10;
  return score;
}

/** Collect up to `limit` servers from the registry + Smithery */
export async function fetchAllServers(limit = 100): Promise<RegistryServerEntry[]> {
  const seen = new Map<string, RegistryServerEntry>();
  let cursor: string | undefined;
  const perPage = Math.min(limit, 100);

  // Official registry
  while (seen.size < limit) {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const resp = await registryFetch(`/v0.1/servers?limit=${perPage}${cursorParam}`);
    if (!resp.ok) throw new Error(`Registry API error: ${resp.status}`);

    const data = (await resp.json()) as RegistryResponse;
    for (const entry of data.servers) {
      const s = entry.server;
      const meta = entry._meta?.['io.modelcontextprotocol.registry/official'];
      if (meta?.isLatest && !seen.has(s.name)) {
        seen.set(s.name, s);
      }
    }

    if (!data.metadata.nextCursor) break;
    cursor = data.metadata.nextCursor;
  }

  // Smithery (best-effort, non-blocking if it fails)
  try {
    const smitheryServers = await fetchAllSmitheryServers(limit);
    for (const s of smitheryServers) {
      if (!seen.has(s.name)) {
        seen.set(s.name, s);
      }
    }
  } catch {
    // Smithery is optional — silently skip on failure
  }

  return Array.from(seen.values());
}

/** Search registry + Smithery by keyword */
export async function searchRegistry(query: string, limit = 20): Promise<RegistryServerEntry[]> {
  const q = query.toLowerCase();

  // Fetch from both sources in parallel
  const [all, smitheryResults] = await Promise.all([
    fetchAllServers(limit * 3),
    searchSmithery(query, limit).catch(() => [] as RegistryServerEntry[]),
  ]);

  const combined = [...all];
  for (const s of smitheryResults) {
    if (!combined.some(existing => existing.name === s.name)) {
      combined.push(s);
    }
  }

  const scored = combined
    .filter(s => {
      const name = s.name.toLowerCase();
      const title = (s.title || '').toLowerCase();
      const desc = s.description.toLowerCase();
      return name.includes(q) || title.includes(q) || desc.includes(q);
    })
    .map(s => ({ server: s, score: scoreEntry(s, q) }))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(s => s.server);
}

/** Get a specific server by name from registry or Smithery */
export async function fetchServerByName(name: string): Promise<RegistryServerEntry | null> {
  // Try official registry first
  const encoded = encodeURIComponent(name);
  const resp = await registryFetch(`/v0.1/servers/${encoded}/versions/latest`);
  if (resp.ok) {
    const data = (await resp.json()) as { server: RegistryServerEntry };
    return data.server;
  }

  // Fall back to Smithery
  try {
    return await fetchSmitheryServerByName(name);
  } catch {
    return null;
  }
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

  // Smithery servers — deploy via namespace URL
  if (entry._smithery) {
    const namespace = entry.name.split('/')[0] || entry.name;
    return {
      name: shortName,
      transport: 'http',
      url: `https://mcp.smithery.run/${namespace}`,
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
