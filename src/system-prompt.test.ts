import { describe, it, expect } from 'vitest';
import { systemPrompt } from './system-prompt.js';

describe('systemPrompt', () => {
  it('should tell the agent to present audit/review/todo findings and ask before implementing', () => {
    expect(systemPrompt).toMatch(/STOP and ask the user which items they want implemented/);
    expect(systemPrompt).toMatch(/Do NOT start calling/);
  });

  it('should still tell the agent to act directly on concrete action requests', () => {
    expect(systemPrompt).toMatch(/just DO it/);
    expect(systemPrompt).toMatch(/USE the appropriate tool/);
  });
});
