import { describe, it, expect } from 'vitest';
import { systemPrompt } from './system-prompt.js';

describe('systemPrompt', () => {
  it('should instruct the agent on clear plan headers and simple approval prompts', () => {
    expect(systemPrompt).toMatch(/### 📋 Proposed Plan \(Not Executed Yet\)/);
    expect(systemPrompt).toMatch(/Would you like me to proceed with this plan\? \(Yes \/ No\)/);
    expect(systemPrompt).toMatch(/NEVER dump giant full-source code blocks/);
  });

  it('should instruct the agent to execute tools immediately on proceed with zero preamble narration', () => {
    expect(systemPrompt).toMatch(/Instant Tool Execution on Proceed \/ Yes/);
    expect(systemPrompt).toMatch(/ZERO Narration Before Tools/);
    expect(systemPrompt).toMatch(/Permission is already granted/);
  });
});
