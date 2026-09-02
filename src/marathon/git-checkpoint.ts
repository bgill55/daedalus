import { execSync } from 'child_process';
import { MarathonMilestone } from './types.js';

export function isGitRepository(cwd: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd,
      stdio: 'ignore',
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export function getMilestoneTag(milestoneId: string): string {
  const clean = milestoneId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `daedalus-checkpoint/${clean}`;
}

export function getCurrentCommitSha(cwd: string): string {
  try {
    return execSync('git rev-parse HEAD', {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  } catch {
    return '';
  }
}

export function createMilestoneCheckpoint(
  cwd: string,
  milestone: MarathonMilestone,
  commitMessage?: string
): { tag: string; commit: string } | null {
  if (!isGitRepository(cwd)) return null;

  const tag = getMilestoneTag(milestone.id);
  const msg = commitMessage || `feat(marathon): [${milestone.id.toUpperCase()}] ${milestone.title}`;

  try {
    execSync('git add -A', { cwd, stdio: 'ignore', windowsHide: true });
    try {
      execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, {
        cwd,
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      // Nothing to commit if already committed, proceed to tagging
    }

    // Force tag to point to current HEAD
    execSync(`git tag -f ${tag}`, { cwd, stdio: 'ignore', windowsHide: true });
    const commit = getCurrentCommitSha(cwd);

    return { tag, commit };
  } catch {
    return null;
  }
}

export function rollbackToLastCheckpoint(cwd: string, targetTag: string): boolean {
  if (!isGitRepository(cwd)) return false;

  try {
    // Reset to the tagged commit and wipe untracked files
    execSync(`git reset --hard ${targetTag}`, {
      cwd,
      stdio: 'ignore',
      windowsHide: true,
    });
    execSync('git clean -fd', {
      cwd,
      stdio: 'ignore',
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export function ensureMarathonBranch(
  cwd: string,
  branchName: string,
  baseBranch: string
): boolean {
  if (!isGitRepository(cwd)) return false;

  try {
    // Check if branch exists
    const branches = execSync('git branch --list', {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
    });

    if (branches.includes(branchName)) {
      execSync(`git checkout ${branchName}`, {
        cwd,
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      // Checkout base first, then create marathon branch
      try {
        execSync(`git checkout ${baseBranch}`, {
          cwd,
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch {
        // base might already be current
      }
      execSync(`git checkout -b ${branchName}`, {
        cwd,
        stdio: 'ignore',
        windowsHide: true,
      });
    }
    return true;
  } catch {
    return false;
  }
}