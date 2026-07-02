import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createModelFunctions, abortTurn, resetTurnAborted } from './model.js';
import type { ToolContext, ChatMessage } from './types.js';
import type { LocalRouter } from './router/index.js';

describe('Single Agent Loop', () => {
  let messages: ChatMessage[];
  let toolContext: ToolContext;

  beforeEach(() => {
    messages = [];
    toolContext = {
      sessionId: 'test',
      projectRoot: process.cwd(),
      projectHash: 'test',
      activeFiles: new Map(),
      agentRole: 'coder',
      abortSignal: new AbortController().signal,
      patchHistory: [],
    } as unknown as ToolContext;
    resetTurnAborted();
  });

  it('respects turnAborted at the start of the turn loop', async () => {
    const chatStreamMock = vi.fn();
    const router = {
      chatStream: chatStreamMock,
      chat: { completions: { create: vi.fn() } },
    } as unknown as LocalRouter;

    const askLine = vi.fn().mockResolvedValue('y');
    const buildFileContext = () => '';

    abortTurn();

    const { callModelWithTools } = createModelFunctions({
      messages,
      config: { ui: { showTokens: false } },
      router,
      toolContext,
      buildFileContext,
      askLine,
    });

    const result = await callModelWithTools('hello');
    expect(result.content).toBe('');
    expect(chatStreamMock).not.toHaveBeenCalled();
  });

  it('adds dummy tool response when a dangerous tool is rejected', async () => {
    const chunk1 = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                function: { name: 'write_file', arguments: '{"path":"foo.ts","content":"hello"}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };

    const chunk2 = {
      choices: [
        {
          delta: {},
          finish_reason: 'tool_calls',
        },
      ],
    };

    const stream = {
      async *[Symbol.asyncIterator]() {
        yield chunk1;
        yield chunk2;
      },
    };

    const chatStreamMock = vi.fn();
    chatStreamMock.mockResolvedValueOnce(stream);
    chatStreamMock.mockResolvedValueOnce({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [
            {
              delta: { content: 'Understood.' },
              finish_reason: 'stop',
            },
          ],
        };
      },
    });

    const router = {
      chatStream: chatStreamMock,
      chat: { completions: { create: vi.fn() } },
      lastRoutedModel: 'test-model',
    } as unknown as LocalRouter;

    const askLine = vi.fn().mockResolvedValue('n');
    const buildFileContext = () => '';

    const { callModelWithTools } = createModelFunctions({
      messages,
      config: { ui: { showTokens: false } },
      router,
      toolContext,
      buildFileContext,
      askLine,
    });

    const result = await callModelWithTools('create a file');
    expect(result.toolCalls).toEqual([]);

    const toolMessage = messages.find(m => m.role === 'tool');
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.tool_call_id).toBe('call_1');
    expect(toolMessage?.content).toBe('Error: Tool execution rejected by user.');
  });

  it('halts execution loop when user says no to proceed gate', async () => {
    const chunk1 = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                function: { name: 'read_file', arguments: '{"path":"foo.ts"}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };

    const chunk2 = {
      choices: [
        {
          delta: {},
          finish_reason: 'tool_calls',
        },
      ],
    };

    const stream = {
      async *[Symbol.asyncIterator]() {
        yield chunk1;
        yield chunk2;
      },
    };

    const chatStreamMock = vi.fn().mockResolvedValueOnce(stream);
    const router = {
      chatStream: chatStreamMock,
      chat: { completions: { create: vi.fn() } },
      lastRoutedModel: 'test-model',
    } as unknown as LocalRouter;

    const askLine = vi.fn().mockResolvedValue('n');
    const buildFileContext = () => '';

    const executorMod = await import('./tools/executor.js');
    vi.spyOn(executorMod, 'executeToolCalls').mockResolvedValue([{
      toolCallId: 'call_1',
      name: 'read_file',
      success: true,
      content: 'file content'
    }]);

    const { callModelWithTools } = createModelFunctions({
      messages,
      config: { ui: { showTokens: false } },
      router,
      toolContext,
      buildFileContext,
      askLine,
    });

    const result = await callModelWithTools('read foo.ts');

    expect(askLine).toHaveBeenCalledWith(expect.stringContaining('Next turn?'));
    expect(chatStreamMock).toHaveBeenCalledTimes(1);
    expect(result.content).toBe('');
  });

  it('detects and terminates repetitive tool-calling loops', async () => {
    process.env.DAEDALUS_AUTO_APPROVE = 'true';

    const chunk1 = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                function: { name: 'read_file', arguments: '{"path":"foo.ts"}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };

    const chunk2 = {
      choices: [
        {
          delta: {},
          finish_reason: 'tool_calls',
        },
      ],
    };

    const stream = {
      async *[Symbol.asyncIterator]() {
        yield chunk1;
        yield chunk2;
      },
    };

    const chatStreamMock = vi.fn().mockResolvedValue(stream);
    const router = {
      chatStream: chatStreamMock,
      chat: { completions: { create: vi.fn() } },
      lastRoutedModel: 'test-model',
    } as unknown as LocalRouter;

    const askLine = vi.fn().mockResolvedValue('y');
    const buildFileContext = () => '';

    const executorMod = await import('./tools/executor.js');
    vi.spyOn(executorMod, 'executeToolCalls').mockResolvedValue([{
      toolCallId: 'call_1',
      name: 'read_file',
      success: true,
      content: 'file content'
    }]);

    const { callModelWithTools } = createModelFunctions({
      messages,
      config: { ui: { showTokens: false } },
      router,
      toolContext,
      buildFileContext,
      askLine,
    });

    const result = await callModelWithTools('loop test');

    delete process.env.DAEDALUS_AUTO_APPROVE;

    expect(chatStreamMock).toHaveBeenCalledTimes(4);

    const warningMessage = messages.find(m => m.role === 'user' && m.content.includes('[SYSTEM WARNING]'));
    expect(warningMessage).toBeDefined();
  });
});
