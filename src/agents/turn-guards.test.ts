import { describe, it, expect, vi } from 'vitest';
import { checkTurnCompletionGuards, TurnGuardContext } from './turn-guards.js';
import { ClaimLedger } from './completion-guard.js';
import { ReadStallDetector, DivergenceDetector } from './loop-guards.js';
import type { ChatMessage, ToolContext } from '../types.js';

function createMockContext(overrides: Partial<TurnGuardContext> = {}): TurnGuardContext {
  const toolContext: ToolContext = {
    sessionId: 'test_session',
    projectRoot: '/test/project',
    projectHash: 'hash123',
    activeFiles: new Map<string, string>(),
    agentRole: 'orchestrator',
    abortSignal: new AbortController().signal,
    firedCompletionGuards: new Set<string>(),
  };

  const defaultCtx: TurnGuardContext = {
    cleanContent: 'Everything looks great and all functions work properly.',
    fullContent: 'Everything looks great and all functions work properly.',
    userTask: 'implement feature X',
    messages: [],
    toolContext,
    router: {
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    } as any,
    config: {} as any,
    claimLedger: new ClaimLedger(),
    readStall: new ReadStallDetector(),
    divergence: new DivergenceDetector(),
    readLines: vi.fn().mockReturnValue(['line1', 'line2']),
    fileExists: vi.fn().mockReturnValue(true),
    verifyBreakerTrippedThisTurn: false,
    verifyBreakerTrippedLastTurn: false,
    totalCompletionTokens: 100,
    escalationCount: 0,
    ...overrides,
  };

  return defaultCtx;
}

describe('checkTurnCompletionGuards', () => {
  it('passes when response has no claims or violations', async () => {
    const ctx = createMockContext({
      cleanContent: 'Here is an explanation of how JavaScript event loop works.',
      fullContent: 'Here is an explanation of how JavaScript event loop works.',
    });

    const result = await checkTurnCompletionGuards(ctx);
    expect(result.status).toBe('pass');
  });

  it('triggers divergence check when assistant emits duplicate output', async () => {
    const divergence = new DivergenceDetector();
    const cleanContent = 'This is a long assistant response that provides detailed explanations of how the subsystem works in practice. This text is long enough to exceed 40 characters.';
    divergence.register(cleanContent); // 1st
    divergence.register(cleanContent); // 2nd repeat

    const ctx = createMockContext({
      cleanContent,
      fullContent: cleanContent,
      divergence,
    });

    const result = await checkTurnCompletionGuards(ctx);
    expect(result.status).toBe('halt');
    if (result.status === 'halt') {
      expect(result.content).toContain('[SELF-CORRECT]');
      expect(result.maxTurnsCause).toContain('repetition guard tripped');
    }
  });

  it('flags ungrounded claim when agent makes claims about uninspected file', async () => {
    const claimLedger = new ClaimLedger();
    const cleanContent = 'I checked src/uninspected.ts and found that path is unused.';
    const messages: ChatMessage[] = [];

    const ctx = createMockContext({
      cleanContent,
      fullContent: cleanContent,
      claimLedger,
      messages,
    });

    const result = await checkTurnCompletionGuards(ctx);
    expect(result.status).toBe('continue');
    expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('[SYSTEM WARNING]'))).toBe(true);
  });

  it('flags fabricated test count when test count is asserted without test run', async () => {
    const messages: ChatMessage[] = [];
    const cleanContent = 'All tests passed: 42 tests passing.';

    const ctx = createMockContext({
      cleanContent,
      fullContent: cleanContent,
      messages,
    });
    ctx.toolContext.lastVerifyPassCount = undefined;

    const result = await checkTurnCompletionGuards(ctx);
    expect(result.status).toBe('continue');
    expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('npm test'))).toBe(true);
  });

  it('halts when review is produced with zero file observations', async () => {
    const claimLedger = new ClaimLedger();
    const cleanContent = `## Executive Summary of the Architecture and Tech Stack
1. The project uses Clean Architecture and modular boundaries.
2. The codebase implements solid separation of concerns across multiple layers.

### Key Features & Project Structure
- Subsystem coordination and multi-agent loops are present.
- Memory management persistence engine with SQLite backend.

### Top Recommendations
- Add additional end-to-end integration tests for error boundaries.
- Ensure all modules have comprehensive documentation and type annotations.
This review covers all the main parts of the system thoroughly.`;

    const ctx = createMockContext({
      userTask: 'review this codebase',
      cleanContent,
      fullContent: cleanContent,
      claimLedger,
    });

    const result = await checkTurnCompletionGuards(ctx);
    expect(result.status).toBe('halt');
    if (result.status === 'halt') {
      expect(result.content).toContain('[SELF-CORRECT]');
      expect(result.maxTurnsCause).toContain('review-without-inspection guard');
    }
  });
});
