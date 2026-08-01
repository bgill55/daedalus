// Non-destructive git snapshot via `git stash create` (dangling commit, worktree untouched)

import { execSync, execFileSync } from 'child_process';
import { loadConfig } from '../config/index.js';

export interface GitCheckpoint {
  ok: boolean;
  hash?: string;
  reason?: string;
}

const GIT_TIMEOUT = 10000;

export function createGitCheckpoint(projectRoot: string): GitCheckpoint {
  try {
    let inside: string;
    try {
      inside = execSync('git rev-parse --is-inside-work-tree', {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: GIT_TIMEOUT,
      }).trim();
    } catch {
      return { ok: false, reason: 'not a git repo' };
    }
    if (inside !== 'true') {
      return { ok: false, reason: 'not a git repo' };
    }

    let config;
    try {
      config = loadConfig();
    } catch {
      config = null;
    }
    if (config?.safety?.protectGit === false) {
      return { ok: false, reason: 'git protection disabled' };
    }

    const stamp = new Date().toISOString();
    const out = execSync(`git stash create "daedalus checkpoint ${stamp}"`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GIT_TIMEOUT,
    }).trim();

    if (!out) {
      return { ok: false, reason: 'no changes to snapshot' };
    }

    return { ok: true, hash: out };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function restoreGitCheckpoint(projectRoot: string, hash: string): boolean {
  try {
    execFileSync('git', ['checkout', hash, '--', '.'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GIT_TIMEOUT,
    });
    return true;
  } catch {
    return false;
  }
}
