import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Orchestrator } from './orchestrator.js';
import type { ToolContext, ChatMessage } from '../types.js';
import type { LocalRouter } from '../router/index.js';

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

describe('Orchestrator', () => {
  let router: LocalRouter;
  let chatMock: ReturnType<typeof vi.fn>;
  let toolContext: ToolContext;
  let messages: ChatMessage[];

  beforeEach(() => {
    messages = [];
    toolContext = baseContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates instance with router, messages, and context', () => {
    router = {
      chat: { completions: { create: vi.fn() } },
      chatStream: vi.fn(),
      chatCompletion: vi.fn(),
      getModels: vi.fn().mockReturnValue([{ name: 'test', model: 'test' }]),
    } as unknown as LocalRouter;

    const orch = new Orchestrator(router, messages, toolContext);
    expect(orch).toBeInstanceOf(Orchestrator);
  });

  it('run method handles errors gracefully', async () => {
    router = {
      chat: { completions: { create: vi.fn().mockRejectedValue(new Error('API failure')) } },
      chatStream: vi.fn(),
      chatCompletion: vi.fn().mockRejectedValue(new Error('API failure')),
      getModels: vi.fn().mockReturnValue([{ name: 'test', model: 'test' }]),
    } as unknown as LocalRouter;

    const orch = new Orchestrator(router, messages, toolContext);
    const result = await orch.run('do something');
    expect(result).toBeTruthy();
  });

  it('synthesize returns formatted output', async () => {
    const orch = new Orchestrator(router, messages, toolContext);
    const synth = (orch as any).synthesize('test goal');
    expect(synth).toContain('Orchestration Complete');
    expect(synth).toContain('test goal');
  });

  it('synthesize surfaces verification failure details', async () => {
    const orch = new Orchestrator(router, messages, toolContext);
    (orch as any).results = [
      {
        role: 'coder',
        goal: 'implement CLI',
        summary: 'hallucinated',
        success: false,
        evidence: 'no artifacts',
      },
    ];
    const synth = (orch as any).synthesize('build CLI');
    expect(synth).toContain('Orchestration Hit Verification Failures');
    expect(synth).toContain('no artifacts');
  });
});

describe('Orchestrator artifact verification', () => {
  let router: LocalRouter;
  let chatMock: ReturnType<typeof vi.fn>;
  let toolContext: ToolContext;
  let messages: ChatMessage[];

  beforeEach(() => {
    messages = [];
    toolContext = baseContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requiresRealArtifacts is false for non-coder roles', async () => {
    const { router: localRouter } = createMockRouter([]);
    const orch = new Orchestrator(localRouter, messages, toolContext);
    expect((orch as any).requiresRealArtifacts('planner', 'implement thing')).toBe(false);
  });

  it('requiresRealArtifacts is true for coder implementation keywords', async () => {
    const { router: localRouter } = createMockRouter([]);
    const orch = new Orchestrator(localRouter, messages, toolContext);
    expect((orch as any).requiresRealArtifacts('coder', 'implement CLI')).toBe(true);
  });

  it('verifyArtifacts returns false when coder claims success without artifacts', async () => {
    const { router: localRouter } = createMockRouter([]);
    const chat = vi.spyOn(console, 'log').mockImplementation(() => {});
    const orch = new Orchestrator(localRouter, messages, toolContext);
    expect(await (orch as any).verifyArtifacts('coder', 'implement CLI', 'Implemented the full CLI utility.')).toBe(false);
    chat.mockRestore();
  });

  it('verifyArtifacts returns true when failure is explicitly declared', async () => {
    const { router: localRouter } = createMockRouter([]);
    const orch = new Orchestrator(localRouter, messages, toolContext);
    expect(await (orch as any).verifyArtifacts('coder', 'implement CLI', 'Failed to write the requested CLI files.')).toBe(true);
  });

  it('verifyArtifacts returns true when patchHistory exists', async () => {
    toolContext.patchHistory = [
      { filePath: '/tmp/foo.ts', oldContent: '', newContent: '', timestamp: Date.now(), description: 'wrote file' },
    ];
    const { router: localRouter } = createMockRouter([]);
    const orch = new Orchestrator(localRouter, messages, toolContext);
    expect(await (orch as any).verifyArtifacts('coder', 'implement CLI', 'Wrote /tmp/foo.ts.')).toBe(true);
  });

  it('verifyArtifacts returns false for pending write paths unrelated to goal', async () => {
    const { router: localRouter } = createMockRouter([]);
    const orch = new Orchestrator(localRouter, messages, toolContext);
    expect(await (orch as any).verifyArtifacts('coder', 'build web app', 'Wrote /tmp/other_service.ts.')).toBe(false);
  });
});

describe('Orchestrator delegateTask behavior', () => {
  let router: LocalRouter;
  let chatMock: ReturnType<typeof vi.fn>;
  let toolContext: ToolContext;
  let messages: ChatMessage[];

  beforeEach(() => {
    messages = [];
    toolContext = baseContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks coder as [OK] when artifacts are present', async () => {
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

    const orch = new Orchestrator(localRouter, messages, toolContext);
    await (orch as any).delegateTask({ goal: 'implement a tiny CLI utility', context: '', role: 'coder' });
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect((orch as any).results.at(-1).success).toBe(true);
  });

  it('marks coder as [ERROR] when no artifacts are present', async () => {
    const logMock = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { router: localRouter } = createMockRouter(['Implemented the full CLI utility.']);
    const orch = new Orchestrator(localRouter, messages, toolContext);
    const task = { goal: 'implement a tiny CLI utility', context: '', role: 'coder' };
    await (orch as any).delegateTask(task);
    expect((orch as any).results.at(-1).success).toBe(false);
    logMock.mockRestore();
  });
});

describe('Orchestrator repair attempts', () => {
  let chatMock: ReturnType<typeof vi.fn>;
  let router: LocalRouter;
  let toolContext: ToolContext;
  let messages: ChatMessage[];

  beforeEach(() => {
    messages = [];
    toolContext = baseContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('repairs a failed task and marks it successful when repair shows artifacts', async () => {
    chatMock = vi.fn();
    chatMock.mockImplementationOnce(() =>
      Promise.resolve({
        choices: [{ message: { content: 'Failed to write initial file.', tool_calls: null } }],
      } as any),
    );
    chatMock.mockImplementationOnce(() => {
      toolContext.patchHistory?.push({
        filePath: '/tmp/cli.ts',
        oldContent: '',
        newContent: '',
        timestamp: Date.now(),
        description: 'wrote file',
      });
      return Promise.resolve({
        choices: [{ message: { content: 'Created the CLI entrypoint and supporting files.', tool_calls: null } }],
      } as any);
    });

    router = {
      chat: { completions: { create: chatMock } },
      chatStream: vi.fn(),
      chatCompletion: chatMock,
      getModels: vi.fn().mockReturnValue([{ name: 'test', model: 'test' }]),
    } as unknown as LocalRouter;

    const orch = new Orchestrator(router, messages, toolContext);
    const repaired = await (orch as any).attemptRepair(
      { goal: 'implement a tiny CLI utility', context: '', role: 'coder' },
      { role: 'coder', goal: 'implement a tiny CLI utility', summary: 'Failed to write initial file.', success: false },
    );
    expect(repaired.success).toBe(true);
  });

  it('stops retrying after maxRetries', async () => {
    chatMock = vi.fn();
    for (let i = 0; i < 2; i++) {
      chatMock.mockImplementationOnce(() =>
        Promise.resolve({
          choices: [{ message: { content: 'Repair attempt failed again.', tool_calls: null } }],
        } as any),
      );
    }

    router = {
      chat: { completions: { create: chatMock } },
      chatStream: vi.fn(),
      chatCompletion: chatMock,
      getModels: vi.fn().mockReturnValue([{ name: 'test', model: 'test' }]),
    } as unknown as LocalRouter;

    const orch = new Orchestrator(router, messages, toolContext);
    const previous = { role: 'coder', goal: 'implement CLI', summary: 'failed', success: false };
    const repaired = await (orch as any).attemptRepair(
      { goal: 'implement CLI', context: '', role: 'coder' },
      previous as any,
    );
    expect(repaired.success).toBe(false);
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it('stops repair attempts immediately if aborted', async () => {
    const controller = new AbortController();
    toolContext.abortSignal = controller.signal;
    chatMock = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.resolve({
        choices: [{ message: { content: 'Wrote some files', tool_calls: null } }],
      } as any);
    });

    router = {
      chat: { completions: { create: chatMock } },
      chatStream: vi.fn(),
      chatCompletion: chatMock,
      getModels: vi.fn().mockReturnValue([{ name: 'test', model: 'test' }]),
    } as unknown as LocalRouter;

    const orch = new Orchestrator(router, messages, toolContext);
    const previous = { role: 'coder', goal: 'implement CLI', summary: 'failed', success: false };
    const repaired = await (orch as any).attemptRepair(
      { goal: 'implement CLI', context: '', role: 'coder' },
      previous as any,
    );
    expect(repaired.success).toBe(false);
    expect(chatMock).toHaveBeenCalledTimes(1);
  });
});

describe('Orchestrator new workflow optimizations', () => {
  let router: LocalRouter;
  let toolContext: ToolContext;
  let messages: ChatMessage[];

  beforeEach(() => {
    messages = [];
    toolContext = baseContext();
  });

  it('parseDelegationTasks extracts goals cleanly without prefixes or colons', () => {
    const plan = `
1. delegate to coder: Implement new API endpoint
- delegate to researcher - Research credentials config
* delegate to reviewer: Code quality check
delegate to debugger fix tsconfig deprecations
    `;
    const { router: localRouter } = createMockRouter([]);
    const orch = new Orchestrator(localRouter, messages, toolContext);
    const tasks = (orch as any).parseDelegationTasks(plan);

    expect(tasks).toHaveLength(4);
    expect(tasks[0]).toEqual({ role: 'coder', goal: 'Implement new API endpoint', context: '', status: 'pending' });
    expect(tasks[1]).toEqual({ role: 'researcher', goal: 'Research credentials config', context: '', status: 'pending' });
    expect(tasks[2]).toEqual({ role: 'reviewer', goal: 'Code quality check', context: '', status: 'pending' });
    expect(tasks[3]).toEqual({ role: 'debugger', goal: 'fix tsconfig deprecations', context: '', status: 'pending' });
  });

  it('parseDelegationTasks extracts prefix-less and bulleted role goals correctly', () => {
    const plan = `
1. Coder: Implement OAuth flow
- Researcher - check YouTube API
Debugger: fix deprecations
* Reviewer: inspect code quality
    `;
    const { router: localRouter } = createMockRouter([]);
    const orch = new Orchestrator(localRouter, messages, toolContext);
    const tasks = (orch as any).parseDelegationTasks(plan);

    expect(tasks).toHaveLength(4);
    expect(tasks[0]).toEqual({ role: 'coder', goal: 'Implement OAuth flow', context: '', status: 'pending' });
    expect(tasks[1]).toEqual({ role: 'researcher', goal: 'check YouTube API', context: '', status: 'pending' });
    expect(tasks[2]).toEqual({ role: 'debugger', goal: 'fix deprecations', context: '', status: 'pending' });
    expect(tasks[3]).toEqual({ role: 'reviewer', goal: 'inspect code quality', context: '', status: 'pending' });
  });

  it('parseDelegationTasks includes active files list in task context', () => {
    toolContext.activeFiles.set('/path/foo.ts', '/path/foo.ts');
    const plan = `delegate to coder: modify foo.ts`;
    const { router: localRouter } = createMockRouter([]);
    const orch = new Orchestrator(localRouter, messages, toolContext);
    const tasks = (orch as any).parseDelegationTasks(plan);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].context).toContain('Files in context: /path/foo.ts');
  });

  it('runAgent respects abortSignal', async () => {
    const controller = new AbortController();
    toolContext.abortSignal = controller.signal;
    controller.abort();

    const { router: localRouter, chatMock } = createMockRouter(['Response']);
    const orch = new Orchestrator(localRouter, messages, toolContext);
    
    const role = { name: 'coder', systemPrompt: '', allowedTools: [] };
    const result = await (orch as any).runAgent(role, 'goal', '', []);
    expect(result).toBe('Agent execution aborted by user');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('resume method runs executePlan from specified startIndex', async () => {
    const { router: localRouter } = createMockRouter([]);
    const orch = new Orchestrator(localRouter, messages, toolContext);
    
    const executePlanSpy = vi.spyOn(orch as any, 'executePlan').mockResolvedValue(undefined);
    const synthesizeSpy = vi.spyOn(orch as any, 'synthesize').mockReturnValue('Synthesized Result');

    const tasks = [{ goal: 'task 1', context: '', role: 'coder' }];
    const prevResults = [{ role: 'coder', goal: 'task 0', summary: 'done', success: true }];
    const result = await orch.resume('goal', 'planText', tasks, 1, prevResults);

    expect(result).toBe('Synthesized Result');
    expect(executePlanSpy).toHaveBeenCalledWith('planText', tasks, 1);
    expect(synthesizeSpy).toHaveBeenCalledWith('goal');
  });

  it('executePlan saves state to sessionManager', async () => {
    const { router: localRouter } = createMockRouter([]);
    const mockSessionManager = {
      saveState: vi.fn(),
      getState: vi.fn(),
    } as any;

    const orch = new Orchestrator(localRouter, messages, toolContext, mockSessionManager);
    vi.spyOn(orch as any, 'delegateTask').mockResolvedValue(undefined);

    const tasks = [
      { goal: 'task 1', context: '', role: 'coder' },
      { goal: 'task 2', context: '', role: 'coder' }
    ];

    process.env.DAEDALUS_AUTO_APPROVE = 'true';
    await (orch as any).executePlan('plan', tasks, 0);
    delete process.env.DAEDALUS_AUTO_APPROVE;

    expect(mockSessionManager.saveState).toHaveBeenCalledWith('orchestrate_task_index', 1);
    expect(mockSessionManager.saveState).toHaveBeenCalledWith('orchestrate_task_index', 2);
  });

  it('runAgent dynamically injects date and time into system prompt', async () => {
    const { router: localRouter, chatMock } = createMockRouter(['Response']);
    const orch = new Orchestrator(localRouter, messages, toolContext);
    const role = { name: 'coder', systemPrompt: 'System prompt content', allowedTools: [] };
    await (orch as any).runAgent(role, 'goal', 'context', []);
    
    expect(chatMock).toHaveBeenCalled();
    const calls = chatMock.mock.calls;
    const firstCallArgs = calls[0][0];
    const systemMessage = firstCallArgs.messages.find((m: any) => m.role === 'system');
    expect(systemMessage.content).toContain('System prompt content');
    expect(systemMessage.content).toContain('CURRENT TIME');
  });

  it('executePlan prompts for retry on task failure and handles abort', async () => {
    const { router: localRouter } = createMockRouter([]);
    const mockSessionManager = {
      saveState: vi.fn(),
      getState: vi.fn(),
    } as any;

    const askLineMock = vi.fn()
      .mockResolvedValueOnce('retry')
      .mockResolvedValueOnce('abort');

    const abortController = new AbortController();
    const mockToolContext = {
      ...toolContext,
      askLine: askLineMock,
      abortSignal: abortController.signal,
    };

    const orch = new Orchestrator(localRouter, messages, mockToolContext, mockSessionManager);
    
    let callCount = 0;
    vi.spyOn(orch as any, 'delegateTask').mockImplementation(async (task: any) => {
      callCount++;
      task.status = 'failed';
      task.error = 'Test error';
    });

    const tasks = [
      { goal: 'task 1', context: '', role: 'coder', status: 'pending' as const }
    ];

    await (orch as any).executePlan('plan', tasks, 0);

    expect(callCount).toBe(2);
    expect(askLineMock).toHaveBeenCalledTimes(2);
    expect(abortController.signal.aborted).toBe(true);
  });
});

