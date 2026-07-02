import { describe, it, expect } from 'vitest';
import { getAgentRole, filterToolsForRole, AGENT_ROLES } from './roles.js';
import type { ToolDefinition } from '../tools/definitions.js';

describe('Agent roles', () => {
  it('returns all defined roles', () => {
    const roleNames = Object.keys(AGENT_ROLES);
    expect(roleNames).toContain('orchestrator');
    expect(roleNames).toContain('planner');
    expect(roleNames).toContain('coder');
    expect(roleNames).toContain('reviewer');
    expect(roleNames).toContain('debugger');
    expect(roleNames).toContain('researcher');
  });

  it('getAgentRole returns the correct role', () => {
    const role = getAgentRole('coder');
    expect(role.name).toBe('coder');
    expect(role.description).toBe('Implements changes, writes/edits files, fixes bugs');
  });

  it('getAgentRole falls back to coder for unknown role', () => {
    const role = getAgentRole('nonexistent');
    expect(role.name).toBe('coder');
  });

  it('each role has required properties', () => {
    for (const [name, role] of Object.entries(AGENT_ROLES)) {
      expect(role.name).toBe(name);
      expect(role.description).toBeTruthy();
      expect(role.systemPrompt).toBeTruthy();
      expect(Array.isArray(role.allowedTools)).toBe(true);
      expect(typeof role.canDelegate).toBe('boolean');
    }
  });

  it('only orchestrator can delegate', () => {
    for (const [name, role] of Object.entries(AGENT_ROLES)) {
      if (name === 'orchestrator') {
        expect(role.canDelegate).toBe(true);
      } else {
        expect(role.canDelegate).toBe(false);
      }
    }
  });

  it('filterToolsForRole returns only allowed tools for coder', () => {
    const allTools: ToolDefinition[] = [
      { type: 'function', function: { name: 'read_file', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'write_file', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'patch', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'search_files', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'list_files', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'terminal', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'git_diff', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'git_status', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'todo', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'web_search', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'fetch_url', description: '', parameters: { type: 'object', properties: {} } } },
    ];

    const filtered = filterToolsForRole(allTools, 'coder');
    const names = filtered.map(t => t.function.name);

    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('web_search');
    expect(names).toContain('fetch_url');
  });

  it('filterToolsForRole returns limited tools for planner', () => {
    const allTools: ToolDefinition[] = [
      { type: 'function', function: { name: 'todo', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'read_file', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'write_file', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'web_search', description: '', parameters: { type: 'object', properties: {} } } },
    ];

    const filtered = filterToolsForRole(allTools, 'planner');
    const names = filtered.map(t => t.function.name);

    expect(names).toContain('todo');
    expect(names).toContain('read_file');
    expect(names).not.toContain('write_file');
  });

  it('filterToolsForRole returns review-appropriate tools for reviewer', () => {
    const allTools: ToolDefinition[] = [
      { type: 'function', function: { name: 'read_file', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'write_file', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'patch', description: '', parameters: { type: 'object', properties: {} } } },
    ];

    const filtered = filterToolsForRole(allTools, 'reviewer');
    const names = filtered.map(t => t.function.name);

    expect(names).toContain('read_file');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('patch');
  });

  it('orchestrator has todo and delegate_task tools', () => {
    const allTools: ToolDefinition[] = [
      { type: 'function', function: { name: 'todo', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'delegate_task', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'read_file', description: '', parameters: { type: 'object', properties: {} } } },
    ];

    const filtered = filterToolsForRole(allTools, 'orchestrator');
    const names = filtered.map(t => t.function.name);

    expect(names).toContain('todo');
    expect(names).toContain('read_file');
  });

  it('each role has a temperature within valid range', () => {
    for (const role of Object.values(AGENT_ROLES)) {
      if (role.temperature !== undefined) {
        expect(role.temperature).toBeGreaterThanOrEqual(0);
        expect(role.temperature).toBeLessThanOrEqual(2);
      }
    }
  });
});
