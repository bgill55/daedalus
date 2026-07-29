import { describe, it, expect } from 'vitest';
import { runHeadlessCiReview, runHeadlessCiFix } from './ci.js';

describe('Headless CI Runner', () => {

  it('runHeadlessCiReview returns structured review result', async () => {
    const result = await runHeadlessCiReview(process.cwd());
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('markdownReport');
    expect(result.markdownReport).toContain('Daedalus Automated PR Review');
  }, 30000);

  it('runHeadlessCiFix handles auto-fix check cleanly', async () => {
    const fixResult = await runHeadlessCiFix(process.cwd());
    expect(fixResult).toHaveProperty('success');
    expect(fixResult).toHaveProperty('message');
  }, 30000);

});
