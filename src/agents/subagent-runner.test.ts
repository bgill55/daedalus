import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SubAgentRunner } from './subagent-runner.js';
import { getAgentRole } from './roles.js';
import type { ToolContext } from '../types.js';
import type { LocalRouter } from '../router/index.js';

const createMockRouter = (responses: Array<{ content?: string; tool_calls?: any[] }>) => {
  const chatMock = vi.fn();
  responses.forEach((resp) => {
    chatMock.mockImplementationOnce(() =>
      Promise.resolve({
        choices: [{ message: { content: resp.content || null, tool_calls: resp.tool_calls || null } }],
      } as any),
    );
  });

  const router = {
    chat: { completions: { create: chatMock } },
    chatStream: vi.fn(),
    chatCompletion: chatMock,
    getModels: vi.fn().mockReturnValue([{ name: 'test', model: 'test' }]),
  } as unknown as LocalRouter;

  return { router, chatMock };
};

const baseContext = (): ToolContext => ({
  sessionId: 'test',
  projectRoot: process.cwd(),
  projectHash: 'test',
  activeFiles: new Map(),
  agentRole: 'coder',
  abortSignal: new AbortController().signal,
  patchHistory: [],
});

describe('SubAgentRunner', () => {
  let toolContext: ToolContext;

  beforeEach(() => {
    toolContext = baseContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('instantiates cleanly with dependencies', () => {
    const { router } = createMockRouter([{ content: 'Done' }]);
    const runner = new SubAgentRunner(router, toolContext);
    expect(runner).toBeInstanceOf(SubAgentRunner);
  });

  it('executes a single-turn agent run returning text output', async () => {
    const { router, chatMock } = createMockRouter([{ content: 'Task completed successfully.' }]);
    const runner = new SubAgentRunner(router, toolContext);
    const role = getAgentRole('coder');
    const result = await runner.runAgent(role, 'Build feature', 'Context', []);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(result).toBe('Task completed successfully.');
  });

  it('handles abort signal gracefully', async () => {
    const controller = new AbortController();
    controller.abort();
    toolContext.abortSignal = controller.signal;

    const { router } = createMockRouter([{ content: 'Never called' }]);
    const runner = new SubAgentRunner(router, toolContext);
    const role = getAgentRole('coder');
    const result = await runner.runAgent(role, 'Build feature', 'Context', []);
    expect(result).toBe('Agent execution aborted by user');
  });

  it('retries API calls on transient failure', async () => {
    const chatMock = vi.fn()
      .mockRejectedValueOnce(new Error('Rate limit 429'))
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Success after retry' } }] });

    const router = {
      chat: { completions: { create: chatMock } },
      getModels: vi.fn().mockReturnValue([{ name: 'test', model: 'test' }]),
    } as unknown as LocalRouter;

    const runner = new SubAgentRunner(router, toolContext);
    const role = getAgentRole('coder');
    const result = await runner.runAgent(role, 'Build feature', 'Context', []);
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(result).toBe('Success after retry');
  });
});
