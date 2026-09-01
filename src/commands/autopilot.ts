import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import { execSync } from 'child_process';
import { loadConfig } from '../config/index.js';
import { scanStagedDiffForSecrets } from '../security/secret-detector.js';
import { errMessage } from '../utils/errors.js';
import {
  safeGitResetHard,
  safeBranchDelete,
  safeBranchSwitch,
  allowDestroyFromArgs,
  detectBaseBranch,
  safeMergeToBase,
} from '../git/safe-git.js';
import { getGitRepoInfo } from '../agents/loop.js';
import type { AgentResult } from '../agents/orchestrator-types.js';
import type { Command } from './types.js';

/**
 * Normalize a raw /autopilot argument into a clean feature description.
 * Strips a leading slash-command token (e.g. if the user re-pastes
 * "/autopilot ...") so it never leaks into the orchestration goal, branch
 * slug, or delegated sub-task text. Returns '' for empty/whitespace input.
 */
export function normalizeAutopilotIdea(raw: string): string {
  return raw.trim().replace(/^\/\S+\s*/, '').trim();
}

// Secret / credential filename patterns that must never be committed by an
// autonomous run, even if a sub-agent stages them.
const SECRET_FILE_PATTERN = /(\.env(\..*)?|.*\.key|.*\.pem|.*\.pfx|credentials.*|secrets?.*|.*id_rsa.*)$/i;

function isGitIgnored(cwd: string, file: string): boolean {
  try {
    execSync(`git check-ignore --quiet ${JSON.stringify(file)}`, { cwd, stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

// Stage all changes but always unstage secret-looking or gitignored files so an
// autonomous run can never commit a .env / credential / build artifact the repo
// intended to keep untracked.
function safeGitAdd(cwd: string): void {
  try {
    execSync('git add -A', { cwd, stdio: 'ignore', windowsHide: true });
  } catch {
    return;
  }
  try {
    const out = execSync('git diff --cached --name-only', { cwd, encoding: 'utf8', windowsHide: true });
    const staged = out.split('\n').map((s) => s.trim()).filter(Boolean);
    const exclude = staged.filter((f) => SECRET_FILE_PATTERN.test(f) || isGitIgnored(cwd, f));
    if (exclude.length > 0) {
      execSync(`git reset -q -- ${exclude.map((f) => JSON.stringify(f)).join(' ')}`, { cwd, stdio: 'ignore', windowsHide: true });
      console.log(pc.dim(`[CHECK] Excluded ${exclude.length} secret/ignored file(s) from commit (e.g. .env) — not staged.`));
    }
  } catch {
    // best-effort
  }
  // Pre-commit guard: refuse to proceed if the remaining staged diff still
  // contains a credential in an added line. The autopilot would otherwise
  // commit a leaked key. We throw so the caller's catch logs and stops.
  try {
    const enabled = loadConfig().security?.preCommitGuard !== false;
    if (enabled) {
      const hits = scanStagedDiffForSecrets(cwd);
      if (hits.length > 0) {
        throw new Error(`pre-commit guard: staged diff contains ${hits.length} credential line(s). Unstage and remove them (rotate the secret) before committing.`);
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('pre-commit guard:')) throw e;
    // loadConfig/path failures are best-effort: don't block the commit on them
  }
}

// Gate the autopilot commit on the target project's own build + test scripts.
// Using the project's scripts (not a hand-rolled tsc invocation) keeps
// tsconfig/module-resolution correct and catches broken or empty test files
// that a sub-agent may have left behind. If the project declares no
// build/test scripts (e.g. a bare repo), the gate is skipped — the
// orchestrator already verified during the run.
export async function runAutopilotVerify(cwd: string): Promise<{ ok: boolean; detail: string }> {
  const projects: string[] = [];
  const rootPkg = path.join(cwd, 'package.json');
  if (fs.existsSync(rootPkg)) {
    projects.push(cwd);
  } else {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(cwd, { withFileTypes: true }); } catch { /* ignore */ }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.')) continue;
      if (fs.existsSync(path.join(cwd, e.name, 'package.json'))) projects.push(path.join(cwd, e.name));
    }
  }
  if (projects.length === 0) {
    return { ok: true, detail: '' };
  }
  for (const proj of projects) {
    let scripts: Record<string, string> = {};
    try {
      scripts = JSON.parse(fs.readFileSync(path.join(proj, 'package.json'), 'utf8')).scripts ?? {};
    } catch { continue; }
    if (!fs.existsSync(path.join(proj, 'node_modules'))) {
      try {
        execSync('npm install', { cwd: proj, stdio: 'ignore', windowsHide: true });
      } catch (e) {
        const msg = e instanceof Error ? errMessage(e) : String(e);
        return { ok: false, detail: `npm install failed in ${path.relative(cwd, proj) || '.'}: ${msg.split('\n')[0]}` };
      }
    }
    for (const script of ['build', 'test']) {
      if (!scripts[script]) continue;
      try {
        execSync(`npm run ${script}`, { cwd: proj, stdio: 'ignore', windowsHide: true });
      } catch (e) {
        const msg = e instanceof Error ? errMessage(e) : String(e);
        return { ok: false, detail: `npm run ${script} failed in ${path.relative(cwd, proj) || '.'}: ${msg.split('\n')[0]}` };
      }
    }
  }
  return { ok: true, detail: '' };
}

export interface AutopilotManifest {
  feature: string;
  branch: string;
  remote: string | null;
  mode: 'git' | 'local-only' | 'non-git';
  outcome: 'committed' | 'committed-local' | 'pr-opened' | 'stopped-verify' | 'stopped-error' | 'no-changes';
  tasksPlanned: number;
  tasksDone: number;
  filesChanged: string[];
  testResult: { ok: boolean; detail: string } | null;
  finishedAt: string;
}

export function writeAutopilotManifest(m: AutopilotManifest): void {
  try {
    const dir = path.join(process.cwd(), '.daedalus');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `run-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(m, null, 2), 'utf8');
    console.log(pc.dim(`[INFO] Run manifest written to ${file}`));
  } catch {
    // best-effort
  }
}

export const autopilotCommand: Command = {
  name: '/autopilot',
  description: 'Autonomously implement a feature: branch, code, test, commit, and PR',
  usage: '/autopilot <feature description> [--allow-destroy]',
  helpText: 'End-to-end autonomous feature development. Creates a branch, plans and implements the feature, runs verification, commits, pushes, and opens a pull request.\n\nFlow:\n  1. Interactive Q&A to refine the feature spec\n  2. Creates a git branch (daedalus-autopilot-<slug>)\n  3. Runs the multi-agent orchestrator to implement it\n  4. Verifies with build/lint/tests\n  5. Commits and pushes to GitHub\n  6. Opens a Pull Request against main\n\nRequires a GitHub repository with a configured remote origin.\n\nSafety: in local-only mode (no remote), the working tree and branch are NEVER destroyed on failure — changes are kept for inspection. Pass --allow-destroy to override this and discard the branch on failure (only for throwaway repos).',
  execute: async (args, ctx) => {
    const idea = normalizeAutopilotIdea(args);
    if (!idea) {
      console.log(pc.yellow('[WARN] Usage: /autopilot <feature description>'));
      return;
    }

    const manifest: AutopilotManifest = {
      feature: idea,
      branch: '',
      remote: null,
      mode: 'non-git',
      outcome: 'stopped-error',
      tasksPlanned: 0,
      tasksDone: 0,
      filesChanged: [],
      testResult: null,
      finishedAt: '',
    };
    const emitManifest = () => {
      manifest.finishedAt = new Date().toISOString();
      writeAutopilotManifest(manifest);
    };

    try {
      let isGitRepo = true;
      try {
        execSync('git rev-parse --is-inside-work-tree', { cwd: ctx.toolContext.projectRoot, stdio: 'ignore', windowsHide: true });
      } catch {
        isGitRepo = false;
      }

      if (!isGitRepo) {
        console.log(pc.cyan('[INFO] Non-git directory detected. Auto-initializing Git repository for autonomous branch safety...'));
        try {
          const cwd = ctx.toolContext.projectRoot || process.cwd();
          execSync('git init', { cwd, windowsHide: true });
          const gitIgnorePath = path.join(cwd, '.gitignore');
          if (!fs.existsSync(gitIgnorePath)) {
            fs.writeFileSync(gitIgnorePath, "node_modules/\ndist/\n.daedalus/\n", 'utf8');
          }
          safeGitAdd(cwd);
          execSync('git commit -m "initial clean setup"', { cwd, windowsHide: true });
          isGitRepo = true;
          console.log(pc.green('[OK] Git repository initialized with tracking branch support.'));
        } catch {
          console.log(pc.yellow('[WARNING] Working directory is not a git repository. Autonomous changes will NOT be tracked in a git branch.'));
        }
      }

      const repoInfo = isGitRepo ? getGitRepoInfo(ctx.toolContext.projectRoot) : null;
      if (!repoInfo) {
        console.log(pc.yellow('[INFO] No GitHub remote found. Running in local-only mode (no PR will be created).'));
      }

      const slug = idea.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      const branchName = `daedalus-autopilot-${slug}`;
      manifest.remote = repoInfo ? `${repoInfo.owner}/${repoInfo.repo}` : null;
      manifest.mode = !isGitRepo ? 'non-git' : repoInfo ? 'git' : 'local-only';
      manifest.branch = branchName;

      if (isGitRepo) {
        try {
          const baseBranch = detectBaseBranch(ctx.toolContext.projectRoot);
          execSync(`git checkout ${baseBranch}`, { cwd: ctx.toolContext.projectRoot, stdio: 'ignore', windowsHide: true });
          const allowDestroy = allowDestroyFromArgs(idea) || !!repoInfo;
          safeBranchSwitch(branchName, { cwd: ctx.toolContext.projectRoot, allowDestroy, branch: branchName });
          console.log(pc.green(`[OK] Switched to branch: ${branchName} (from ${baseBranch})`));
        } catch (err: unknown) {
          const msg = err instanceof Error ? errMessage(err) : String(err);
          console.log(pc.red(`[ERROR] Failed to create branch: ${msg}`));
          return;
        }
      }

      const goal = `Implement the following feature: ${idea}`;

      console.log(pc.cyan(`\n[AUTOPILOT] Starting autonomous implementation...`));
      process.env.DAEDALUS_AUTO_APPROVE = 'true';
      process.env.DAEDALUS_ALLOW_INSTALL = 'true';

      try {
        const { Orchestrator } = await import('../agents/orchestrator.js');
        const orchestrator = new Orchestrator(ctx.router, ctx.messages, ctx.toolContext, ctx.sessionManager, ctx.config?.modelOverride);
        const result = await orchestrator.run(goal);
        console.log(pc.white(`\n${result}`));

        const orchestrationFailed = result.startsWith('Orchestration failed') || result.includes('## Orchestration Hit Verification Failures');
        const wasAborted = result.includes('## Orchestration Paused');
        if (orchestrationFailed || wasAborted) {
          const cols = process.stdout.columns || 80;
          const lineLen = Math.max(20, Math.min(70, cols - 6));
          console.log(`\n  ${pc.bold(pc.red('─ Autopilot Post-Mortem ─'))} ${pc.dim('─'.repeat(Math.max(10, lineLen - 25)))}`);

          const failed = orchestrator.results?.filter((r: AgentResult) => !r.success) || [];
          if (failed.length > 0) {
            failed.forEach((f: AgentResult, idx: number) => {
              console.log(`  ${pc.bold(pc.red(`❌ Failed Step ${idx + 1}:`))} ${pc.bold(`[${f.role}]`)} ${f.goal}`);
              console.log(`     ${pc.yellow(`📌 Diagnostic:`)} ${f.summary.split('\n')[0]}`);
            });
          } else {
            console.log(`  ${pc.yellow('❌ Verification check failed — required files failed artifact or build checks.')}`);
          }

          console.log(`\n  ${pc.cyan('Recommendations:')}`);
          console.log(`     - Target missing file: ${pc.bold(`/task create <file>`)}`);
          console.log(`     - Re-run autopilot:   ${pc.bold(`/autopilot ${idea}`)}`);
          console.log(`  ${pc.dim('─'.repeat(lineLen + 2))}\n`);

          throw new Error(orchestrationFailed ? 'Orchestration reported failure' : 'Orchestration was paused/aborted');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? errMessage(err) : String(err);
        console.log(pc.red(`\n[ERROR] Run stopped: ${msg}`));
        manifest.outcome = 'stopped-error';
        if (isGitRepo) {
          console.log(pc.dim('[CHECK] Verification did not pass — keeping the implemented changes on the branch for review.'));
          const allowDestroy = allowDestroyFromArgs(idea) || !!repoInfo;
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
            console.log(pc.cyan(`[INFO] Local-only mode: keeping branch '${branchName}' with the implemented changes for inspection. Fix and commit manually.`));
          }
        }
        return;
      }

      if (isGitRepo) {
        console.log(pc.cyan('\n[AUTOPILOT] Verifying build & tests before commit...'));
        const verify = await runAutopilotVerify(ctx.toolContext.projectRoot);
        if (!verify.ok) {
          console.log(pc.red(`\n[ERROR] Verification did not pass — holding the changes on the branch instead of committing. ${verify.detail}`));
          console.log(pc.cyan(`[INFO] Branch '${branchName}' is kept with the implemented changes for inspection.`));
          manifest.outcome = 'stopped-verify';
          manifest.testResult = verify;
          return;
        }
        console.log(pc.green('[OK] Build & tests passed.'));

        console.log(pc.cyan('\n[AUTOPILOT] Committing changes...'));
        try {
          safeGitAdd(ctx.toolContext.projectRoot);
          const cleanTitle = idea.replace(/[^a-zA-Z0-9 ]/g, '').trim();
          execSync(`git commit -m "feat: ${cleanTitle}"`, { cwd: ctx.toolContext.projectRoot, windowsHide: true });
          console.log(pc.green('[OK] Changes committed.'));
          try {
            const diff = execSync(`git diff --name-only HEAD~1 HEAD`, { cwd: ctx.toolContext.projectRoot, encoding: 'utf8', windowsHide: true });
            manifest.filesChanged = diff.split('\n').map((s: string) => s.trim()).filter(Boolean);
          } catch { /* best-effort */ }
        } catch (err: unknown) {
          const msg = err instanceof Error ? errMessage(err) : String(err);
          if (msg.includes('nothing to commit')) {
            console.log(pc.yellow('[INFO] No changes to commit.'));
          } else {
            console.log(pc.red(`[ERROR] Failed to commit: ${msg}`));
            return;
          }
        }
      } else {
        console.log(pc.yellow('\n[INFO] Non-git working directory. Autonomous implementation completed directly on files.'));
      }

      if (repoInfo) {
        console.log(pc.cyan('\n[AUTOPILOT] Pushing branch and creating PR...'));
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

          const prResponse = await fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              title: `[Autopilot] ${idea}`,
              head: branchName,
              base: 'main',
              body: `## Description\n\nAutonomously implemented by Daedalus Autopilot.\n\n**Feature:** ${idea}\n\n---\n_Generated by \`/autopilot\`_`,
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
        console.log(pc.yellow('\n[INFO] No GitHub remote configured. Implementation is committed locally.'));
        console.log(pc.yellow(`[INFO] Branch: ${branchName}`));
        const baseBranch = detectBaseBranch(ctx.toolContext.projectRoot);
        if (baseBranch !== branchName && safeMergeToBase(branchName, baseBranch, ctx.toolContext.projectRoot)) {
          console.log(pc.green(`[OK] Merged ${branchName} into ${baseBranch}. You are now on ${baseBranch}.`));
        }
      }

      console.log(pc.cyan(`\n[AUTOPILOT] Done! The feature branch was merged into the base branch — no manual switching needed.`));
      manifest.outcome = repoInfo ? 'pr-opened' : 'committed-local';
    } finally {
      emitManifest();
    }
  }
};
