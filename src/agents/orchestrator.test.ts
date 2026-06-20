import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Orchestrator } from './orchestrator.js';
import { createRouter } from '../router/index.js';
import type { ToolContext, ChatMessage } from '../types.js';
import type { LocalRouter } from '../router/index.js';

describe('Orchestrator', () => {
  let mockRouter: LocalRouter;
  let toolContext: ToolContext;
  let messages: ChatMessage[];

  beforeEach(() => {
    const chatMock = vi.fn().mockRejectedValue(new Error('API failure'));
    mockRouter = {
      chat: {
        completions: {
          create: chatMock,
        },
      },
      chatStream: vi.fn().mockRejectedValue(new Error('API failure')),
      chatCompletion: chatMock,
      getModels: vi.fn().mockReturnValue([{ name: 'test', model: 'test' }]),
    } as unknown as LocalRouter;

    toolContext = {
      sessionId: 'test',
      projectRoot: process.cwd(),
      projectHash: 'test',
      activeFiles: new Map(),
      agentRole: 'coder',
      abortSignal: new AbortController().signal,
    } as ToolContext;

    messages = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates instance with router, messages, and context', () => {
    const orch = new Orchestrator(mockRouter, messages, toolContext);
    expect(orch).toBeInstanceOf(Orchestrator);
  });

  it('run method handles errors gracefully', async () => {
    const orch = new Orchestrator(mockRouter, messages, toolContext);
    const result = await orch.run('do something');
    expect(result).toBeTruthy();
  });

  it('synthesize returns formatted output', async () => {
    const orch = new Orchestrator(mockRouter, messages, toolContext);
    const synth = (orch as any).synthesize('test goal');
    expect(synth).toContain('Orchestration Complete');
    expect(synth).toContain('test goal');
  });

});
