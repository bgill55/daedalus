import { describe, it, expect } from 'vitest';
import { accumulatePipedLines } from './repl.js';

describe('accumulatePipedLines (piped multi-line input)', () => {
  it('preserves ALL lines — does NOT truncate to the first line', () => {
    const { result, done } = accumulatePipedLines([
      'Execute these steps IN ORDER:',
      'STEP 1: run the scanner',
      'STEP 2: inspect src/',
      'STEP 3: open the issue',
    ]);
    expect(done).toBe(false);
    expect(result).toContain('STEP 1');
    expect(result).toContain('STEP 2');
    expect(result).toContain('STEP 3');
    expect(result.split('\n')).toHaveLength(4);
  });

  it('excludes the terminator sentinel and stops at it', () => {
    const { result, done } = accumulatePipedLines([
      'STEP 1: scan',
      'STEP 2: report',
      'exit',
      'STEP 3: this should be dropped',
    ]);
    expect(done).toBe(true);
    expect(result).toContain('STEP 1');
    expect(result).toContain('STEP 2');
    expect(result).not.toContain('STEP 3');
    expect(result).not.toContain('exit');
  });

  it('returns the full prompt when no terminator is sent (EOF path)', () => {
    const { result, done } = accumulatePipedLines(['line one', 'line two']);
    expect(done).toBe(false);
    expect(result).toBe('line one\nline two');
  });

  it('supports a custom terminator', () => {
    const { result, done } = accumulatePipedLines(['a', 'DONE', 'b'], 'DONE');
    expect(done).toBe(true);
    expect(result).toBe('a');
  });
});

describe('createRepl one-shot mode (--goal)', () => {
  it('runs exactly one autonomous turn and returns without reading stdin', async () => {
    const calls: string[] = [];
    const deps = {
      config: { safety: {}, agents: {}, indexing: { enabled: false } } as unknown as import('./config/index.js').DaedalusConfig,
      configDir: '/tmp/daedalus-test',
      cliTempDir: '/tmp/daedalus-test',
      router: {} as unknown as import('./router/index.js').LocalRouter,
      sessionManager: {
        sessionId: 's1',
        projectHash: 'ph1',
        saveSessionState: () => {},
        projectMemDb: null,
      } as unknown as import('./session/manager.js').SessionManager,
      userProfile: {} as import('./profile.js').UserProfile,
      messages: [] as import('./types.js').ChatMessage[],
      activeFiles: new Map<string, string>(),
      toolContext: {} as import('./types.js').ToolContext,
      getSystemPromptWithMemory: async () => 'system',
      callModelWithTools: async (content: string) => { calls.push(content); return { content: 'done', toolCalls: [] }; },
      callModelWithFallback: async () => 'fallback',
      getIndexDbPath: () => '/tmp/daedalus-test/index.sqlite',
      projectStackTags: [] as string[],
      oneShotGoal: 'refactor the router',
    } as unknown as Parameters<typeof import('./repl.js').createRepl>[0];

    const chatLoop = (await import('./repl.js')).createRepl(deps);
    await chatLoop();

    // Exactly one turn ran, and it never waited on readline (no second call).
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('refactor the router');
  });
});
