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
    toolContext.patchHistory = [
      { filePath: '/tmp/cli.ts', oldContent: '', newContent: '', timestamp: Date.now(), description: 'wrote file' },
    ];
    const { router: localRouter, chatMock: localChatMock } = createMockRouter(['Updated the CLI entrypoint.']);
    const orch = new Orchestrator(localRouter, messages, toolContext);
    await (orch as any).delegateTask({ goal: 'implement a tiny CLI utility', context: '', role: 'coder' });
    expect(localChatMock).toHaveBeenCalled();
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
    toolContext.patchHistory = [
      { filePath: '/tmp/cli.ts', oldContent: '', newContent: '', timestamp: Date.now(), description: 'wrote file' },
    ];
    chatMock = vi.fn();
    chatMock.mockImplementationOnce(() =>
      Promise.resolve({
        choices: [{ message: { content: 'Failed to write initial file.', tool_calls: null } }],
      } as any),
    );
    chatMock.mockImplementationOnce(() =>
      Promise.resolve({
        choices: [{ message: { content: 'Created the CLI entrypoint and supporting files.', tool_calls: null } }],
      } as any),
    );

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
});
