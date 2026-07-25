import { describe, it, expect } from 'vitest';
import { getGitAwareTestCommand } from '../utils/gitAwareTest.js';

describe('getGitAwareTestCommand (Sprint 2)', () => {
  it('returns default command if no git changes or error', () => {
    const result = getGitAwareTestCommand(process.cwd(), 'npm test');
    expect(result.command).toBeDefined();
    expect(typeof result.command).toBe('string');
  });

  it('maps modified files and returns targeted vitest command if tests exist', () => {
    const result = getGitAwareTestCommand(process.cwd());
    expect(Array.isArray(result.modifiedFiles)).toBe(true);
    expect(Array.isArray(result.testFiles)).toBe(true);
  });
});
