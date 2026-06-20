import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { manage, setRouterClient } from './delegation.js';
import type { ToolContext } from '../../types.js';

describe('Delegation tool', () => {

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

  afterEach(() => {
    vi.restoreAllMocks();
    setRouterClient(null as any);
  });

  it('returns error when router client is not set', async () => {
    setRouterClient(null as any);
    const result = await manage({
      goal: 'do something',
      role: 'coder',
    }, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not initialized');
  });

  it('delegates and returns sub-agent result', async () => {
    const mockRouterClient = {
      chat: {
        completions: {
          create: vi.fn()
            .mockResolvedValueOnce({
              choices: [{ message: { content: 'I will do the task', role: 'assistant', tool_calls: [] } }],
            }),
        },
      },
    };
    setRouterClient(mockRouterClient as any);

    const result = await manage({
      goal: 'implement feature',
      role: 'coder',
    }, mockContext);

    expect(result.success).toBe(true);
    expect(mockRouterClient.chat.completions.create).toHaveBeenCalled();
  });

  it('reaches max turns for long-running agents', async () => {
    const mockRouterClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: 'working...',
                role: 'assistant',
                tool_calls: [
                  { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path": "test.ts"}' } },
                ],
              },
            }],
          }),
        },
      },
    };
    setRouterClient(mockRouterClient as any);

    const result = await manage({
      goal: 'do something',
      role: 'coder',
    }, mockContext);

    expect(result.content).toContain('max turns');
  });

  it('handles router errors gracefully', async () => {
    const mockRouterClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('API error')),
        },
      },
    };
    setRouterClient(mockRouterClient as any);

    const result = await manage({
      goal: 'do something',
    }, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Delegation failed');
  });

});
