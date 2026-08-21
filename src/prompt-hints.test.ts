import { describe, it, expect } from 'vitest';
import { PROMPT_HINTS, getRandomPromptHint } from './prompt-hints.js';

describe('prompt-hints', () => {
  it('contains curated prompt hints', () => {
    expect(PROMPT_HINTS.length).toBeGreaterThanOrEqual(5);
    for (const h of PROMPT_HINTS) {
      expect(h.category).toBeTruthy();
      expect(h.tip).toBeTruthy();
      expect(h.example).toBeTruthy();
    }
  });

  it('getRandomPromptHint returns formatted tip', () => {
    const hint = getRandomPromptHint();
    expect(hint).toContain('💡 Tip');
    expect(hint).toContain('Try:');
  });

  it('getRandomPromptHint with a stack tag biases toward matched hints', () => {
    // Run many trials; a react project should never surface a python-only tip.
    for (let i = 0; i < 200; i++) {
      const hint = getRandomPromptHint(['react', 'next']);
      expect(hint).not.toContain('Python');
      expect(hint).not.toContain('Rust');
      expect(hint).not.toContain('Go');
    }
  });

  it('getRandomPromptHint falls back to generic when no specific match', () => {
    // 'cobol' matches nothing specific, so the full pool (incl. generic) is used.
    const hint = getRandomPromptHint(['cobol']);
    expect(hint).toContain('💡 Tip');
  });
});
