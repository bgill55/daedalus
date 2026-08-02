import { describe, it, expect } from 'vitest';
import { classifyTaskStart, reclassifyTurn } from './complexity.js';

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

describe('reclassifyTurn', () => {
  it('upgrades to complex on heavy cumulative output', () => {
    expect(reclassifyTurn('standard', { totalCompletionTokens: 9000, writesThisTurn: 1, toolCallsThisTurn: 3, failedToolsThisTurn: 0, consecutiveTrivialTurns: 0 })).toBe('complex');
  });

  it('upgrades to complex on repeated tool failures', () => {
    expect(reclassifyTurn('standard', { totalCompletionTokens: 1000, writesThisTurn: 0, toolCallsThisTurn: 2, failedToolsThisTurn: 3, consecutiveTrivialTurns: 0 })).toBe('complex');
  });

  it('upgrades to complex on a very long tool chain', () => {
    expect(reclassifyTurn('standard', { totalCompletionTokens: 2000, writesThisTurn: 0, toolCallsThisTurn: 25, failedToolsThisTurn: 0, consecutiveTrivialTurns: 0 })).toBe('complex');
  });

  it('upgrades simple to standard on moderate output', () => {
    expect(reclassifyTurn('simple', { totalCompletionTokens: 3000, writesThisTurn: 0, toolCallsThisTurn: 1, failedToolsThisTurn: 0, consecutiveTrivialTurns: 0 })).toBe('standard');
  });

  it('keeps current tier when signals are weak', () => {
    expect(reclassifyTurn('standard', { totalCompletionTokens: 800, writesThisTurn: 0, toolCallsThisTurn: 1, failedToolsThisTurn: 0, consecutiveTrivialTurns: 1 })).toBe('standard');
  });

  it('downgrades complex to standard after enough trivial turns', () => {
    expect(reclassifyTurn('complex', { totalCompletionTokens: 2000, writesThisTurn: 0, toolCallsThisTurn: 1, failedToolsThisTurn: 0, consecutiveTrivialTurns: 3 })).toBe('standard');
  });

  it('downgrades standard to simple after enough trivial turns', () => {
    expect(reclassifyTurn('standard', { totalCompletionTokens: 600, writesThisTurn: 0, toolCallsThisTurn: 1, failedToolsThisTurn: 0, consecutiveTrivialTurns: 3 })).toBe('simple');
  });

  it('does not downgrade below simple', () => {
    expect(reclassifyTurn('simple', { totalCompletionTokens: 300, writesThisTurn: 0, toolCallsThisTurn: 1, failedToolsThisTurn: 0, consecutiveTrivialTurns: 10 })).toBe('simple');
  });

  it('holds complex tier on trivial turns before hysteresis threshold', () => {
    expect(reclassifyTurn('complex', { totalCompletionTokens: 2000, writesThisTurn: 0, toolCallsThisTurn: 1, failedToolsThisTurn: 0, consecutiveTrivialTurns: 2 })).toBe('complex');
  });
});
