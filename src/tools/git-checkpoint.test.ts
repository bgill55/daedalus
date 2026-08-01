import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { createGitCheckpoint, restoreGitCheckpoint } from './git-checkpoint.js';

vi.mock('../config/index.js', () => ({
  loadConfig: vi.fn(),
}));

import { loadConfig } from '../config/index.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-git-checkpoint-'));
}

function git(dir: string, ...args: string[]): string {
  return execSync(['git', ...args].join(' '), { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function initRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init');
  git(dir, 'config', 'user.email', 'test@daedalus.local');
  git(dir, 'config', 'user.name', 'Daedalus Test');
  git(dir, 'config', 'core.autocrlf', 'false');
}

describe('git-checkpoint', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    (loadConfig as any).mockReturnValue({ safety: { protectGit: true } });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a checkpoint and restores a later modification', () => {
    initRepo(tmpDir);
    const file = path.join(tmpDir, 'a.txt');
    const other = path.join(tmpDir, 'b.txt');
    fs.writeFileSync(file, 'v1\n');
    fs.writeFileSync(other, 'v1\n');
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-m', 'init');

    fs.writeFileSync(other, 'v2\n');
    const cp = createGitCheckpoint(tmpDir);
    expect(cp.ok).toBe(true);
    expect(cp.hash).toBeTruthy();

    fs.writeFileSync(file, 'v2\n');

    const restored = restoreGitCheckpoint(tmpDir, cp.hash!);
    expect(restored).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('v1\n');
    expect(fs.readFileSync(other, 'utf8')).toBe('v2\n');
  });

  it('returns not-a-git-repo for a plain temp dir', () => {
    const cp = createGitCheckpoint(tmpDir);
    expect(cp.ok).toBe(false);
    expect(cp.reason).toBe('not a git repo');
  });

  it('returns git-protection-disabled when protectGit is false', () => {
    initRepo(tmpDir);
    (loadConfig as any).mockReturnValue({ safety: { protectGit: false } });
    const cp = createGitCheckpoint(tmpDir);
    expect(cp.ok).toBe(false);
    expect(cp.reason).toBe('git protection disabled');
  });

  it('returns no-changes when the working tree is clean', () => {
    initRepo(tmpDir);
    const file = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(file, 'v1\n');
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-m', 'init');

    const cp = createGitCheckpoint(tmpDir);
    expect(cp.ok).toBe(false);
    expect(cp.reason).toBe('no changes to snapshot');
  });

  it('returns false from restore for an invalid hash', () => {
    initRepo(tmpDir);
    const file = path.join(tmpDir, 'a.txt');
    fs.writeFileSync(file, 'v1\n');
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-m', 'init');

    expect(restoreGitCheckpoint(tmpDir, 'deadbeef00000000000000000000000000000000')).toBe(false);
  });
});
