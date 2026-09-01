import pc from 'picocolors';
import { execSync } from 'child_process';
import { errMessage } from '../utils/errors.js';
import { getGitRepoInfo } from '../agents/loop.js';
import {
  safeGitResetHard,
  safeBranchDelete,
  safeBranchSwitch,
  allowDestroyFromArgs,
} from '../git/safe-git.js';
import type { Command } from './types.js';

export const huntCommand: Command = {
  name: '/hunt',
  aliases: ['/bug'],
  description: 'Autonomously hunt down and fix a bug: reproduce, locate root cause, fix, verify',
  usage: '/hunt <failing-test-filepath> or <bug description>',
  helpText: 'End-to-end autonomous bug fixing. If given a test file path, runs it to capture the failure, searches the codebase for root cause, implements a fix, verifies the test passes, commits, pushes, and opens a pull request.\n\nFlow:\n  1. (Optional) Runs the failing test to capture error output\n  2. Creates a git branch (daedalus-hunt-<slug>)\n  3. Runs the multi-agent orchestrator to find and fix the bug\n  4. Re-runs the test to confirm the fix\n  5. Commits and pushes to GitHub\n  6. Opens a Pull Request against main\n\nProvide a test file path to enable automated reproduction and verification.',
  execute: async (args, ctx) => {
    const input = args.trim();
    if (!input) {
      console.log(pc.yellow('[WARN] Usage: /hunt <failing-test-filepath> or <bug description>'));
      return;
    }

    const repoInfo = getGitRepoInfo(ctx.toolContext.projectRoot);
    if (!repoInfo) {
      console.log(pc.yellow('[INFO] No GitHub remote found. Running in local-only mode (no PR will be created).'));
    }

    const slug = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const branchName = `daedalus-hunt-${slug}`;

    const testFilePattern = /\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/i;
    const isTestFile = testFilePattern.test(input.trim());

    let testFailureOutput = '';
    if (isTestFile) {
      const testPath = input.trim();
      console.log(pc.cyan(`\n[HUNT] Reproducing failure from: ${testPath}`));
      try {
        const { execute: termExec } = await import('../tools/builtin/terminal.js');
        const testResult = await termExec({ command: `npx vitest run ${testPath} --reporter=verbose`, timeout: 120, workdir: process.cwd() }, ctx.toolContext);
        if (testResult.success) {
          console.log(pc.yellow(`\n[HUNT] Test passed — no bug to fix. Running on main branch only.`));
          return;
        }
        testFailureOutput = testResult.content || '';
        const errorLines = testFailureOutput.split('\n').filter(l => l.includes('FAIL') || l.includes('AssertionError') || l.includes('Error:') || l.includes('×')).slice(0, 20).join('\n');
        console.log(pc.red(`\n[HUNT] Failure reproduced:\n${errorLines.slice(0, 1000)}`));
      } catch (err: unknown) {
        const msg = err instanceof Error ? errMessage(err) : String(err);
        console.log(pc.yellow(`[HUNT] Could not run test: ${msg}. Continuing with description only.`));
      }
    }

    try {
      const allowDestroy = allowDestroyFromArgs(input) || !!repoInfo;
      safeBranchSwitch(branchName, { cwd: ctx.toolContext.projectRoot, allowDestroy, branch: branchName });
      console.log(pc.green(`[OK] Switched to branch: ${branchName}`));
    } catch (err: unknown) {
      const msg = err instanceof Error ? errMessage(err) : String(err);
      console.log(pc.red(`[ERROR] Failed to create branch: ${msg}`));
      return;
    }

    const testContext = testFailureOutput ? `\n\nTest failure output:\n\`\`\`\n${testFailureOutput.slice(0, 4000)}\n\`\`\`` : '';
    const goal = `Fix the following bug:\n${input}${testContext}\n\nFind the root cause, fix it, and ensure existing tests still pass.`;

    console.log(pc.cyan(`\n[HUNT] Starting autonomous bug hunt...`));
    process.env.DAEDALUS_AUTO_APPROVE = 'true';

    let orchestratorResult = '';
    try {
      const { Orchestrator } = await import('../agents/orchestrator.js');
      const orchestrator = new Orchestrator(ctx.router, ctx.messages, ctx.toolContext, ctx.sessionManager, ctx.config?.modelOverride);
      orchestratorResult = await orchestrator.run(goal);
      console.log(pc.white(`\n${orchestratorResult}`));

      const orchestrationFailed = orchestratorResult.startsWith('Orchestration failed') || orchestratorResult.includes('## Orchestration Hit Verification Failures');
      const wasAborted = orchestratorResult.includes('## Orchestration Paused');
      if (orchestrationFailed || wasAborted) {
        throw new Error(orchestrationFailed ? 'Orchestration reported failure' : 'Orchestration was paused/aborted');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? errMessage(err) : String(err);
      console.log(pc.red(`\n[ERROR] Bug hunt stopped: ${msg}`));
      console.log(pc.dim('[CHECK] Fix did not verify — discarding the attempt to keep main clean.'));
      const allowDestroy = allowDestroyFromArgs(input) || !!repoInfo;
      if (allowDestroy) {
        try {
          safeGitResetHard({ cwd: ctx.toolContext.projectRoot, allowDestroy });
          execSync('git checkout main', { cwd: ctx.toolContext.projectRoot, stdio: 'ignore', windowsHide: true });
          safeBranchDelete(branchName, { cwd: ctx.toolContext.projectRoot, allowDestroy });
          console.log(pc.green('[OK] Branch cleaned up; main is untouched.'));
        } catch (rollbackErr: unknown) {
          const rbMsg = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
          console.log(pc.red(`[ERROR] Cleanup failed: ${rbMsg}. Manual cleanup may be needed.`));
        }
      } else {
        console.log(pc.cyan(`[INFO] Local-only mode: keeping branch '${branchName}' with the attempted fix for inspection. Fix and commit manually.`));
      }
      return;
    }

    if (isTestFile && testFailureOutput) {
      console.log(pc.cyan('\n[HUNT] Verifying fix...'));
      try {
        const { execute: termExec } = await import('../tools/builtin/terminal.js');
        const verifyResult = await termExec({ command: `npx vitest run ${input.trim()} --reporter=verbose`, timeout: 120, workdir: process.cwd() }, ctx.toolContext);
        if (verifyResult.success) {
          console.log(pc.green(`\n[HUNT] ✓ Fix verified — test passes.`));
        } else {
          console.log(pc.yellow(`\n[HUNT] ⚠ Fix verification failed. Test still failing. Continuing to commit partial fix.`));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? errMessage(err) : String(err);
        console.log(pc.yellow(`[HUNT] Verification skipped: ${msg}`));
      }
    }

    console.log(pc.cyan('\n[HUNT] Committing changes...'));
    try {
      execSync('git add .', { cwd: ctx.toolContext.projectRoot, windowsHide: true });
      const cleanTitle = input.replace(/[^a-zA-Z0-9 ]/g, '').trim();
      execSync(`git commit -m "fix: ${cleanTitle}"`, { cwd: ctx.toolContext.projectRoot, windowsHide: true });
      console.log(pc.green('[OK] Changes committed.'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? errMessage(err) : String(err);
      if (msg.includes('nothing to commit')) {
        console.log(pc.yellow('[INFO] No changes to commit.'));
      } else {
        console.log(pc.red(`[ERROR] Failed to commit: ${msg}`));
        return;
      }
    }

    if (repoInfo) {
      console.log(pc.cyan('\n[HUNT] Pushing branch and creating PR...'));
      let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      if (!token) {
        try {
          token = execSync('gh auth token', { encoding: 'utf8', windowsHide: true }).trim();
        } catch {
          console.log(pc.yellow('[INFO] No GitHub token found. Run `gh auth login` or set GITHUB_TOKEN.'));
          console.log(pc.yellow(`[INFO] Branch ${branchName} is ready locally. Push manually.`));
          return;
        }
      }

      try {
        execSync(`git push -u origin ${branchName} --force`, { cwd: ctx.toolContext.projectRoot, windowsHide: true });
        const hasSummary = orchestratorResult && !orchestratorResult.startsWith('Orchestration failed');
        const prBody = `## Description\n\nAutonomously fixed by Daedalus Hunt.\n\n**Bug:** ${input}\n${testFailureOutput ? `\n**Failure reproduced:**\n\`\`\`\n${testFailureOutput.slice(0, 1500)}\n\`\`\`\n` : ''}${hasSummary ? `\n**Summary:**\n${orchestratorResult.slice(0, 2000)}` : ''}\n\n---\n_Generated by \`/hunt\`_`;

        const prResponse = await fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: `[Hunt] ${input}`,
            head: branchName,
            base: 'main',
            body: prBody,
          }),
        });

        if (prResponse.ok) {
          const pr = await prResponse.json() as { html_url: string };
          console.log(pc.green(`\n[OK] Pull Request created: ${pr.html_url}`));
        } else {
          const errText = await prResponse.text();
          console.log(pc.red(`[ERROR] Failed to create PR: ${prResponse.status} ${errText}`));
          console.log(pc.yellow(`[INFO] Branch ${branchName} is pushed. Create PR manually.`));
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? errMessage(err) : String(err);
        console.log(pc.red(`[ERROR] Push/PR failed: ${msg}`));
        console.log(pc.yellow(`[INFO] Branch ${branchName} is ready locally.`));
      }
    } else {
      console.log(pc.yellow('\n[INFO] No GitHub remote configured. Fix is committed locally.'));
      console.log(pc.yellow(`[INFO] Branch: ${branchName}`));
    }

    console.log(pc.cyan(`\n[HUNT] Done! Run 'git checkout main' to return to main branch.`));
  }
};
