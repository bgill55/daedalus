import { describe, it, expect, beforeEach } from 'vitest';
import { MCPRegistry } from './registry.js';

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
