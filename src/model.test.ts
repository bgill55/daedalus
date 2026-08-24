import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createModelFunctions, abortTurn, resetTurnAborted, detectRepetition } from './model.js';
import { setSessionTodos } from './tools/builtin/todo.js';
import type { ToolContext, ChatMessage } from './types.js';
import type { DaedalusConfig } from './config/index.js';
import type { LocalRouter } from './router/index.js';

const TEST_CONFIG = { ui: { showTokens: false } } as unknown as DaedalusConfig;

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
      config: TEST_CONFIG,
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
      config: TEST_CONFIG,
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
                function: { name: 'write_file', arguments: '{"path":"foo.ts"}' },
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

    const askLine = vi.fn().mockResolvedValueOnce('y').mockResolvedValueOnce('n');
    const buildFileContext = () => '';

    const executorMod = await import('./tools/executor.js');
    vi.spyOn(executorMod, 'executeToolCalls').mockResolvedValue([{
      toolCallId: 'call_1',
      name: 'write_file',
      success: true,
      content: 'file content'
    }]);

    const { callModelWithTools } = createModelFunctions({
      messages,
      config: TEST_CONFIG,
      router,
      toolContext,
      buildFileContext,
      askLine,
    });

    const result = await callModelWithTools('write foo.ts');

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
      config: TEST_CONFIG,
      router,
      toolContext,
      buildFileContext,
      askLine,
    });

    const result = await callModelWithTools('loop test');
    expect(result).toBeDefined();

    delete process.env.DAEDALUS_AUTO_APPROVE;

    expect(chatStreamMock).toHaveBeenCalledTimes(4);

    const warningMessage = messages.find(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[SYSTEM WARNING]'));
    expect(warningMessage).toBeDefined();
  });
});

describe('Tool failure handling', () => {
  const MAX_TOOL_TURNS = 40;
  let messages: ChatMessage[];
  let toolContext: ToolContext;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

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
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function toolStream(name: string, args: string) {
    return {
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', function: { name, arguments: args } },
                ],
              },
              finish_reason: null,
            },
          ],
        };
        yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
      },
    };
  }

  function contentStream(text: string) {
    return {
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: text }, finish_reason: 'stop' }] };
      },
    };
  }

  function makeRouter(chatStreamMock: ReturnType<typeof vi.fn>) {
    return {
      chatStream: chatStreamMock,
      chat: { completions: { create: vi.fn() } },
      lastRoutedModel: 'test-model',
    } as unknown as LocalRouter;
  }

  function consoleOutput(): string {
    return consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
  }

  it('echoes the actual tool error and fix-up line on failure', async () => {
    process.env.DAEDALUS_AUTO_APPROVE = 'true';

    const chatStreamMock = vi.fn()
      .mockResolvedValueOnce(toolStream('terminal', '{"command":"foo"}'))
      .mockResolvedValueOnce(contentStream('done.'));

    const executorMod = await import('./tools/executor.js');
    vi.spyOn(executorMod, 'executeToolCalls').mockResolvedValue([{
      toolCallId: 'call_1',
      name: 'terminal',
      success: false,
      content: '',
      error: 'command not found: foo\n\nExit code 127',
    }]);

    const { callModelWithTools } = createModelFunctions({
      messages,
      config: TEST_CONFIG,
      router: makeRouter(chatStreamMock),
      toolContext,
      buildFileContext: () => '',
      askLine: vi.fn().mockResolvedValue('y'),
    });

    const result = await callModelWithTools('run foo');
    const output = consoleOutput();

    expect(output).toContain("[RETRY] terminal didn't apply — command not found: foo");
    expect(output).toContain('[SELF-CORRECT] Adjusting approach and retrying...');
    const toolMessage = messages.find(m => m.role === 'tool')!;
    expect(typeof toolMessage.content).toBe('string');
    expect(String(toolMessage.content)).toContain('[Tool Error] command not found: foo');
    expect(result.content).toBe('done.');
    delete process.env.DAEDALUS_AUTO_APPROVE;
  });

  it('prints todo progress to the console', async () => {
    process.env.DAEDALUS_AUTO_APPROVE = 'true';
    setSessionTodos('test', [
      { id: '1', content: 'Setup project', status: 'completed' },
      { id: '2', content: 'Add validation', status: 'in_progress' },
      { id: '3', content: 'Write tests', status: 'pending' },
    ]);

    const chatStreamMock = vi.fn()
      .mockResolvedValueOnce(toolStream('todo', '{"todos":[{"id":"2","content":"Add validation","status":"completed"}]}'))
      .mockResolvedValueOnce(contentStream('done.'));

    const executorMod = await import('./tools/executor.js');
    vi.spyOn(executorMod, 'executeToolCalls').mockResolvedValue([{
      toolCallId: 'call_1',
      name: 'todo',
      success: true,
      content: 'Todo list (3 items):',
    }]);

    const { callModelWithTools } = createModelFunctions({
      messages,
      config: TEST_CONFIG,
      router: makeRouter(chatStreamMock),
      toolContext,
      buildFileContext: () => '',
      askLine: vi.fn().mockResolvedValue('y'),
    });

    const result = await callModelWithTools('do the work');
    const output = consoleOutput();

    expect(output).toContain('[TODO] Progress: 1/3 completed');
    expect(output).toContain('Active: Add validation');
    expect(result.content).toBe('done.');
    setSessionTodos('test', []);
    delete process.env.DAEDALUS_AUTO_APPROVE;
  });

  it('escalates to the next model after repeated tool failures', async () => {
    process.env.DAEDALUS_AUTO_APPROVE = 'true';

    const chatStreamMock = vi.fn()
      .mockResolvedValueOnce(toolStream('terminal', '{"command":"npm run build"}'))
      .mockResolvedValueOnce(toolStream('terminal', '{"command":"npm run build"}'))
      .mockResolvedValueOnce(toolStream('terminal', '{"command":"npm run build"}'))
      .mockResolvedValueOnce(contentStream('done.'));

    const escalateRouter = {
      chatStream: chatStreamMock,
      chat: { completions: { create: vi.fn() } },
      lastRoutedModelName: 'weak-model',
      lastRoutedModel: 'weak-model (gpt-oss-120b)',
      getConfig: () => ({ autoEscalate: true }),
      getNextModel: () => ({ name: 'strong-model', model: 'kimi-k2.6' }),
    } as unknown as LocalRouter;

    const executorMod = await import('./tools/executor.js');
    vi.spyOn(executorMod, 'executeToolCalls').mockResolvedValue([{
      toolCallId: 'call_1',
      name: 'terminal',
      success: false,
      content: '',
      error: 'Exit code: 1',
    }]);

    const { callModelWithTools } = createModelFunctions({
      messages,
      config: TEST_CONFIG,
      router: escalateRouter,
      toolContext,
      buildFileContext: () => '',
      askLine: vi.fn().mockResolvedValue('y'),
    });

    const result = await callModelWithTools('build the app');
    const output = consoleOutput();

    expect(output).toContain('[ROUTE]');
    expect(output).toContain('Stepping up to a more capable model strong-model');
    const fourthCallModel = chatStreamMock.mock.calls[3]?.[0]?.model;
    expect(fourthCallModel).toBe('strong-model');
    expect(result.content).toBe('done.');
    delete process.env.DAEDALUS_AUTO_APPROVE;
  });

  it('does NOT escalate when the only failure is a terminal circuit breaker', async () => {
    process.env.DAEDALUS_AUTO_APPROVE = 'true';

    const chatStreamMock = vi.fn()
      .mockResolvedValueOnce(toolStream('terminal', '{"command":"cd /d/x && npx tsx src/server.ts & sleep 3"}'))
      .mockResolvedValueOnce(toolStream('terminal', '{"command":"cd /d/x && npx tsx src/server.ts & sleep 3"}'))
      .mockResolvedValueOnce(toolStream('terminal', '{"command":"cd /d/x && npx tsx src/server.ts & sleep 3"}'))
      .mockResolvedValueOnce(contentStream('done.'));

    const router = {
      chatStream: chatStreamMock,
      chat: { completions: { create: vi.fn() } },
      lastRoutedModelName: 'auto-model',
      lastRoutedModel: 'auto-model (auto)',
      getConfig: () => ({ autoEscalate: true }),
      getNextModel: () => ({ name: 'strong-model', model: 'kimi-k2.6' }),
    } as unknown as LocalRouter;

    const executorMod = await import('./tools/executor.js');
    vi.spyOn(executorMod, 'executeToolCalls').mockResolvedValue([{
      toolCallId: 'call_1',
      name: 'terminal',
      success: false,
      content: '',
      error: "[CIRCUIT BREAKER] command 'cd' failed 2 consecutive times.",
    }]);

    const { callModelWithTools } = createModelFunctions({
      messages,
      config: TEST_CONFIG,
      router,
      toolContext,
      buildFileContext: () => '',
      askLine: vi.fn().mockResolvedValue('y'),
    });

    await callModelWithTools('build the app');
    const output = consoleOutput();

    // The terminal circuit breaker must NOT trigger a model STEP-UP (the costly gpt-oss ->
    // llama-4 -> deepseek swap churn). A complexity reclassification ([ROUTE] Reclassified ...)
    // is fine; the stronger-model escalation message is what we forbid here.
    expect(output).not.toContain('Stepping up to a more capable model');
    delete process.env.DAEDALUS_AUTO_APPROVE;
  });

  it('stateful [CHECK] guard fires once then lets the turn close (no re-verify loop)', async () => {
    process.env.DAEDALUS_AUTO_APPROVE = 'true';
    // An unsubstantiated deliverables checklist with NO todo list and NO disk work.
    const claim = 'Current State:\n✅ Fixed the parser\n✅ Added rate limiting\n✅ Updated README';
    const chatStreamMock = vi.fn()
      .mockResolvedValueOnce(contentStream(claim))
      .mockResolvedValueOnce(contentStream(claim))
      .mockResolvedValueOnce(contentStream(claim));

    const { callModelWithTools } = createModelFunctions({
      messages,
      config: TEST_CONFIG,
      router: makeRouter(chatStreamMock),
      toolContext,
      buildFileContext: () => '',
      askLine: vi.fn().mockResolvedValue('y'),
    });

    const result = await callModelWithTools('make the project more outstanding');
    const output = consoleOutput();
    // The guard fires on the first pass, then stateful tracking prevents re-firing on the
    // identical re-emitted claim, so the turn must close (not loop forever).
    expect(output).toContain('[CHECK]');
    expect(result.content).toContain('✅');
    delete process.env.DAEDALUS_AUTO_APPROVE;
  });

  it('classifies task complexity and passes it to the router', async () => {
    process.env.DAEDALUS_AUTO_APPROVE = 'true';



    const chatStreamMock = vi.fn()
      .mockResolvedValueOnce(toolStream('read_file', '{"path":"a.ts"}'))
      .mockResolvedValueOnce(contentStream('done.'));

    const executorMod = await import('./tools/executor.js');
    vi.spyOn(executorMod, 'executeToolCalls').mockResolvedValue([{
      toolCallId: 'call_1',
      name: 'read_file',
      success: true,
      content: 'export const a = 1;',
    }]);

    const { callModelWithTools } = createModelFunctions({
      messages,
      config: TEST_CONFIG,
      router: makeRouter(chatStreamMock),
      toolContext,
      buildFileContext: () => '',
      askLine: vi.fn().mockResolvedValue('y'),
    });

    process.env.DAEDALUS_DEBUG = 'true';

    await callModelWithTools('Refactor the module and implement the new API');

    const firstCall = chatStreamMock.mock.calls[0]?.[0];
    expect(firstCall.complexity).toBe('complex');
    expect(consoleOutput()).toContain('[ROUTE] Task classified as complex');
    delete process.env.DAEDALUS_AUTO_APPROVE;
    delete process.env.DAEDALUS_DEBUG;
  });

  it('stops after 5 consecutive tool failures', async () => {
    process.env.DAEDALUS_AUTO_APPROVE = 'true';

    let callCount = 0;
    const chatStreamMock = vi.fn().mockImplementation(() => toolStream('terminal', `{"command":"fix${++callCount}"}`));

    const executorMod = await import('./tools/executor.js');
    vi.spyOn(executorMod, 'executeToolCalls').mockResolvedValue([{
      toolCallId: 'call_1',
      name: 'terminal',
      success: false,
      content: '',
      error: 'command not found',
    }]);

    const { callModelWithTools } = createModelFunctions({
      messages,
      config: TEST_CONFIG,
      router: makeRouter(chatStreamMock),
      toolContext,
      buildFileContext: () => '',
      askLine: vi.fn().mockResolvedValue('y'),
    });

    const result = await callModelWithTools('test');
    const output = consoleOutput();

    expect(chatStreamMock).toHaveBeenCalledTimes(5);
    expect(output).toContain('[DONE] Concluding after repeated tool failures — see summary above.');
    const warning = messages.find(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[SYSTEM WARNING]'));
    expect(warning).toBeDefined();
    expect(result.content).toBe('');
    expect(result.toolCalls).toEqual([]);
    delete process.env.DAEDALUS_AUTO_APPROVE;
  });

  it('guides the agent out of a syntax-error-revert loop without escalating', async () => {
    process.env.DAEDALUS_AUTO_APPROVE = 'true';

    let callCount = 0;
    const chatStreamMock = vi.fn().mockImplementation(() => {
      callCount++;
      // Vary the broken content each turn to simulate a model re-attempting the
      // same edit with different invalid syntax (not identical calls), which is
      // what slips past the repetitive-identical-loop detector in the wild.
      return toolStream('write_file', `{"path":"a.ts","content":"export const x${callCount} = ("}`);
    });

    const executorMod = await import('./tools/executor.js');
    vi.spyOn(executorMod, 'executeToolCalls').mockResolvedValue([{
      toolCallId: 'call_1',
      name: 'write_file',
      success: false,
      content: '',
      error: 'Syntax error in a.ts — file reverted',
    }]);

    const { callModelWithTools } = createModelFunctions({
      messages,
      config: TEST_CONFIG,
      router: makeRouter(chatStreamMock),
      toolContext,
      buildFileContext: () => '',
      askLine: vi.fn().mockResolvedValue('y'),
    });

    const result = await callModelWithTools('test');
    const output = consoleOutput();

    // Does NOT escalate to a stronger model for a syntax loop
    expect(output).not.toContain('[ROUTE]');
    // Injects the targeted syntax-loop guidance
    const warning = messages.find(m => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('STOP rewriting the whole file'));
    expect(warning).toBeDefined();
    // Still halts rather than looping forever
    expect(output).toContain('[DONE] Concluding after repeated tool failures — see summary above.');
    expect(result.toolCalls).toEqual([]);
    delete process.env.DAEDALUS_AUTO_APPROVE;
  });

  it('does not escalate when a patch trips the circuit breaker (DB cleanup loop)', async () => {
    process.env.DAEDALUS_AUTO_APPROVE = 'true';

    let callCount = 0;
    const chatStreamMock = vi.fn().mockImplementation(() => {
      callCount++;
      return toolStream('patch', `{"path":"db.ts","old_string":"x${callCount}","new_string":"y${callCount}"}`);
    });

    const executorMod = await import('./tools/executor.js');
    vi.spyOn(executorMod, 'executeToolCalls').mockResolvedValue([{
      toolCallId: 'call_1',
      name: 'patch',
      success: false,
      content: '',
      error: '[CIRCUIT BREAKER] patch failed 2 consecutive times on db.ts. Use read_file to inspect the current state and reconstruct your patch from the actual content.',
    }]);

    const { callModelWithTools } = createModelFunctions({
      messages,
      config: TEST_CONFIG,
      router: makeRouter(chatStreamMock),
      toolContext,
      buildFileContext: () => '',
      askLine: vi.fn().mockResolvedValue('y'),
    });

    const result = await callModelWithTools('test');
    const output = consoleOutput();

    // The circuit-breaker message must NOT trigger model escalation
    expect(output).not.toContain('[ROUTE]');
    // The targeted guidance (re-read + minimal patch) must be injected
    const warning = messages.find(m => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('STOP rewriting the whole file'));
    expect(warning).toBeDefined();
    // Still halts rather than looping forever
    expect(output).toContain('[DONE] Concluding after repeated tool failures — see summary above.');
    expect(result.toolCalls).toEqual([]);
    delete process.env.DAEDALUS_AUTO_APPROVE;
  });

  it('stops on repeated failures of the same operation even with interleaved successes', async () => {
    process.env.DAEDALUS_AUTO_APPROVE = 'true';

    let callCount = 0;
    const chatStreamMock = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount % 2 === 0) return toolStream('read_file', '{"path":"a.ts"}');
      return toolStream('patch', '{"path":"a.ts","old_string":"x","new_string":"y"}');
    });

    const executorMod = await import('./tools/executor.js');
    vi.spyOn(executorMod, 'executeToolCalls').mockImplementation(async (calls: any[]) => {
      return calls.map((c) => ({
        toolCallId: c.id,
        name: c.function.name,
        success: c.function.name !== 'patch',
        content: c.function.name === 'patch' ? '' : 'ok',
        error: c.function.name === 'patch' ? 'stale read' : undefined,
      }));
    });

    const { callModelWithTools } = createModelFunctions({
      messages,
      config: TEST_CONFIG,
      router: makeRouter(chatStreamMock),
      toolContext,
      buildFileContext: () => '',
      askLine: vi.fn().mockResolvedValue('y'),
    });

    const result = await callModelWithTools('test');
    const output = consoleOutput();

    expect(chatStreamMock).toHaveBeenCalledTimes(9);
    expect(output).toContain('[DONE] Concluding after repeated tool failures — see summary above.');
    expect(output).toContain("[RETRY] patch didn't apply — stale read");
    expect(result.content).toBe('');
    expect(result.toolCalls).toEqual([]);
    delete process.env.DAEDALUS_AUTO_APPROVE;
  });

  it('continues with a fresh turn budget when the user asks to continue', async () => {
    process.env.DAEDALUS_AUTO_APPROVE = 'true';
    const origIsTTY = (process.stdin as any).isTTY;
    (process.stdin as any).isTTY = true;

    let streamCount = 0;
    const chatStreamMock = vi.fn().mockImplementation(() => {
      streamCount++;
      if (streamCount <= MAX_TOOL_TURNS) {
        const args = streamCount % 2 === 0 ? '{"path":"a.ts"}' : '{"path":"b.ts"}';
        return toolStream('read_file', args);
      }
      return contentStream('done.');
    });

    const executorMod = await import('./tools/executor.js');
    vi.spyOn(executorMod, 'executeToolCalls').mockResolvedValue([{
      toolCallId: 'call_1',
      name: 'read_file',
      success: true,
      content: 'file content',
    }]);

    const askLine = vi.fn().mockResolvedValue('y');
    // Seed an in-progress todo so the resume path prints a [TODO] Progress line
    // (kills the blank gap the user saw between "[OK] Continuing" and the next output).
    setSessionTodos('test', [
      { id: '1', content: 'Sprint 5: Usage analytics - src/db.ts', status: 'completed' },
      { id: '2', content: 'Sprint 6: Bulk operations', status: 'in_progress' },
      { id: '3', content: 'Sprint 7: Accessibility', status: 'in_progress' },
    ]);
    const { callModelWithTools } = createModelFunctions({
      messages,
      config: TEST_CONFIG,
      router: makeRouter(chatStreamMock),
      toolContext,
      buildFileContext: () => '',
      askLine,
    });

    try {
      const result = await callModelWithTools('test');
      const output = consoleOutput();

      expect(askLine).toHaveBeenCalledWith(expect.stringContaining('Continue working?'));
      expect(chatStreamMock).toHaveBeenCalledTimes(MAX_TOOL_TURNS + 1);
      expect(output).toContain('Reached max tool turns (40). Pausing to checkpoint.');
      expect(output).toContain('[SUMMARY] 40 tool call(s) executed: read_file');
      expect(output).toContain('[OK] Continuing with a fresh turn budget.');
      // Resume must surface progress immediately (no silent blank gap while thinking).
      expect(output).toContain('[TODO] Progress: 1/3 completed');
      expect(output).toContain('Active: Sprint 6: Bulk operations');
      expect(result.content).toBe('done.');
    } finally {
      (process.stdin as any).isTTY = origIsTTY;
      delete process.env.DAEDALUS_AUTO_APPROVE;
    }
  });

  it('stops with a resume hint when not a TTY at the max turn budget', async () => {
    process.env.DAEDALUS_AUTO_APPROVE = 'true';

    let streamCount = 0;
    const chatStreamMock = vi.fn().mockImplementation(() => {
      streamCount++;
      if (streamCount <= MAX_TOOL_TURNS) {
        const args = streamCount % 2 === 0 ? '{"path":"a.ts"}' : '{"path":"b.ts"}';
        return toolStream('read_file', args);
      }
      return contentStream('done.');
    });

    const executorMod = await import('./tools/executor.js');
    vi.spyOn(executorMod, 'executeToolCalls').mockResolvedValue([{
      toolCallId: 'call_1',
      name: 'read_file',
      success: true,
      content: 'file content',
    }]);

    const { callModelWithTools } = createModelFunctions({
      messages,
      config: TEST_CONFIG,
      router: makeRouter(chatStreamMock),
      toolContext,
      buildFileContext: () => '',
      askLine: vi.fn().mockResolvedValue('y'),
    });

    const result = await callModelWithTools('test');
    const output = consoleOutput();

    expect(chatStreamMock).toHaveBeenCalledTimes(MAX_TOOL_TURNS);
    expect(output).toContain('[INFO] Stopping. Type "continue" to resume.');
    expect(result.content).toBe('');
    delete process.env.DAEDALUS_AUTO_APPROVE;
  });
});

describe('detectRepetition', () => {
  it('does NOT flag a legitimate report with repeated table-column boilerplate', () => {
    // A real audit lists dependencies in a table; a column value like
    // "Healthy - actively maintained" repeats once per row. This must NOT trip
    // the breaker (the 30->60 char floor fixes the false positive).
    const table = Array.from(
      { length: 11 },
      (_, i) => `| dep${i} | ^1.${i}.0 | runtime | Healthy - actively maintained |`,
    ).join('\n');
    const report = `Comprehensive Codebase Audit\n\n## Dependency Analysis\n${table}\n\n## Top 5 Recommendations\n1. Item\n2. Item`;
    expect(detectRepetition(report)).toBe(false);
  });

  it('flags a genuine loop: a long verbatim span repeated 3+ times', () => {
    const span = 'The previous analysis concluded the module is sound and requires no changes and the same holds for the adjacent module which is also sound.';
    const loop = `${span}\n${span}\n${span}`;
    expect(detectRepetition(loop)).toBe(true);
  });

  it('flags a paragraph repeated 3+ times (Check 1)', () => {
    const para = 'We have finished reviewing the file and found no issues that require changes at this time.';
    const loop = `${para}\n\n${para}\n\n${para}`;
    expect(detectRepetition(loop)).toBe(true);
  });

  it('does not flag short text', () => {
    expect(detectRepetition('short')).toBe(false);
  });
});
