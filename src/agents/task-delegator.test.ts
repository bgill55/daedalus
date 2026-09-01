import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskDelegator } from './task-delegator.js';
import type { ToolContext } from '../types.js';
import type { LocalRouter } from '../router/index.js';

// Global mock for child_process exec
const mockExec = vi.fn((cmd: string, opts: any, cb: any) => {
  const callback = typeof cb === 'function' ? cb : opts;
  if (typeof callback === 'function') {
    callback(null, 'build success', '');
  }
});
vi.mock('child_process', () => ({
  exec: (cmd: string, opts: any, cb: any) => mockExec(cmd, opts, cb),
}));

const createMockRouter = (responses: string[]) => {
  const chatMock = vi.fn();
  responses.forEach((content) => {
    chatMock.mockImplementationOnce(() =>
      Promise.resolve({
        choices: [{ message: { content, tool_calls: null } }],
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

describe('TaskDelegator', () => {
  let toolContext: ToolContext;

  beforeEach(() => {
    toolContext = baseContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('instantiates cleanly with dependencies', () => {
    const { router } = createMockRouter(['Done']);
    const delegator = new TaskDelegator(router, toolContext);
    expect(delegator).toBeInstanceOf(TaskDelegator);
  });

  it('picks appropriate memory categories based on task role and keywords', () => {
    const { router } = createMockRouter(['Done']);
    const delegator = new TaskDelegator(router, toolContext);

    expect(delegator.pickMemoryCategory({ goal: 'fix build error', context: '', role: 'debugger' })).toBe('fix_resolution');
    expect(delegator.pickMemoryCategory({ goal: 'verify test suite', context: '', role: 'reviewer' })).toBe('build_rule');
    expect(delegator.pickMemoryCategory({ goal: 'create spec interface', context: '', role: 'planner' })).toBe('schema_contract');
    expect(delegator.pickMemoryCategory({ goal: 'implement new button component', context: '', role: 'coder' })).toBe('code_pattern');
  });

  it('records successful task execution in results array when patch artifacts exist', async () => {
    const chatMock = vi.fn().mockImplementationOnce(() => {
      toolContext.patchHistory?.push({
        filePath: '/tmp/cli.ts',
        oldContent: '',
        newContent: '',
        timestamp: Date.now(),
        description: 'wrote file',
      });
      return Promise.resolve({
        choices: [{ message: { content: 'Updated the CLI entrypoint.', tool_calls: null } }],
      } as any);
    });

    const localRouter = {
      chat: { completions: { create: chatMock } },
      chatStream: vi.fn(),
      chatCompletion: chatMock,
      getModels: vi.fn().mockReturnValue([{ name: 'test', model: 'test' }]),
    } as unknown as LocalRouter;

    const delegator = new TaskDelegator(localRouter, toolContext);
    await delegator.delegateTask({ goal: 'implement a tiny CLI utility', context: '', role: 'coder' });
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(delegator.results.at(-1)?.success).toBe(true);
  });
});
