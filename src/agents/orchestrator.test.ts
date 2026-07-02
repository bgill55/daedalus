import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Orchestrator } from './orchestrator.js';
import type { ToolContext, ChatMessage } from '../types.js';
import type { LocalRouter } from '../router/index.js';
import fs from 'fs';

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

describe('Orchestrator', () => {
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

  it('verifyArtifacts returns false when failure is explicitly declared', async () => {
    const { router: localRouter } = createMockRouter([]);
    const orch = new Orchestrator(localRouter, messages, toolContext);
    expect(await (orch as any).verifyArtifacts('coder', 'implement CLI', 'Failed to write the requested CLI files.')).toBe(false);
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
    // No patchHistory set, so this should fail even with a plausible path in the result
    expect(await (orch as any).verifyArtifacts('coder', 'build web app', 'Wrote /tmp/other_service.ts.')).toBe(false);
  });
});

describe('Orchestrator delegateTask behavior', () => {
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
  let toolContext: ToolContext;
  let messages: ChatMessage[];

  beforeEach(() => {
    messages = [];
    toolContext = baseContext();
  });

  it('parseDelegationTasks extracts goals cleanly without prefixes or colons', () => {
    const plan = `
1. delegate to coder: Implement new API endpoint
- delegate to researcher: Research credentials config
* delegate to reviewer: Code quality check
delegate to debugger: fix tsconfig deprecations
    `;
    const { router: localRouter } = createMockRouter([]);
    const orch = new Orchestrator(localRouter, messages, toolContext);
    const tasks = (orch as any).parseDelegationTasks(plan, 'implement API');

    expect(tasks).toHaveLength(4);
    expect(tasks[0]).toEqual({ role: 'coder', goal: 'Implement new API endpoint', context: 'Original goal: implement API\n', status: 'pending', splitDepth: 0 });
    expect(tasks[1]).toEqual({ role: 'researcher', goal: 'Research credentials config', context: 'Original goal: implement API\n', status: 'pending', splitDepth: 0 });
    expect(tasks[2]).toEqual({ role: 'reviewer', goal: 'Code quality check', context: 'Original goal: implement API\n', status: 'pending', splitDepth: 0 });
    expect(tasks[3]).toEqual({ role: 'debugger', goal: 'fix tsconfig deprecations', context: 'Original goal: implement API\n', status: 'pending', splitDepth: 0 });
  });

  it('parseDelegationTasks extracts prefix-less and bulleted role goals correctly', () => {
    const plan = `
1. coder: Implement OAuth flow
- researcher: check YouTube API
debugger: fix deprecations
* reviewer: inspect code quality
    `;
    const { router: localRouter } = createMockRouter([]);
    const orch = new Orchestrator(localRouter, messages, toolContext);
    const tasks = (orch as any).parseDelegationTasks(plan, 'implement OAuth');

    expect(tasks).toHaveLength(4);
    expect(tasks[0]).toEqual({ role: 'coder', goal: 'Implement OAuth flow', context: 'Original goal: implement OAuth\n', status: 'pending', splitDepth: 0 });
    expect(tasks[1]).toEqual({ role: 'researcher', goal: 'check YouTube API', context: 'Original goal: implement OAuth\n', status: 'pending', splitDepth: 0 });
    expect(tasks[2]).toEqual({ role: 'debugger', goal: 'fix deprecations', context: 'Original goal: implement OAuth\n', status: 'pending', splitDepth: 0 });
    expect(tasks[3]).toEqual({ role: 'reviewer', goal: 'inspect code quality', context: 'Original goal: implement OAuth\n', status: 'pending', splitDepth: 0 });
  });

  it('parseDelegationTasks includes active files list in task context', () => {
    toolContext.activeFiles.set('/path/foo.ts', '/path/foo.ts');
    const plan = `delegate to coder: modify foo.ts`;
    const { router: localRouter } = createMockRouter([]);
    const orch = new Orchestrator(localRouter, messages, toolContext);
    const tasks = (orch as any).parseDelegationTasks(plan, 'modify foo.ts');

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
    expect(executePlanSpy).toHaveBeenCalledWith('planText', tasks, 1, 'goal', expect.any(String));
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

    expect(mockSessionManager.saveState).toHaveBeenCalledWith('orchestrate_task_index', 2);
    expect(mockSessionManager.saveState).toHaveBeenCalledWith('orchestrate_results', []);
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

describe('Orchestrator Loop Engineering features', () => {
  let toolContext: ToolContext;
  let messages: ChatMessage[];

  beforeEach(() => {
    messages = [];
    toolContext = baseContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rollbackTaskPatches reverts patchHistory changes and truncates history', async () => {
    const fsMockWrite = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const fsMockExists = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const { router: localRouter } = createMockRouter([]);
    const orch = new Orchestrator(localRouter, messages, toolContext);

    toolContext.patchHistory = [
      { filePath: 'src/file1.ts', oldContent: 'old1', newContent: 'new1', timestamp: 1, description: 'patch1' },
      { filePath: 'src/file2.ts', oldContent: 'old2', newContent: 'new2', timestamp: 2, description: 'patch2' },
      { filePath: 'src/file3.ts', oldContent: 'old3', newContent: 'new3', timestamp: 3, description: 'patch3' },
    ];

    await (orch as any).rollbackTaskPatches(1);

    expect(fsMockWrite).toHaveBeenCalledTimes(2);
    expect(fsMockWrite).toHaveBeenNthCalledWith(1, 'src/file3.ts', 'old3', 'utf8');
    expect(fsMockWrite).toHaveBeenNthCalledWith(2, 'src/file2.ts', 'old2', 'utf8');
    expect(toolContext.patchHistory).toHaveLength(1);
    expect(toolContext.patchHistory[0].filePath).toBe('src/file1.ts');

    fsMockWrite.mockRestore();
    fsMockExists.mockRestore();
  });

  it('runBuildVerification executes correct detected commands', async () => {
    const fsExistsMock = vi.spyOn(fs, 'existsSync');
    const fsReadMock = vi.spyOn(fs, 'readFileSync');

    // Mock existsSync to return package.json = true, tsconfig.json = true
    fsExistsMock.mockImplementation((p: any) => {
      const pathStr = p.toString();
      if (pathStr.endsWith('package.json')) return true;
      if (pathStr.endsWith('tsconfig.json')) return true;
      return false;
    });

    fsReadMock.mockReturnValue(JSON.stringify({
      scripts: {
        build: 'tsc',
      }
    }));

    mockExec.mockImplementationOnce((cmd, opts, cb) => {
      cb(null, 'build success', '');
    });

    const { router: localRouter } = createMockRouter([]);
    const orch = new Orchestrator(localRouter, messages, toolContext);

    const verifyResult = await (orch as any).runBuildVerification();
    expect(verifyResult.success).toBe(true);
    expect(mockExec).toHaveBeenCalledWith('npx tsc --noEmit', expect.any(Object), expect.any(Function));

    fsExistsMock.mockRestore();
    fsReadMock.mockRestore();
  });

  it('runBuildVerification returns false and captures logs on compile failure', async () => {
    const fsExistsMock = vi.spyOn(fs, 'existsSync');
    const fsReadMock = vi.spyOn(fs, 'readFileSync');

    fsExistsMock.mockImplementation((p: any) => {
      const pathStr = p.toString();
      if (pathStr.endsWith('package.json')) return true;
      if (pathStr.endsWith('tsconfig.json')) return true;
      return false;
    });

    fsReadMock.mockReturnValue(JSON.stringify({
      scripts: {
        build: 'tsc',
      }
    }));

    mockExec.mockImplementationOnce((cmd, opts, cb) => {
      cb(new Error('Compile Error'), 'stdout logs', 'stderr errors');
    });

    const { router: localRouter } = createMockRouter([]);
    const orch = new Orchestrator(localRouter, messages, toolContext);

    const verifyResult = await (orch as any).runBuildVerification();
    expect(verifyResult.success).toBe(false);
    expect(verifyResult.errorLogs).toContain('stdout logs');
    expect(verifyResult.errorLogs).toContain('stderr errors');

    fsExistsMock.mockRestore();
    fsReadMock.mockRestore();
  });

  describe('build check filtering and error hints', () => {
    it('isBuildErrorRelated matches related errors correctly', () => {
      const { router: localRouter } = createMockRouter([]);
      const orch = new Orchestrator(localRouter, messages, toolContext);
      
      const modifiedFiles = [
        'D:/projects/my-app/src/pages/api/download.ts',
        'D:/projects/my-app/src/utils/helpers.ts'
      ];
      
      expect((orch as any).isBuildErrorRelated('Error in download.ts: Cannot find module', modifiedFiles)).toBe(true);
      expect((orch as any).isBuildErrorRelated('Error: Cannot find module in src/pages/api/download.ts', modifiedFiles)).toBe(true);
      expect((orch as any).isBuildErrorRelated('error in HELPERS.ts: strict mode', modifiedFiles)).toBe(true);
      expect((orch as any).isBuildErrorRelated('Error in unrelated.ts: syntax error', modifiedFiles)).toBe(false);
    });

    it('generateBuildErrorHint produces correct hints', () => {
      const { router: localRouter } = createMockRouter([]);
      const orch = new Orchestrator(localRouter, messages, toolContext);
      
      const hint1 = (orch as any).generateBuildErrorHint("Error: Cannot find module 'googleapis' or its types");
      expect(hint1).toContain('googleapis');
      expect(hint1).toContain('npm install googleapis');
      
      const hint2 = (orch as any).generateBuildErrorHint("Duplicate page detected: pages/stats.tsx and src/pages/stats.tsx");
      expect(hint2).toContain('duplicate files in the root pages/ directory');
      
      const hint3 = (orch as any).generateBuildErrorHint("No overload matches this call.");
      expect(hint3).toContain('options as any');
      
      const hint4 = (orch as any).generateBuildErrorHint("Some generic syntax error at line 5");
      expect(hint4).toBe('');
    });
  });
});

