import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import {
  safeGitResetHard,
  safeGitClean,
  safeBranchDelete,
  safeBranchSwitch,
  allowDestroyFromArgs,
} from './safe-git.js';

let dir: string;
function git(args: string): void {
  execSync(`git ${args}`, { cwd: dir, stdio: 'ignore' });
}

describe('never-destroy-working-tree invariant', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'daedalus-safegit-'));
    git('init -q');
    git('config user.email t@t.com');
    git('config user.name t');
    git('checkout -q -b main');
    writeFileSync(join(dir, 'keep.txt'), 'precious work');
    git('add -A');
    git('commit -qm init');
  });
  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('allowDestroyFromArgs detects the opt-in flag', () => {
    expect(allowDestroyFromArgs('build a thing --allow-destroy')).toBe(true);
    expect(allowDestroyFromArgs('build a thing')).toBe(false);
  });

  it('safeGitResetHard refuses by default and keeps the working tree', () => {
    writeFileSync(join(dir, 'wip.txt'), 'uncommitted');
    git('add -A');
    writeFileSync(join(dir, 'keep.txt'), 'CHANGED');
    const didReset = safeGitResetHard({ cwd: dir, allowDestroy: false });
    expect(didReset).toBe(false);
    expect(readFileSync(join(dir, 'keep.txt'), 'utf8')).toBe('CHANGED');
    expect(existsSync(join(dir, 'wip.txt'))).toBe(true);
  });

  it('safeGitResetHard destroys only when allowDestroy is true', () => {
    writeFileSync(join(dir, 'keep.txt'), 'CHANGED');
    const didReset = safeGitResetHard({ cwd: dir, allowDestroy: true });
    expect(didReset).toBe(true);
    expect(readFileSync(join(dir, 'keep.txt'), 'utf8')).toBe('precious work');
  });

  it('safeBranchDelete refuses by default, deletes when allowed', () => {
    git('checkout -q -b temp-branch');
    writeFileSync(join(dir, 'on-branch.txt'), 'x');
    git('add -A');
    git('commit -qm temp');
    git('checkout -q main');
    expect(safeBranchDelete('temp-branch', { cwd: dir, allowDestroy: false })).toBe(false);
    expect(() => execSync('git show-ref --verify --quiet refs/heads/temp-branch', { cwd: dir })).not.toThrow();
    expect(safeBranchDelete('temp-branch', { cwd: dir, allowDestroy: true })).toBe(true);
    expect(() => execSync('git rev-parse --verify temp-branch', { cwd: dir })).toThrow();
  });

  it('safeBranchSwitch does not discard local edits on re-entry (no --allow-destroy)', () => {
    git('checkout -q -b work');
    writeFileSync(join(dir, 'draft.txt'), 'in-progress');
    safeBranchSwitch('work', { cwd: dir, allowDestroy: false, branch: 'work' });
    expect(readFileSync(join(dir, 'draft.txt'), 'utf8')).toBe('in-progress');
    expect(execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir }).toString().trim()).toBe('work');
  });
});
