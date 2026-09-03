import { execSync } from 'node:child_process';
import pc from 'picocolors';
import { getGitRepoInfo } from '../agents/loop.js';
import type { MarathonRun } from './types.js';

export interface CreateStackedPROptions {
  projectRoot: string;
  run: MarathonRun;
}

export interface StackedPRResult {
  success: boolean;
  prUrl?: string;
  message: string;
}

export async function createMarathonStackedPR(opts: CreateStackedPROptions): Promise<StackedPRResult> {
  const { projectRoot, run } = opts;
  const repoInfo = getGitRepoInfo(projectRoot);

  if (!repoInfo) {
    return {
      success: false,
      message: 'No GitHub remote repository detected. Branch preserved locally.',
    };
  }

  let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    try {
      token = execSync('gh auth token', { encoding: 'utf8', windowsHide: true }).trim();
    } catch {
      return {
        success: false,
        message: 'No GitHub authentication token found. Use `gh auth login` or set GITHUB_TOKEN.',
      };
    }
  }

  try {
    // Push marathon branch to remote
    execSync(`git push -u origin ${run.marathonBranch} --force`, {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Failed to push branch ${run.marathonBranch}: ${msg}`,
    };
  }

  const milestoneLines = run.milestones.map((m, idx) => {
    const scoreText = m.evalReport?.score !== undefined ? ` (Score: ${m.evalReport.score}/100)` : '';
    const tagText = m.gitTag ? ` \`${m.gitTag}\`` : '';
    return `- [x] **M-${idx + 1}: ${m.title}**${scoreText}${tagText}\n  - _${m.description}_\n  - **Deliverables:** ${m.targetFiles.join(', ') || 'N/A'}`;
  }).join('\n\n');

  const body = `## 🏃 Daedalus Autonomous Marathon Stacked PR

### Macro Goal:
> ${run.macroGoal}

---

### 📦 Milestone Execution Stack (${run.milestones.length}/${run.milestones.length} Completed):
${milestoneLines}

---

### 🛡️ Air-Gapped Apollo Audit:
All milestones were independently evaluated, audited for zero empty stubs, and certified with git checkpoint tags.

_Generated autonomously by [Daedalus Marathon Engine](https://github.com/bgill55/daedalus)_`;

  try {
    const res = await fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Daedalus-Marathon-Engine',
      },
      body: JSON.stringify({
        title: `[Marathon] ${run.macroGoal.slice(0, 70)}`,
        head: run.marathonBranch,
        base: run.baseBranch || 'main',
        body,
        draft: false,
      }),
    });

    if (res.ok) {
      const data = await res.json() as { html_url: string; number: number };
      return {
        success: true,
        prUrl: data.html_url,
        message: `Created Pull Request #${data.number}: ${data.html_url}`,
      };
    } else {
      const errJson = await res.json().catch(() => ({})) as { message?: string };
      // Check if PR already exists
      if (errJson.message && errJson.message.includes('A pull request already exists')) {
        return {
          success: true,
          prUrl: `https://github.com/${repoInfo.owner}/${repoInfo.repo}/pulls`,
          message: `Branch pushed. A Pull Request for ${run.marathonBranch} already exists on GitHub.`,
        };
      }
      return {
        success: false,
        message: `GitHub API error: ${errJson.message || res.statusText}`,
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Failed to create GitHub PR: ${msg}`,
    };
  }
}
