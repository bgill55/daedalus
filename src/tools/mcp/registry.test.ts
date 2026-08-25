import { describe, it, expect, beforeEach } from 'vitest';
import { MCPRegistry, applyLaunchFolderRoot } from './registry.js';
import type { MCPServerConfig } from './types.js';

describe('MCP Registry', () => {
  let registry: MCPRegistry;

  beforeEach(() => {
    registry = new MCPRegistry();
  });

  it('starts with no MCP tools', () => {
    expect(registry.getToolDefinitions()).toEqual([]);
  });

  it('registers MCP tool definitions after connect', () => {
    expect(registry.getToolDefinitions()).toHaveLength(0);
  });

  it('getConnectedServers returns empty initially', () => {
    expect(registry.getConnectedServers()).toEqual([]);
  });

});

describe('applyLaunchFolderRoot', () => {
  const fsConfig: MCPServerConfig = {
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\', 'D:\\Daedalus', 'D:\\prompt-vault'],
    enabled: true,
  };

  it('appends the launch folder as a root for the filesystem server', () => {
    const out = applyLaunchFolderRoot(fsConfig, 'D:\\daedalus-sandbox');
    expect(out.args).toContain('D:\\daedalus-sandbox');
    expect(out.args?.length).toBe(fsConfig.args!.length + 1);
  });

  it('does NOT mutate the original config', () => {
    const before = fsConfig.args!.length;
    applyLaunchFolderRoot(fsConfig, 'D:\\daedalus-sandbox');
    expect(fsConfig.args!.length).toBe(before);
  });

  it('does not add a duplicate launch folder (case-insensitive on Windows)', () => {
    const out = applyLaunchFolderRoot(fsConfig, 'd:\\daedalus-sandbox');
    expect(out.args!.filter((a) => a.toLowerCase() === 'd:\\daedalus-sandbox').length).toBe(1);
  });

  it('skips non-filesystem stdio servers', () => {
    const other: MCPServerConfig = { name: 'discord', transport: 'stdio', command: 'node', args: ['bot.js'], enabled: true };
    expect(applyLaunchFolderRoot(other, 'D:\\x')).toBe(other);
  });

  it('skips http transports', () => {
    const http: MCPServerConfig = { name: 'api', transport: 'http', url: 'http://localhost', enabled: true };
    expect(applyLaunchFolderRoot(http, 'D:\\x')).toBe(http);
  });

  it('is a no-op when the launch folder is already a configured root', () => {
    const out = applyLaunchFolderRoot(fsConfig, 'D:\\prompt-vault');
    expect(out.args).toEqual(fsConfig.args);
  });
});

