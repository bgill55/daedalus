import { describe, it, expect } from 'vitest';
import { getAgentRole, filterToolsForRole, parseAgentTag, roleLabel, resolveRoleKey, AGENT_ROLES } from './roles.js';
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

  it('every role has a divine callsign', () => {
    for (const role of Object.values(AGENT_ROLES)) {
      expect(role.callsign).toBeTruthy();
      expect(role.callsign).toMatch(/^[A-Z][a-z]+$/); // PascalCase deity name
    }
  });

  it('maps each role key to its expected divine callsign', () => {
    expect(AGENT_ROLES.orchestrator.callsign).toBe('Daedalus');
    expect(AGENT_ROLES.spec.callsign).toBe('Themis');
    expect(AGENT_ROLES.planner.callsign).toBe('Metis');
    expect(AGENT_ROLES.coder.callsign).toBe('Hephaestus');
    expect(AGENT_ROLES.reviewer.callsign).toBe('Apollo');
    expect(AGENT_ROLES.debugger.callsign).toBe('Asclepius');
    expect(AGENT_ROLES.researcher.callsign).toBe('Mnemosyne');
  });

  it('roleLabel returns the divine callsign', () => {
    expect(roleLabel('coder')).toBe('Hephaestus');
    expect(roleLabel('unknown-role')).toBe('unknown-role');
  });

  it('resolveRoleKey maps machine keys and divine callsigns to the canonical key', () => {
    expect(resolveRoleKey('coder')).toBe('coder');
    expect(resolveRoleKey('Hephaestus')).toBe('coder');
    expect(resolveRoleKey('hephaestus')).toBe('coder');
    expect(resolveRoleKey('APOLLO')).toBe('reviewer');
    expect(resolveRoleKey('themis')).toBe('spec');
    // Unrecognized input is returned lowercased (caller decides fallback).
    expect(resolveRoleKey('not-a-role')).toBe('not-a-role');
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

  describe('parseAgentTag', () => {
    it('parses valid @role tags correctly', () => {
      const res = parseAgentTag('@planner break down the user auth task');
      expect(res).not.toBeNull();
      expect(res?.role).toBe('planner');
      expect(res?.cleanInput).toBe('break down the user auth task');
    });

    it('parses @role by divine callsign (e.g. @hephaestus → coder)', () => {
      const res = parseAgentTag('@hephaestus build the API server');
      expect(res).not.toBeNull();
      expect(res?.role).toBe('coder');
      expect(res?.cleanInput).toBe('build the API server');
    });

    it('parses @agent <callsign> syntax', () => {
      const res = parseAgentTag('@agent Apollo review the changes');
      expect(res).not.toBeNull();
      expect(res?.role).toBe('reviewer');
      expect(res?.cleanInput).toBe('review the changes');
    });

    it('parses @agent <role> syntax', () => {
      const res = parseAgentTag('@agent researcher find details on OAuth2');
      expect(res).not.toBeNull();
      expect(res?.role).toBe('researcher');
      expect(res?.cleanInput).toBe('find details on OAuth2');
    });

    it('returns null for unknown agent tags', () => {
      const res = parseAgentTag('@unknown do something');
      expect(res).toBeNull();
    });

    it('returns null for standard prompt text without tags', () => {
      const res = parseAgentTag('fix the bug in src/App.tsx');
      expect(res).toBeNull();
    });
  });
});
