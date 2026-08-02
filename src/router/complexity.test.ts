import { describe, it, expect } from 'vitest';
import { classifyTaskStart } from './complexity.js';

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
