import dotenv from 'dotenv';
import { execSync } from 'child_process';
import pc from 'picocolors';
import { ToolContext } from '../types.js';
import { CommandContext } from '../commands.js';

dotenv.config();

export function getGitRepoInfo(cwd: string): { owner: string; repo: string } | null {
  try {
    const url = execSync('git remote get-url origin', { cwd, encoding: 'utf8' }).trim();
    // Matches git@github.com:owner/repo.git or https://github.com/owner/repo.git
    const match = url.match(/(?:github\.com[:\/])([^\/]+)\/([^\/\.]+)(?:\.git)?/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch {
    // Ignore git command failure when not a repo or remote missing
  }
  return null;
}

export async function sendDiscordEmbed(webhookUrl: string, embed: any): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(pc.yellow(`[WARN] Discord webhook returned ${res.status}: ${text}`));
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(pc.yellow(`[WARN] Failed to send Discord notification: ${err.message}`));
    return false;
  }
}

export async function handleSpecCommand(args: string, ctx: CommandContext) {
  const idea = args.trim();
  if (!idea) {
    console.log(pc.red('[WARN] Please specify an idea. Example: /spec "Add OAuth Login"'));
    return;
  }

  const repoInfo = getGitRepoInfo(ctx.sessionManager.projectRoot);
  let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    try {
      token = execSync('gh auth token', { cwd: ctx.sessionManager.projectRoot, encoding: 'utf8' }).trim();
    } catch {
      // Fallback
    }
  }

  if (!repoInfo || !token) {
    console.log(pc.red('[WARN] GitHub integration not configured. Ensure you are in a git repository with GITHUB_TOKEN/GH_TOKEN or gh CLI authenticated.'));
    return;
  }

  console.log(pc.cyan(`\nFleshing out spec for: "${idea}"`));
  console.log(pc.dim('Gathering requirements...'));

  const prompt = `You are a technical planner. The user wants to build: "${idea}".
Generate 2-3 essential questions to clarify the requirements, design, and scope of this feature. Be extremely concise.`;

  const response = await ctx.router.chat.completions.create({
    model: 'intelligence',
    messages: [
      { role: 'system', content: 'You are a technical planner. Keep questions direct and brief.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
  });

  const questions = response.choices[0]?.message?.content || '';
  console.log(pc.bold('\n--- Clarification Questions ---'));
  console.log(questions);
  console.log(pc.bold('------------------------------\n'));

  const answers = await ctx.askLine(pc.bold('Your answers: '));

  console.log(pc.cyan('\nGenerating final specification...'));

  const specPrompt = `Based on the original idea: "${idea}" and user clarifications: "${answers}",
generate a detailed, implementation-ready Markdown specification.
Include a summary, proposed file modifications/creations, and acceptance criteria.`;

  const specResponse = await ctx.router.chat.completions.create({
    model: 'intelligence',
    messages: [
      { role: 'system', content: 'You are an expert technical writer. Output clean markdown.' },
      { role: 'user', content: specPrompt },
    ],
    temperature: 0.2,
  });

  const specMarkdown = specResponse.choices[0]?.message?.content || '';

  const issueTitle = `[Daedalus Spec] ${idea}`;
  console.log(pc.cyan('Creating issue on GitHub...'));

  const createResp = await fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Daedalus-CLI',
    },
    body: JSON.stringify({
      title: issueTitle,
      body: specMarkdown,
      labels: ['daedalus-todo'],
    }),
  });

  if (createResp.ok) {
    const issueData = (await createResp.json()) as any;
    console.log(pc.green(`\n✔ Issue created successfully on GitHub: ${pc.bold(issueData.html_url)}`));
  } else {
    const errText = await createResp.text();
    console.log(pc.red(`\nFailed to create issue on GitHub: ${errText}`));
  }
}

export async function startLoopDaemon(ctx: ToolContext, config: any, router: any, sessionManager: any) {
  console.log(pc.bold(pc.green('\n======================================')));
  console.log(pc.bold(pc.green('   DAEDALUS FINN LOOP DAEMON ACTIVE   ')));
  console.log(pc.bold(pc.green('======================================\n')));

  const repoInfo = getGitRepoInfo(sessionManager.projectRoot);
  let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    try {
      token = execSync('gh auth token', { cwd: sessionManager.projectRoot, encoding: 'utf8' }).trim();
    } catch {
      // Fallback
    }
  }
  const discordWebhook = process.env.DISCORD_WEBHOOK_URL;

  if (!repoInfo || !token) {
    console.error(pc.red('[ERROR] Daemon requires a Git repository with GITHUB_TOKEN/GH_TOKEN or gh CLI authenticated.'));
    process.exit(1);
  }

  const repo = repoInfo!;

  console.log(pc.cyan(`Monitoring repository: ${repo.owner}/${repo.repo}`));
  console.log(pc.cyan(`Looking for issues with label 'daedalus-todo'...`));
  if (discordWebhook) {
    console.log(pc.cyan('Discord notification channel active.'));
  }

  const pollIntervalMs = 180000; // 3 minutes

  async function checkAndProcessIssues() {
    console.log(pc.dim(`\n[${new Date().toLocaleTimeString()}] Checking for open tickets...`));
    try {
      const resp = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/issues?state=open&labels=daedalus-todo`, {
        headers: {
          Authorization: `token ${token}`,
          'User-Agent': 'Daedalus-CLI',
        },
      });

      if (!resp.ok) {
        console.error(pc.red(`GitHub API error: ${resp.statusText}`));
        return;
      }

      let issues = (await resp.json()) as any[];
      if (issues.length === 0) {
        const inProgressResp = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/issues?state=open&labels=daedalus-in-progress`, {
          headers: {
            Authorization: `token ${token}`,
            'User-Agent': 'Daedalus-CLI',
          },
        });
        if (inProgressResp.ok) {
          issues = (await inProgressResp.json()) as any[];
        }
      }

      if (issues.length === 0) {
        return;
      }

      const issue = issues[0];
      console.log(pc.green(`\n🚀 Found issue: #${issue.number} - "${issue.title}"`));

      // 1. Move to In Progress
      await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/issues/${issue.number}`, {
        method: 'PATCH',
        headers: {
          Authorization: `token ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Daedalus-CLI',
        },
        body: JSON.stringify({
          labels: ['daedalus-in-progress'],
        }),
      });

      // 2. Run Orchestrator in auto-approve mode
      process.env.DAEDALUS_AUTO_APPROVE = 'true';
      console.log(pc.cyan(`Starting orchestration for Issue #${issue.number}...`));
      const { Orchestrator } = await import('./orchestrator.js');
      const orchestrator = new Orchestrator(router, [], ctx, sessionManager);

      const goal = `${issue.title}\n\nSpec:\n${issue.body}`;
      const result = await orchestrator.run(goal);

      if (result.includes('Orchestration failed')) {
        console.error(pc.red(`\n✗ Orchestration failed for Issue #${issue.number}. Reverting changes...`));
        try {
          execSync('git reset --hard && git clean -fd', { cwd: sessionManager.projectRoot });
        } catch {
          // Ignore git reset errors if working directory is already clean
        }

        await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/issues/${issue.number}`, {
          method: 'PATCH',
          headers: {
            Authorization: `token ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Daedalus-CLI',
          },
          body: JSON.stringify({
            labels: ['daedalus-todo', 'daedalus-failed'],
          }),
        });

        if (discordWebhook) {
          await sendDiscordEmbed(discordWebhook, {
            title: `❌ Build Failed: Issue #${issue.number}`,
            description: `Orchestrator failed to build: "${issue.title}". Workspace changes reverted.`,
            color: 16711680,
          });
        }
        return;
      }

      // 3. Orchestration Passed — run self-review gate before committing
      console.log(pc.cyan('\n[SELF-REVIEW] Running semantic review gate before commit...'));

      const MAX_REVIEW_RETRIES = 2;
      let reviewGatePassed = false;

      for (let attempt = 0; attempt <= MAX_REVIEW_RETRIES; attempt++) {
        // Get full diff of working tree against the base branch
        let diffPatch = '';
        try {
          diffPatch = execSync('git diff HEAD', { cwd: sessionManager.projectRoot, encoding: 'utf8' }).trim();
          if (!diffPatch) {
            diffPatch = execSync('git diff --cached', { cwd: sessionManager.projectRoot, encoding: 'utf8' }).trim();
          }
        } catch { /* no diff available */ }

        if (!diffPatch) {
          reviewGatePassed = true;
          break;
        }

        // AI semantic review of the full diff
        let findings = '';
        try {
          const aiRes = await router.chat.completions.create({
            model: 'intelligence',
            messages: [
              {
                role: 'system',
                content: `You are an expert code reviewer. Analyze this git diff for show-stopping bugs: schema mismatches between JSON files and their parsers, unreachable code paths caused by incorrect empty-string detection (e.g. ''.split(' ') yields [''] not []), key normalization mismatches in add/remove operations, logic errors that compile clean.
Output ONLY "PASS" if no real bugs found, or a numbered list of bugs starting with "BUGS:". Be concise. Do not report style issues.`,
              },
              {
                role: 'user',
                content: `Review this diff:\n\`\`\`diff\n${diffPatch.slice(0, 8000)}\n\`\`\``,
              },
            ],
            temperature: 0.1,
          });
          findings = aiRes.choices[0]?.message?.content?.trim() || 'PASS';
        } catch { findings = 'PASS'; }

        if (findings === 'PASS' || findings.startsWith('PASS')) {
          console.log(pc.green(`[SELF-REVIEW] ✔ Semantic gate passed (attempt ${attempt + 1})`));
          reviewGatePassed = true;
          break;
        }

        console.log(pc.yellow(`\n[SELF-REVIEW] Found issues (attempt ${attempt + 1}/${MAX_REVIEW_RETRIES + 1}):\n${findings}`));

        if (attempt < MAX_REVIEW_RETRIES) {
          // Spawn a repair coder pass
          console.log(pc.cyan('[SELF-REVIEW] Spawning repair pass...'));
          try {
            const { Orchestrator } = await import('./orchestrator.js');
            const repairOrchestrator = new Orchestrator(router, [], ctx, sessionManager);
            const repairGoal = `Fix the following show-stopping bugs found in a semantic code review. Apply targeted fixes ONLY to the files mentioned. Do not rewrite unrelated code.\n\nBUGS TO FIX:\n${findings}`;
            await repairOrchestrator.run(repairGoal);
          } catch (repairErr: any) {
            console.error(pc.red(`[SELF-REVIEW] Repair pass failed: ${repairErr.message}`));
          }
        }
      }

      if (!reviewGatePassed) {
        console.error(pc.red(`\n✗ Self-review gate failed after ${MAX_REVIEW_RETRIES + 1} attempts. Reverting changes to keep codebase clean.`));
        try {
          execSync('git reset --hard && git clean -fd', { cwd: sessionManager.projectRoot });
        } catch { /* ignore */ }
        await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/issues/${issue.number}`, {
          method: 'PATCH',
          headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'Daedalus-CLI' },
          body: JSON.stringify({ labels: ['daedalus-todo', 'daedalus-failed'] }),
        });
        return;
      }

      // 4. Gate passed — push branch and open PR
      console.log(pc.green('\n✔ Self-review gate passed. Pushing changes...'));
      const branchName = `daedalus-issue-${issue.number}`;
      const cleanTitle = issue.title.replace(/"/g, "'");
      try {
        execSync(`git checkout -B ${branchName}`, { cwd: sessionManager.projectRoot });
        execSync('git add .', { cwd: sessionManager.projectRoot });
        execSync(`git commit -m "feat(issue-${issue.number}): ${cleanTitle}"`, { cwd: sessionManager.projectRoot });
        execSync(`git push -u origin ${branchName} --force`, { cwd: sessionManager.projectRoot });
      } catch (err: any) {
        console.error(pc.red(`Git push failed: ${err.message}`));
        return;
      }


      // Create PR
      console.log(pc.cyan('Opening Pull Request...'));
      const prResp = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/pulls`, {
        method: 'POST',
        headers: {
          Authorization: `token ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Daedalus-CLI',
        },
        body: JSON.stringify({
          title: `[PR] #${issue.number}: ${issue.title}`,
          head: branchName,
          base: 'main',
          body: `Resolves Issue #${issue.number}.\n\nAutomatically generated and verified by Daedalus.`,
        }),
      });

      let prUrl = '';
      if (prResp.ok) {
        const prData = (await prResp.json()) as any;
        prUrl = prData.html_url;
        console.log(pc.green(`✔ PR opened: ${prUrl}`));
      } else {
        console.error(pc.red(`Failed to open PR: ${await prResp.text()}`));
      }

      // Move Issue to done
      await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/issues/${issue.number}`, {
        method: 'PATCH',
        headers: {
          Authorization: `token ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Daedalus-CLI',
        },
        body: JSON.stringify({
          labels: ['daedalus-done'],
        }),
      });

      // 4. Send Discord Embed Notification
      if (discordWebhook) {
        await sendDiscordEmbed(discordWebhook, {
          title: `🚀 Code Review Ready: Issue #${issue.number}`,
          description: `Successfully built and verified: **"${issue.title}"**`,
          url: prUrl,
          color: 65280,
          fields: [
            { name: 'Issue Link', value: issue.html_url, inline: true },
            { name: 'Pull Request', value: prUrl, inline: true },
            { name: 'Branch', value: branchName, inline: true },
          ],
          timestamp: new Date().toISOString(),
        });
      }

      // Go back to main branch
      try {
        execSync('git checkout main', { cwd: sessionManager.projectRoot });
      } catch {
        // Ignore git checkout error if main branch is unavailable or already checked out
      }

    } catch (err: any) {
      console.error(pc.red(`Error in daemon loop: ${err.message}`));
    }
  }

  await checkAndProcessIssues();
  setInterval(checkAndProcessIssues, pollIntervalMs);
}
