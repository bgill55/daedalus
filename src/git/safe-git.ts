import { execSync } from 'node:child_process';
import fs from 'node:fs';
import pc from 'picocolors';

// The never-destroy-working-tree invariant.
//
// Autonomous runs (e.g. /autopilot in local-only mode) must NEVER silently
// wipe the user's working tree or delete their branch. Destructive ops are
// real and sometimes necessary (discarding a throwaway branch in a remote-
// backed repo), but they are gated behind an explicit `allowDestroy` flag.
//
// Default (allowDestroy = false): refuse to reset --hard / clean -fd / branch
// -D. Log a calm [CHECK] and keep the work so the user can inspect it.
//
// allowDestroy = true is only set when the user explicitly opts in (--allow-
// destroy) or when the run targets a remote-backed throwaway branch where
// deletion is safe and expected.

export interface SafeGitOptions {
  cwd: string;
  allowDestroy?: boolean;
  // When provided, names the branch that would be discarded — used in messages.
  branch?: string;
}

function refuse(label: string, opts: SafeGitOptions): void {
  const where = opts.branch ? ` branch '${opts.branch}'` : ' working tree';
  console.log(pc.dim(`[CHECK] Refusing ${label}${where} — keeping it for inspection (pass --allow-destroy to override).`));
}

export function safeGitResetHard(opts: SafeGitOptions): boolean {
  if (!opts.allowDestroy) {
    refuse('git reset --hard', opts);
    return false;
  }
  execSync('git reset --hard', { cwd: opts.cwd, stdio: 'ignore', windowsHide: true });
  return true;
}

export function safeGitClean(opts: SafeGitOptions): boolean {
  if (!opts.allowDestroy) {
    refuse('git clean -fd', opts);
    return false;
  }
  execSync('git clean -fd', { cwd: opts.cwd, stdio: 'ignore', windowsHide: true });
  return true;
}

export function safeBranchDelete(branch: string, opts: SafeGitOptions): boolean {
  if (!opts.allowDestroy) {
    refuse(`git branch -D ${branch}`, opts);
    return false;
  }
  execSync(`git branch -D ${branch}`, { cwd: opts.cwd, stdio: 'ignore', windowsHide: true });
  return true;
}

// Lists files tracked on the current HEAD that are ABSENT from `branch`.
// Switching to `branch` would silently DELETE these from the working tree.
// Returns [] when the branch can't be inspected (caller keeps prior behavior).
export function trackedFilesDeletedBySwitch(branch: string, cwd: string): string[] {
  try {
    const onBranch = execSync(`git ls-tree -r --name-only ${branch}`, { cwd, stdio: 'pipe', windowsHide: true })
      .toString().split('\n').filter(Boolean);
    const onHead = execSync('git ls-tree -r --name-only HEAD', { cwd, stdio: 'pipe', windowsHide: true })
      .toString().split('\n').filter(Boolean);
    const branchSet = new Set(onBranch);
    return onHead.filter((f) => !branchSet.has(f));
  } catch {
    return [];
  }
}

// Non-destructive replacement for `git checkout -B <branch>` when re-entering a
// run: create/switch to the branch WITHOUT discarding uncommitted work on it.
// Only force-resets the branch (checkout -B) when allowDestroy is explicitly set.
export function safeBranchSwitch(branch: string, opts: SafeGitOptions): void {
  const exists = fs.existsSync(`${opts.cwd}/.git/refs/heads/${branch}`) ||
    (() => { try { return execSync('git rev-parse --verify ' + branch, { cwd: opts.cwd, stdio: 'ignore', windowsHide: true }).toString().trim().length > 0; } catch { return false; } })();
  if (exists && !opts.allowDestroy) {
    // Guard: a plain `git checkout` to a branch that lacks files tracked on the
    // current HEAD silently DELETES those files from the working tree. In a
    // multi-project repo (or when re-entering a stale autopilot branch) this
    // wipes sibling-project work the user never asked to touch. Refuse unless
    // the user explicitly opts into destruction.
    const wouldDelete = trackedFilesDeletedBySwitch(branch, opts.cwd);
    if (wouldDelete.length > 0) {
      const preview = wouldDelete.slice(0, 5).join(', ') + (wouldDelete.length > 5 ? `, … (+${wouldDelete.length - 5} more)` : '');
      refuse(`git checkout ${branch} (would delete ${wouldDelete.length} tracked file(s): ${preview})`, opts);
      return;
    }
    // Switch without destroying local edits on the branch.
    execSync(`git checkout ${branch}`, { cwd: opts.cwd, stdio: 'ignore', windowsHide: true });
  } else {
    execSync(`git checkout -B ${branch}`, { cwd: opts.cwd, stdio: 'ignore', windowsHide: true });
  }
}

export function allowDestroyFromArgs(args: string): boolean {
  return /\s--allow-destroy\b/.test(args) || /\s--allow-destroy\b/.test(' ' + args);
}

// Detect the repo's base branch: prefer 'main', fall back to 'master', then HEAD.
// Used so autonomous runs always branch from a clean, stable base instead of
// whatever branch the user happens to be on (which prevents run-to-run cruft
// chaining — a prior autopilot branch leaking into the next run).
export function detectBaseBranch(cwd: string): string {
  const has = (b: string): boolean => {
    try {
      execSync(`git rev-parse --verify refs/heads/${b}`, { cwd, stdio: 'ignore', windowsHide: true });
      return true;
    } catch {
      return false;
    }
  };
  if (has('main')) return 'main';
  if (has('master')) return 'master';
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd, stdio: 'ignore', windowsHide: true }).toString().trim() || 'main';
  } catch {
    return 'main';
  }
}

// Non-destructive merge of an autonomous feature branch back into the base branch
// after a verified-green run. Fast-forwards when possible; otherwise creates a
// merge commit. Never force-pushes or rewrites the base history. Keeps the
// working tree on the base branch so the user never has to manually switch back.
// Returns true on success.
export function safeMergeToBase(branch: string, base: string, cwd: string): boolean {
  try {
    execSync(`git checkout ${base}`, { cwd, stdio: 'ignore', windowsHide: true });
    execSync(`git merge --no-edit ${branch}`, { cwd, stdio: 'ignore', windowsHide: true });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(pc.red(`[ERROR] Could not merge ${branch} into ${base}: ${msg}`));
    console.log(pc.yellow(`[INFO] Feature branch '${branch}' is kept locally for manual merge.`));
    return false;
  }
}

// Ensures a single-agent task starts on a fresh branch off the detected base
// branch, so work never piles onto a stale branch (the chaining bug). Only acts
// when the repo is clean and the user is currently sitting on the base branch;
// if they're already on a non-base branch (deliberate) it leaves them there.
// Returns the branch name switched to, or null if no action was taken.
export function ensureBranchFromBase(cwd: string): string | null {
  try {
    const base = detectBaseBranch(cwd);
    const current = execSync('git rev-parse --abbrev-ref HEAD', { cwd, stdio: 'pipe', windowsHide: true }).toString().trim();
    if (current === base) {
      const clean = execSync('git status --porcelain', { cwd, stdio: 'pipe', windowsHide: true }).toString().trim();
      if (clean) {
        console.log(pc.yellow(`[INFO] Working tree has uncommitted changes; staying on '${current}'.`));
        return null;
      }
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      const branch = `daedalus-task-${stamp}`;
      safeBranchSwitch(branch, { cwd, allowDestroy: false, branch });
      return branch;
    }
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(pc.yellow(`[INFO] Could not branch from base: ${msg}`));
    return null;
  }
}
