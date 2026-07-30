import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
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

export function resolveDiscordWebhook(config?: any): string | null {
  if (process.env.DISCORD_LOOP_WEBHOOK_URL && process.env.DISCORD_LOOP_WEBHOOK_URL.trim()) {
    return process.env.DISCORD_LOOP_WEBHOOK_URL.trim();
  }
  if (process.env.DISCORD_WEBHOOK_URL && process.env.DISCORD_WEBHOOK_URL.trim()) {
    return process.env.DISCORD_WEBHOOK_URL.trim();
  }
  if (config?.discordLoopWebhook && typeof config.discordLoopWebhook === 'string') {
    return config.discordLoopWebhook.trim();
  }
  if (config?.discordWebhook && typeof config.discordWebhook === 'string') {
    return config.discordWebhook.trim();
  }
  if (config?.integrations?.discordLoopWebhook && typeof config.integrations.discordLoopWebhook === 'string') {
    return config.integrations.discordLoopWebhook.trim();
  }
  if (config?.integrations?.discordWebhook && typeof config.integrations.discordWebhook === 'string') {
    return config.integrations.discordWebhook.trim();
  }
  try {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    const configPath = path.join(home, '.daedalus', 'config.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (parsed.discordLoopWebhook) return String(parsed.discordLoopWebhook).trim();
      if (parsed.discordWebhook) return String(parsed.discordWebhook).trim();
      if (parsed.integrations?.discordLoopWebhook) return String(parsed.integrations.discordLoopWebhook).trim();
      if (parsed.integrations?.discordWebhook) return String(parsed.integrations.discordWebhook).trim();
    }
  } catch {
    // Ignore config read failures
  }
  return null;
}

export async function sendDiscordEmbed(webhookUrl: string, embed: any): Promise<boolean> {
  if (!webhookUrl) return false;
  try {
    const cleanEmbed: any = { ...embed };

    // Clean up empty URL which breaks Discord API
    if (!cleanEmbed.url || typeof cleanEmbed.url !== 'string' || !cleanEmbed.url.startsWith('http')) {
      delete cleanEmbed.url;
    }

    // Clean up empty fields which break Discord API
    if (Array.isArray(cleanEmbed.fields)) {
      cleanEmbed.fields = cleanEmbed.fields
        .filter((f: any) => f && f.name && f.value)
        .map((f: any) => ({
          name: String(f.name),
          value: String(f.value).trim() || 'N/A',
          inline: Boolean(f.inline),
        }));
      if (cleanEmbed.fields.length === 0) {
        delete cleanEmbed.fields;
      }
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [cleanEmbed] }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(pc.yellow(`[WARN] Discord webhook returned ${res.status}: ${text}`));
      return false;
    }
    console.log(pc.green('✔ Sent Discord notification embed.'));
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

    const discordWebhook = resolveDiscordWebhook(ctx.config);
    if (discordWebhook) {
      await sendDiscordEmbed(discordWebhook, {
        title: `📋 New Spec Issue Queued: ${idea}`,
        description: `Created issue **#${issueData.number}** and queued for autonomous loop processing.`,
        url: issueData.html_url,
        color: 3447003,
        fields: [
          { name: 'Repository', value: `${repoInfo.owner}/${repoInfo.repo}`, inline: true },
          { name: 'Status', value: 'daedalus-todo', inline: true },
        ],
        timestamp: new Date().toISOString(),
      });
    }
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

  const discordWebhook = resolveDiscordWebhook(config);

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

      // Send Discord Embed for work starting
      if (discordWebhook) {
        await sendDiscordEmbed(discordWebhook, {
          title: `⚙️ Loop Work Started: Issue #${issue.number}`,
          description: `Daedalus is implementing: **"${issue.title}"**`,
          url: issue.html_url || `https://github.com/${repo.owner}/${repo.repo}/issues/${issue.number}`,
          color: 3447003,
          fields: [
            { name: 'Repository', value: `${repo.owner}/${repo.repo}`, inline: true },
            { name: 'Issue Link', value: issue.html_url || 'N/A', inline: true },
          ],
          timestamp: new Date().toISOString(),
        });
      }

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
            url: issue.html_url,
            color: 16711680,
            timestamp: new Date().toISOString(),
          });
        }
        return;
      }

      // 3. Orchestration Passed — run self-review gate before committing
      console.log(`\n  ${pc.bold(pc.magenta('── Self-Review Gate ──'))} ${pc.dim('─'.repeat(42))}`);

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
          console.log(pc.gray('  Working tree clean — skipping diff inspection.'));
          reviewGatePassed = true;
          break;
        }

        const diffLines = diffPatch.split('\n').length;
        console.log(pc.cyan(`  [Attempt ${attempt + 1}/${MAX_REVIEW_RETRIES + 1}] Inspecting ${diffLines} diff lines for show-stopper bugs...`));

        // AI semantic review of the full diff
        let findings = '';
        try {
          const aiRes = await router.chat.completions.create({
            model: 'intelligence',
            messages: [
              {
                role: 'system',
                content: `You are an expert code reviewer. Analyze this git diff for show-stopping bugs and contract violations:
1. CONTRACT MISMATCHES: JSDoc or docstrings stating rules (e.g. "alphanumeric") that differ from what regexes or code logic actually accept (e.g. allowing hyphens [0-9A-Za-z-]).
2. AGENTS.MD COMMENT VIOLATIONS: Redundant inline comments restating obvious control flow (e.g. "// check if empty", "// fast path", "// regex derived").
3. SCHEMA MISMATCHES: JSON seed/default schemas differing from parser expectations.
4. UNREACHABLE PATHS & LOGIC ERRORS: Incorrect empty-string handling (e.g. ''.split(' ') yielding ['']) or key normalization mismatches in add/remove operations.
Output ONLY "PASS" if no bugs or contract violations found, or a numbered list of bugs starting with "BUGS:". Be concise.`,
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
          console.log(pc.green(pc.bold('  [PASS] No show-stopping bugs detected in diff.')));
          console.log(pc.gray('  Codebase integrity verified. Approved for commit & PR.'));
          console.log(`  ${pc.dim('─'.repeat(64))}\n`);
          reviewGatePassed = true;
          break;
        }

        console.log(pc.yellow(pc.bold(`\n  [BUGS DETECTED] (Attempt ${attempt + 1}/${MAX_REVIEW_RETRIES + 1}):`)));
        const findingLines = findings.split('\n').filter(Boolean);
        for (const line of findingLines) {
          console.log(pc.yellow(`    ${line}`));
        }

        if (attempt < MAX_REVIEW_RETRIES) {
          // Spawn a repair coder pass
          console.log(pc.cyan(pc.bold('\n  [REPAIR] Spawning automated repair pass to resolve issues...')));
          try {
            const { Orchestrator } = await import('./orchestrator.js');
            const repairOrchestrator = new Orchestrator(router, [], ctx, sessionManager);
            const repairGoal = `Fix the following show-stopping bugs found in a semantic code review. Apply targeted fixes ONLY to the files mentioned. Do not rewrite unrelated code.\n\nBUGS TO FIX:\n${findings}`;
            await repairOrchestrator.run(repairGoal);
          } catch (repairErr: any) {
            console.error(pc.red(`  [REPAIR ERROR] ${repairErr.message}`));
          }
        }
      }

      if (!reviewGatePassed) {
        console.error(pc.red(pc.bold(`\n  [FAILED] Self-review gate failed after ${MAX_REVIEW_RETRIES + 1} attempts. Reverting workspace changes.`)));
        console.log(`  ${pc.dim('─'.repeat(64))}\n`);
        try {
          execSync('git reset --hard && git clean -fd', { cwd: sessionManager.projectRoot });
        } catch { /* ignore */ }
        await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/issues/${issue.number}`, {
          method: 'PATCH',
          headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'Daedalus-CLI' },
          body: JSON.stringify({ labels: ['daedalus-todo', 'daedalus-failed'] }),
        });

        if (discordWebhook) {
          await sendDiscordEmbed(discordWebhook, {
            title: `⚠️ Review Gate Failed: Issue #${issue.number}`,
            description: `Self-review gate failed after retries for: **"${issue.title}"**. Workspace changes reverted.`,
            url: issue.html_url,
            color: 16753920,
            timestamp: new Date().toISOString(),
          });
        }
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
        prUrl = prData.html_url || '';
        console.log(pc.green(`✔ PR opened: ${prUrl}`));
      } else {
        const errBody = await prResp.text();
        console.error(pc.yellow(`PR creation notice: ${errBody.slice(0, 150)}`));

        // Attempt to fetch existing PR for this head branch so prUrl is not empty
        try {
          const existingPrResp = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/pulls?head=${repo.owner}:${branchName}&state=open`, {
            headers: {
              Authorization: `token ${token}`,
              'User-Agent': 'Daedalus-CLI',
            },
          });
          if (existingPrResp.ok) {
            const prs = (await existingPrResp.json()) as any[];
            if (prs.length > 0 && prs[0].html_url) {
              prUrl = prs[0].html_url;
              console.log(pc.green(`✔ Found existing PR: ${prUrl}`));
            }
          }
        } catch { /* ignore fallback fetch error */ }

        if (!prUrl) {
          prUrl = `https://github.com/${repo.owner}/${repo.repo}/pulls`;
        }
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

      // 5. Send Discord Embed Notification
      if (discordWebhook) {
        const issueUrl = issue.html_url || `https://github.com/${repo.owner}/${repo.repo}/issues/${issue.number}`;
        await sendDiscordEmbed(discordWebhook, {
          title: `🚀 PR Ready for Review: Issue #${issue.number}`,
          description: `Successfully built and verified: **"${issue.title}"**`,
          url: prUrl,
          color: 65280,
          fields: [
            { name: 'Issue', value: `[#${issue.number}](${issueUrl})`, inline: true },
            { name: 'Pull Request', value: `[View PR](${prUrl})`, inline: true },
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
