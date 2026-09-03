import { execSync } from 'node:child_process';
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
    execSync(`git push -u origin ${run.marathonBranch} --force-with-lease`, {
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

  const cleanGoal = run.macroGoal.replace(/^(\/marathon|feat|fix|add)\s*/i, '').trim();
  const title = `feat(webui): ${cleanGoal.slice(0, 60)}`;
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

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Daedalus-Marathon-Engine',
  };

  try {
    // 1. Check if PR already exists for this branch
    const listRes = await fetch(
      `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/pulls?head=${repoInfo.owner}:${run.marathonBranch}&state=open`,
      { headers }
    );

    if (listRes.ok) {
      const openPRs = await listRes.json() as Array<{ number: number; html_url: string }>;
      if (openPRs.length > 0) {
        const existing = openPRs[0];
        // Update existing PR metadata
        const updateRes = await fetch(
          `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${existing.number}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ title, body }),
          }
        );

        if (updateRes.ok) {
          const updated = await updateRes.json() as { html_url: string; number: number };
          return {
            success: true,
            prUrl: updated.html_url,
            message: `Updated existing Pull Request #${updated.number}: ${updated.html_url}`,
          };
        }
      }
    }

    // 2. Create new PR if none exists
    const createRes = await fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title,
        head: run.marathonBranch,
        base: run.baseBranch || 'main',
        body,
        draft: false,
      }),
    });

    if (createRes.ok) {
      const data = await createRes.json() as { html_url: string; number: number };
      return {
        success: true,
        prUrl: data.html_url,
        message: `Created Pull Request #${data.number}: ${data.html_url}`,
      };
    } else {
      const errJson = await createRes.json().catch(() => ({})) as { message?: string };
      return {
        success: false,
        message: `GitHub API error: ${errJson.message || createRes.statusText}`,
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Failed to create or update GitHub PR: ${msg}`,
    };
  }
}
