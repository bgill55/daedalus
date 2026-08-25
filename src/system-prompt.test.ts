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
    expect(systemPrompt).toMatch(/ZERO Narration & ZERO Re-proposing/);
    expect(systemPrompt).toMatch(/Permission is granted/);
  });

  it('should instruct the agent to verify state with tools before assuming reported errors', () => {
    expect(systemPrompt).toMatch(/VERIFY BEFORE ASSUMING/);
    expect(systemPrompt).toMatch(/npx tsc --noEmit/);
    expect(systemPrompt).toMatch(/do NOT re-derive the same/i);
  });

  it('should tell the agent to verify static assets on disk (not assert) and fall back to a disk check when a server probe is blocked', () => {
    expect(systemPrompt).toMatch(/Verify a static asset \(image, favicon, CSS, HTML, JSON\) by INSPECTING IT ON DISK/);
    expect(systemPrompt).toMatch(/fall back to the disk check/);
    expect(systemPrompt).toMatch(/never after the write alone/);
  });
});
