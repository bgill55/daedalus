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
});
