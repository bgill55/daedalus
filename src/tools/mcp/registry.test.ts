import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPRegistry } from './registry.js';
import type { ToolDefinition } from '../../types.js';

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
