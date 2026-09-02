import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import {
  isGitRepository,
  getMilestoneTag,
  createMilestoneCheckpoint,
  rollbackToLastCheckpoint,
  ensureMarathonBranch,
} from './git-checkpoint.js';
import { MarathonMilestone } from './types.js';

describe('Marathon Git Checkpointing', () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-git-test-'));
    execSync('git init -b main', { cwd: tmpRepo, stdio: 'ignore' });
    execSync('git config user.name "Test Runner"', { cwd: tmpRepo, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tmpRepo, stdio: 'ignore' });

    fs.writeFileSync(path.join(tmpRepo, 'README.md'), '# Initial Repo\n');
    execSync('git add README.md && git commit -m "init"', { cwd: tmpRepo, stdio: 'ignore' });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpRepo, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  });

  it('detects valid git repository', () => {
    expect(isGitRepository(tmpRepo)).toBe(true);
    expect(isGitRepository(os.tmpdir())).toBe(false);
  });

  it('formats milestone tag cleanly', () => {
    expect(getMilestoneTag('m-1')).toBe('daedalus-checkpoint/m-1');
    expect(getMilestoneTag('M_2_API')).toBe('daedalus-checkpoint/m-2-api');
  });

  it('creates milestone checkpoints and supports clean rollback', () => {
    const milestone: MarathonMilestone = {
      id: 'm-1',
      title: 'Setup Database',
      description: 'Create SQLite schema',
      targetFiles: ['src/db.ts'],
      acceptanceCriteria: ['DB exists'],
      status: 'in_progress',
      attempts: 0,
      maxAttempts: 3,
    };

    fs.writeFileSync(path.join(tmpRepo, 'db.ts'), 'export const db = 1;\n');
    const cp = createMilestoneCheckpoint(tmpRepo, milestone);

    expect(cp).not.toBeNull();
    expect(cp?.tag).toBe('daedalus-checkpoint/m-1');
    expect(cp?.commit).toBeTruthy();

    // Verify git tag exists
    const tags = execSync('git tag', { cwd: tmpRepo, encoding: 'utf8' });
    expect(tags).toContain('daedalus-checkpoint/m-1');

    // Simulate a broken iteration: add a bad file and corrupt db.ts
    fs.writeFileSync(path.join(tmpRepo, 'db.ts'), 'SYNTAX ERROR BROKEN\n');
    fs.writeFileSync(path.join(tmpRepo, 'corrupt.txt'), 'trash\n');

    // Rollback to m-1 checkpoint
    const ok = rollbackToLastCheckpoint(tmpRepo, cp!.tag);
    expect(ok).toBe(true);

    // Verify repository is restored to clean state
    expect(fs.readFileSync(path.join(tmpRepo, 'db.ts'), 'utf8')).toBe('export const db = 1;\n');
    expect(fs.existsSync(path.join(tmpRepo, 'corrupt.txt'))).toBe(false);
  });

  it('ensures marathon branch creation and checkout', () => {
    const ok = ensureMarathonBranch(tmpRepo, 'marathon/test-run', 'main');
    expect(ok).toBe(true);

    const currentBranch = execSync('git branch --show-current', {
      cwd: tmpRepo,
      encoding: 'utf8',
    }).trim();
    expect(currentBranch).toBe('marathon/test-run');
  });
});