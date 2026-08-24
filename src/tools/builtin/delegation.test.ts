import { describe, it, expect, vi, afterEach } from 'vitest';
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

  it('records WHY a sub-agent hit max turns (cause in the returned stub)', async () => {
    const mockRouterClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: 'working...',
                role: 'assistant',
                tool_calls: [
                  { id: 'call_1', type: 'function', function: { name: 'terminal', arguments: '{"command":"cd /d/x && npx tsx src/server.ts & sleep 3"}' } },
                ],
              },
            }],
          }),
        },
      },
    };
    setRouterClient(mockRouterClient as any);

    const executorMod = await import('../executor.js');
    vi.spyOn(executorMod, 'executeToolCalls').mockResolvedValue([{
      toolCallId: 'call_1',
      name: 'terminal',
      success: false,
      content: '',
      error: "[CIRCUIT BREAKER] command 'cd' failed 2 consecutive times. Inspect the terminal error output, fix the arguments, or switch approach instead of retrying the same command.",
    }]);

    const result = await manage({ goal: 'do something', role: 'coder' }, mockContext);

    expect(result.content).toContain('Sub-agent reached max turns');
    expect(result.content).toContain('(cause:');
    expect(result.content).toMatch(/circuit breaker/i);
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

  it('injects date and time dynamically into delegated system prompt', async () => {
    const mockRouterClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValueOnce({
            choices: [{ message: { content: 'Done', role: 'assistant', tool_calls: [] } }],
          }),
        },
      },
    };
    setRouterClient(mockRouterClient as any);

    await manage({
      goal: 'implement feature',
      role: 'coder',
    }, mockContext);

    expect(mockRouterClient.chat.completions.create).toHaveBeenCalled();
    const calls = mockRouterClient.chat.completions.create.mock.calls;
    const firstCallArgs = calls[0][0];
    const systemMessage = firstCallArgs.messages.find((m: any) => m.role === 'system');
    expect(systemMessage.content).toContain('CURRENT TIME');
  });
});
