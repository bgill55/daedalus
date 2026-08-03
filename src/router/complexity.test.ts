import { describe, it, expect } from 'vitest';
import { classifyTaskStart, stepRouting } from './complexity.js';
import type { RoutingState } from './complexity.js';
import type { TaskComplexity } from './types.js';

describe('classifyTaskStart', () => {
  it('classifies a tiny trivial edit as simple', () => {
    expect(classifyTaskStart('add a missing comma to line 5')).toBe('simple');
    expect(classifyTaskStart('fix the typo in the README')).toBe('simple');
  });

  it('classifies a large prompt as complex', () => {
    const big = 'Implement the following feature in full detail. '.repeat(1200);
    expect(classifyTaskStart(big)).toBe('complex');
  });

  it('classifies multi-file work as complex', () => {
    expect(classifyTaskStart('Update src/a.ts, src/b.ts, and src/c.ts to use the new API')).toBe('complex');
  });

  it('classifies prompts with complex keywords as complex', () => {
    expect(classifyTaskStart('Refactor the routing module and implement proper retry logic')).toBe('complex');
    expect(classifyTaskStart('Architect a multi-agent orchestration layer')).toBe('complex');
  });

  it('classifies audit, sprint, and todo-list requests as complex', () => {
    expect(classifyTaskStart('just do an audit of the project and give me a starting point')).toBe('complex');
    expect(classifyTaskStart('go ahead and make a todo list and lets knock those out in sprints')).toBe('complex');
    expect(classifyTaskStart('prioritize the outstanding issues for this sprint')).toBe('complex');
  });

  it('classifies multi-sentence natural phrasing as complex without any keywords', () => {
    expect(classifyTaskStart('Look at the project. Tell me what is wrong. Fix the worst issues.')).toBe('complex');
    expect(classifyTaskStart('this is a mess. can you clean it up for me.')).toBe('complex');
  });

  it('keeps single-sentence natural phrasing on the standard tier', () => {
    expect(classifyTaskStart('make this better')).toBe('standard');
    expect(classifyTaskStart('can you look at this project and tell me what it needs')).toBe('standard');
  });

  it('returns standard for medium-sized ambiguous prompts', () => {
    expect(classifyTaskStart('can you look at this project and tell me what it needs')).toBe('standard');
  });

  it('honors forceComplex', () => {
    expect(classifyTaskStart('add a comma', { forceComplex: true })).toBe('complex');
  });

  it('defaults to standard for short prompts without explicit signals', () => {
    expect(classifyTaskStart('change the port to 3000')).toBe('standard');
  });
});

describe('stepRouting', () => {
  const fresh = (current: TaskComplexity): RoutingState => ({ current, totalCompletionTokens: 0, trivialTurnStreak: 0 });

  it('upgrades to complex on heavy cumulative output', () => {
    const st = stepRouting(fresh('standard'), { completionTokensThisTurn: 9000, writesThisTurn: 1, toolCallsThisTurn: 3, failedToolsThisTurn: 0 });
    expect(st.current).toBe('complex');
  });

  it('upgrades to complex on repeated tool failures', () => {
    const st = stepRouting(fresh('standard'), { completionTokensThisTurn: 1000, writesThisTurn: 0, toolCallsThisTurn: 2, failedToolsThisTurn: 3 });
    expect(st.current).toBe('complex');
  });

  it('upgrades to complex on a very long tool chain', () => {
    const st = stepRouting(fresh('standard'), { completionTokensThisTurn: 2000, writesThisTurn: 0, toolCallsThisTurn: 25, failedToolsThisTurn: 0 });
    expect(st.current).toBe('complex');
  });

  it('upgrades simple to standard on moderate output', () => {
    const st = stepRouting(fresh('simple'), { completionTokensThisTurn: 3000, writesThisTurn: 0, toolCallsThisTurn: 1, failedToolsThisTurn: 0 });
    expect(st.current).toBe('standard');
  });

  it('keeps current tier when signals are weak', () => {
    const st = stepRouting(fresh('standard'), { completionTokensThisTurn: 800, writesThisTurn: 0, toolCallsThisTurn: 1, failedToolsThisTurn: 0 });
    expect(st.current).toBe('standard');
  });

  it('downgrades complex to standard after enough trivial turns and resets the token ratchet', () => {
    const st = stepRouting({ current: 'complex', totalCompletionTokens: 2000, trivialTurnStreak: 2 }, { completionTokensThisTurn: 100, writesThisTurn: 0, toolCallsThisTurn: 1, failedToolsThisTurn: 0 });
    expect(st.current).toBe('standard');
    expect(st.totalCompletionTokens).toBe(0);
  });

  it('downgrades standard to simple after enough trivial turns', () => {
    const st = stepRouting({ current: 'standard', totalCompletionTokens: 600, trivialTurnStreak: 2 }, { completionTokensThisTurn: 100, writesThisTurn: 0, toolCallsThisTurn: 1, failedToolsThisTurn: 0 });
    expect(st.current).toBe('simple');
    expect(st.hasDowngraded).toBe(true);
  });

  it('blocks cascading downgrades within one turn (complex → standard only)', () => {
    let st = stepRouting({ current: 'complex', totalCompletionTokens: 2000, trivialTurnStreak: 2 }, { completionTokensThisTurn: 100, writesThisTurn: 0, toolCallsThisTurn: 1, failedToolsThisTurn: 0 });
    expect(st.current).toBe('standard');
    expect(st.hasDowngraded).toBe(true);
    for (let i = 0; i < 6; i++) {
      st = stepRouting(st, { completionTokensThisTurn: 100, writesThisTurn: 0, toolCallsThisTurn: 1, failedToolsThisTurn: 0 });
    }
    expect(st.current).toBe('standard');
    expect(st.hasDowngraded).toBe(true);
  });

  it('does not downgrade below simple', () => {
    const st = stepRouting({ current: 'simple', totalCompletionTokens: 300, trivialTurnStreak: 9 }, { completionTokensThisTurn: 100, writesThisTurn: 0, toolCallsThisTurn: 1, failedToolsThisTurn: 0 });
    expect(st.current).toBe('simple');
  });

  it('holds complex tier on trivial turns before hysteresis threshold', () => {
    const st = stepRouting({ current: 'complex', totalCompletionTokens: 2000, trivialTurnStreak: 1 }, { completionTokensThisTurn: 100, writesThisTurn: 0, toolCallsThisTurn: 1, failedToolsThisTurn: 0 });
    expect(st.current).toBe('complex');
  });

  it('resets the trivial streak when a write occurs', () => {
    const st = stepRouting({ current: 'standard', totalCompletionTokens: 0, trivialTurnStreak: 2 }, { completionTokensThisTurn: 200, writesThisTurn: 1, toolCallsThisTurn: 1, failedToolsThisTurn: 0 });
    expect(st.current).toBe('standard');
    expect(st.trivialTurnStreak).toBe(0);
  });

  it('does not re-upgrade to complex immediately after a downgrade', () => {
    const st = stepRouting({ current: 'complex', totalCompletionTokens: 15857, trivialTurnStreak: 2 }, { completionTokensThisTurn: 100, writesThisTurn: 0, toolCallsThisTurn: 1, failedToolsThisTurn: 0 });
    expect(st.current).toBe('standard');
    expect(st.totalCompletionTokens).toBe(0);
    const next = stepRouting(st, { completionTokensThisTurn: 100, writesThisTurn: 1, toolCallsThisTurn: 1, failedToolsThisTurn: 0 });
    expect(next.current).toBe('standard');
  });

  it('re-upgrades to complex only after significant fresh output post-downgrade', () => {
    let st = stepRouting({ current: 'complex', totalCompletionTokens: 15857, trivialTurnStreak: 2 }, { completionTokensThisTurn: 100, writesThisTurn: 0, toolCallsThisTurn: 1, failedToolsThisTurn: 0 });
    expect(st.current).toBe('standard');
    st = stepRouting(st, { completionTokensThisTurn: 8500, writesThisTurn: 1, toolCallsThisTurn: 5, failedToolsThisTurn: 0 });
    expect(st.current).toBe('complex');
  });

  it('escalates to complex when a weak model narrates a plan but makes no real tool calls', () => {
    const st = stepRouting(fresh('standard'), {
      completionTokensThisTurn: 200,
      writesThisTurn: 0,
      toolCallsThisTurn: 0,
      failedToolsThisTurn: 0,
      toolMentionsThisTurn: 4,
    });
    expect(st.current).toBe('complex');
  });

  it('does not escalate on tool mentions when real tool calls were made', () => {
    const st = stepRouting(fresh('standard'), {
      completionTokensThisTurn: 200,
      writesThisTurn: 0,
      toolCallsThisTurn: 3,
      failedToolsThisTurn: 0,
      toolMentionsThisTurn: 5,
    });
    expect(st.current).toBe('standard');
  });

  it('does not escalate on few tool mentions', () => {
    const st = stepRouting(fresh('standard'), {
      completionTokensThisTurn: 200,
      writesThisTurn: 0,
      toolCallsThisTurn: 0,
      failedToolsThisTurn: 0,
      toolMentionsThisTurn: 2,
    });
    expect(st.current).toBe('standard');
  });
});
