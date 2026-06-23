import { describe, it, expect } from 'vitest';
import { executeToolCall, executeToolCalls } from './executor.js';
import { TOOL_IMPLEMENTATIONS } from './definitions.js';
import type { ToolContext, ToolCall } from '../types.js';

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
  }, 10_000);

  it('executes git_diff successfully', async () => {
    const tc: ToolCall = {
      id: 'call_5', type: 'function',
      function: { name: 'git_diff', arguments: '{}' },
    };
    const result = await executeToolCall(tc, mockContext);
    expect(result.success).toBe(true);
  });

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

  it('executeToolCalls runs multiple calls in parallel', async () => {
    const calls: ToolCall[] = [
      { id: 'a', type: 'function', function: { name: 'git_status', arguments: '{}' } },
      { id: 'b', type: 'function', function: { name: 'git_diff', arguments: '{}' } },
    ];
    const results = await executeToolCalls(calls, mockContext);
    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
  });

});
