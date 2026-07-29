import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the terminal tool so npm test / lint / tsc don't actually run
vi.mock('./tools/builtin/terminal.js', () => ({
  execute: vi.fn(async ({ command }: { command: string }) => {
    if (command.includes('tsc')) return { success: true, content: '', error: '' };
    if (command.includes('lint')) return { success: true, content: '', error: '' };
    if (command.includes('npm test')) return { success: true, content: 'All tests passed', error: '' };
    if (command.includes('git diff')) return { success: true, content: '', error: '' };
    return { success: true, content: '', error: '' };
  }),
}));

// Mock the router so the AI semantic analysis doesn't make real API calls
vi.mock('./router/index.js', () => ({
  createRouter: vi.fn(() => ({
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: 'No semantic issues found.' } }],
        })),
      },
    },
  })),
}));

vi.mock('./config/index.js', () => ({
  loadConfig: vi.fn(() => ({ router: { chain: [] } })),
}));

import { runHeadlessCiReview, runHeadlessCiFix } from './ci.js';

describe('Headless CI Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runHeadlessCiReview returns structured review result', async () => {
    const result = await runHeadlessCiReview(process.cwd());
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('typeCheckPassed');
    expect(result).toHaveProperty('lintPassed');
    expect(result).toHaveProperty('testsPassed');
    expect(result).toHaveProperty('markdownReport');
    expect(result.markdownReport).toContain('Daedalus Automated PR Review');
  });

  it('runHeadlessCiReview passes when all checks succeed', async () => {
    const result = await runHeadlessCiReview(process.cwd());
    expect(result.typeCheckPassed).toBe(true);
    expect(result.lintPassed).toBe(true);
    expect(result.testsPassed).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('runHeadlessCiReview report includes all check sections', async () => {
    const result = await runHeadlessCiReview(process.cwd());
    expect(result.markdownReport).toContain('Type Check');
    expect(result.markdownReport).toContain('Linter');
    expect(result.markdownReport).toContain('Test Suite');
  });

  it('runHeadlessCiFix handles auto-fix check cleanly', async () => {
    const fixResult = await runHeadlessCiFix(process.cwd());
    expect(fixResult).toHaveProperty('success');
    expect(fixResult).toHaveProperty('message');
    expect(typeof fixResult.success).toBe('boolean');
    expect(typeof fixResult.message).toBe('string');
  });
});
