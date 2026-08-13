import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeToolCall, executeToolCalls } from './executor.js';
import { TOOL_IMPLEMENTATIONS } from './definitions.js';
import type { ToolContext, ToolCall } from '../types.js';
import { DEFAULT_CONFIG } from '../config/index.js';
import fs from 'fs';
import path from 'path';

const mockContext: ToolContext = {
  sessionId: 'test-session',
  projectRoot: process.cwd(),
  projectHash: 'testhash',
  activeFiles: new Map(),
  agentRole: 'coder',
  abortSignal: new AbortController().signal,
  autoApplyEdits: 'all',
  patchHistory: [],
} as ToolContext;

describe('Tool executor', () => {

  it('normalizes tool argument aliases like new_content and filepath', async () => {
    const { normalizeToolArgs } = await import('./executor.js');
    const args = normalizeToolArgs('write_file', { filepath: 'README.md', new_content: '# PromptVault' });
    expect(args.path).toBe('README.md');
    expect(args.content).toBe('# PromptVault');
  });

  it('returns error for unknown tool', async () => {
    const tc: ToolCall = {
      id: 'call_1', type: 'function',
      function: { name: 'nonexistent_tool', arguments: '{}' },
    };
    const result = await executeToolCall(tc, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });

  it('returns error for invalid JSON arguments', async () => {
    const tc: ToolCall = {
      id: 'call_2', type: 'function',
      function: { name: 'git_status', arguments: '{ broken json' },
    };
    const result = await executeToolCall(tc, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid tool arguments');
  });

  it('returns error for MCP tools without prefix', async () => {
    const tc: ToolCall = {
      id: 'call_3', type: 'function',
      function: { name: 'mcp_unknown', arguments: '{}' },
    };
    const result = await executeToolCall(tc, mockContext);
    expect(result.success).toBe(false);
  });

  it('executes git_status successfully', async () => {
    const tc: ToolCall = {
      id: 'call_4', type: 'function',
      function: { name: 'git_status', arguments: '{}' },
    };
    const result = await executeToolCall(tc, mockContext);
    expect(result.success).toBe(true);
  }, 30_000);

  it('executes git_diff successfully', async () => {
    const tc: ToolCall = {
      id: 'call_5', type: 'function',
      function: { name: 'git_diff', arguments: '{}' },
    };
    const result = await executeToolCall(tc, mockContext);
    expect(result.success).toBe(true);
  }, 30_000);

  it('handles tool execution failure gracefully', async () => {
    const original = TOOL_IMPLEMENTATIONS['read_file'];
    (TOOL_IMPLEMENTATIONS as any)['read_file'] = 'nonexistent.module.readFile';

    const tc: ToolCall = {
      id: 'call_6', type: 'function',
      function: { name: 'read_file', arguments: '{"path": "test.ts"}' },
    };
    const result = await executeToolCall(tc, mockContext);
    expect(result.success).toBe(false);

    (TOOL_IMPLEMENTATIONS as any)['read_file'] = original;
  });

  it('returns validation error when required tool args are missing', async () => {
    const tc: ToolCall = {
      id: 'call_7', type: 'function',
      function: { name: 'read_file', arguments: '{}' },
    };
    const result = await executeToolCall(tc, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain("missing required parameter(s): path");
  });

  it('executeToolCalls runs multiple calls in parallel', async () => {
    const calls: ToolCall[] = [
      { id: 'a', type: 'function', function: { name: 'git_status', arguments: '{}' } },
      { id: 'b', type: 'function', function: { name: 'git_diff', arguments: '{}' } },
    ];
    const results = await executeToolCalls(calls, mockContext);
    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
  }, 30_000);

  it('dispatches generate_image tool call via executor', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ images: ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='] }),
    } as Response);

    const tc: ToolCall = {
      id: 'call_gen_img',
      type: 'function',
      function: { name: 'generate_image', arguments: '{"prompt":"test image"}' },
    };
    const result = await executeToolCall(tc, mockContext);
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('skips a dependent terminal call when a prior file-mutation tool failed in the batch', async () => {
    const calls: ToolCall[] = [
      { id: 'p', type: 'function', function: { name: 'patch', arguments: '{"path":"x.ts","new_string":"y"}' } }, // missing old_string -> failure
      { id: 't', type: 'function', function: { name: 'terminal', arguments: '{"command":"npm test"}' } },
    ];
    const results = await executeToolCalls(calls, mockContext);
    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(false);
    expect(results[1].success).toBe(false);
    expect(results[1].error).toContain('[SKIPPED]');
  }, 30_000);

  it('still executes read-only tools after a prior file-mutation failure', async () => {
    const calls: ToolCall[] = [
      { id: 'p', type: 'function', function: { name: 'patch', arguments: '{"path":"x.ts","new_string":"y"}' } },
      { id: 'r', type: 'function', function: { name: 'read_file', arguments: '{"path":"nope.ts"}' } },
    ];
    const results = await executeToolCalls(calls, mockContext);
    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(false);
    expect(results[1].error).not.toContain('[SKIPPED]');
  }, 30_000);

  it('does not skip a terminal call when no prior file-mutation tool failed', async () => {
    const calls: ToolCall[] = [
      { id: 'r', type: 'function', function: { name: 'git_status', arguments: '{}' } },
      { id: 't', type: 'function', function: { name: 'terminal', arguments: '{"command":"echo hi"}' } },
    ];
    const results = await executeToolCalls(calls, mockContext);
    expect(results).toHaveLength(2);
    expect(results[1].error ?? '').not.toContain('[SKIPPED]');
  }, 30_000);

  describe('tool-permission policy enforcement', () => {
    const HOME = process.env.USERPROFILE || process.env.HOME || '';
    const configDir = path.join(HOME, '.daedalus');
    const configPath = path.join(configDir, 'config.json');
    let backup: string | null = null;

    beforeEach(() => {
      if (fs.existsSync(configPath)) backup = fs.readFileSync(configPath, 'utf8');
    });
    afterEach(() => {
      // Restore the real config so we never leave the user's policy changed.
      if (backup !== null) fs.writeFileSync(configPath, backup, 'utf8');
      else if (fs.existsSync(configPath)) fs.rmSync(configPath, { force: true });
    });

    // Write a FULL valid config (loadConfig falls back to defaults if the schema
    // parse fails) with only tools.permissions overridden.
    const writePolicy = (policy: { terminal: 'auto' | 'ask'; files: 'auto' | 'ask' }) => {
      const full = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      full.tools = full.tools || {};
      full.tools.permissions = policy;
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(full));
    };

    it('blocks terminal when config.tools.permissions.terminal is "ask"', async () => {
      writePolicy({ terminal: 'ask', files: 'auto' });
      const calls: ToolCall[] = [
        { id: 't', type: 'function', function: { name: 'terminal', arguments: '{"command":"rm -rf /"}' } },
      ];
      const results = await executeToolCalls(calls, mockContext);
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error ?? '').toContain('[PERMISSION DENIED]');
    }, 30_000);

    it('allows terminal when config.tools.permissions.terminal is "auto"', async () => {
      writePolicy({ terminal: 'auto', files: 'auto' });
      const calls: ToolCall[] = [
        { id: 't', type: 'function', function: { name: 'terminal', arguments: '{"command":"echo ok"}' } },
      ];
      const results = await executeToolCalls(calls, mockContext);
      expect(results).toHaveLength(1);
      expect(results[0].error ?? '').not.toContain('[PERMISSION DENIED]');
    }, 30_000);
  });
});
