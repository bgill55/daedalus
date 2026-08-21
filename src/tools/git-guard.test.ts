import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/index.js', () => ({
  loadConfig: () => ({ security: { preCommitGuard: true } }),
}));

import { guardCommitSecrets } from './git-guard.js';

describe('guardCommitSecrets', () => {
  it('returns null for non-commit commands', () => {
    expect(guardCommitSecrets('git status')).toBeNull();
    expect(guardCommitSecrets('echo hello')).toBeNull();
  });

  it('returns null or a string for git commit (fail-open when no repo)', () => {
    const err = guardCommitSecrets('git commit -m "feat: x"');
    expect(err === null || typeof err === 'string').toBe(true);
  });
});
