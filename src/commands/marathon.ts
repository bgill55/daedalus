import pc from 'picocolors';
import { MarathonEngine } from '../marathon/engine.js';
import { renderRoadmapMarkdown, saveMarathonRun } from '../marathon/state.js';
import { createMarathonStackedPR } from '../marathon/pr.js';
import type { Command } from './types.js';

export const marathonCommand: Command = {
  name: '/marathon',
  description: 'Multi-day autonomous software development (Harness-of-Harness meta-loop)',
  usage: '/marathon <goal> | status | resume | pr | rollback | abort',
  helpText: `Daedalus Marathon Engine: Harness-of-Harness (HoH) Multi-Day Autonomy.

Iteratively builds complex, multi-milestone systems across days without context rot.

Subcommands:
  /marathon <goal>       Decomposes the high-level goal into an ordered milestone DAG and begins execution
  /marathon status       Displays the current roadmap progress, active milestone, and verification scores
  /marathon resume       Resumes execution of a paused or interrupted marathon run
  /marathon pr           Pushes the marathon branch and creates/updates the stacked Pull Request on GitHub
  /marathon rollback     Hard-resets the active milestone to the previous verified git checkpoint
  /marathon abort        Cancels the active marathon and cleans up the working tree

Key Pillars:
  - Metis Milestone DAG: Break large systems into atomic, testable deliverables
  - Air-Gapped Evaluator: Apollo audits diffs and tests with zero biased transcript leakage
  - Git Checkpoint Rollback: Automatic reset to clean tags on failure, preventing regression traps
  - Σ-Mem Anti-Patterns: Negative learning across sessions to never repeat the same compiler or logic error`,
  execute: async (args, ctx) => {
    const trimmed = args.trim();
    const engine = new MarathonEngine({
      router: ctx.router,
      toolContext: ctx.toolContext,
      sessionManager: ctx.sessionManager,
      modelOverride: ctx.config?.modelOverride,
    });

    const activeRun = engine.getActiveRun();

    if (!trimmed || trimmed === 'status') {
      if (!activeRun) {
        console.log(pc.yellow('\n[MARATHON] No active marathon run found.'));
        console.log(pc.dim('  Start one with: /marathon <project goal>'));
        return;
      }
      console.log(pc.cyan(`\n════════════════════════════════════════════════════════════════`));
      console.log(pc.bold(pc.white(` [MARATHON ROADMAP STATUS]`)));
      console.log(pc.cyan(`════════════════════════════════════════════════════════════════\n`));
      console.log(renderRoadmapMarkdown(activeRun));
      console.log(pc.dim(`\nRoadmap saved at: ${activeRun.roadmapPath}`));
      return;
    }

    if (trimmed === 'rollback') {
      if (!activeRun) {
        console.log(pc.yellow('\n[MARATHON] No active marathon run to rollback.'));
        return;
      }
      const res = await engine.rollbackActiveMilestone();
      if (res.success) {
        console.log(pc.green(`\n[OK] ${res.message}`));
      } else {
        console.log(pc.red(`\n[ERROR] ${res.message}`));
      }
      return;
    }

    if (trimmed === 'abort') {
      if (!activeRun) {
        console.log(pc.yellow('\n[MARATHON] No active marathon run to abort.'));
        return;
      }
      activeRun.status = 'aborted';
      activeRun.completedAt = new Date().toISOString();
      console.log(pc.yellow(`\n[ABORTED] Marathon run ${activeRun.id} has been aborted.`));
      return;
    }

    if (trimmed === 'pr') {
      if (!activeRun) {
        console.log(pc.yellow('\n[MARATHON] No active marathon run found.'));
        return;
      }
      console.log(pc.cyan(`\n[MARATHON] Pushing milestone stack and creating/updating Pull Request...`));
      const res = await createMarathonStackedPR({
        projectRoot: ctx.toolContext.projectRoot,
        run: activeRun,
      });
      if (res.success && res.prUrl) {
        console.log(pc.bold(pc.green(`\n[PR] Stacked Pull Request ready:`)));
        console.log(pc.cyan(`     👉 ${res.prUrl}`));
      } else {
        console.log(pc.yellow(`\n[PR] ${res.message}`));
      }
      return;
    }

    if (trimmed === 'resume') {
      if (!activeRun) {
        console.log(pc.yellow('\n[MARATHON] No marathon run found to resume.'));
        return;
      }
      if (activeRun.status === 'completed') {
        console.log(pc.green('\n[MARATHON] Active marathon run is already completed!'));
        return;
      }
      activeRun.status = 'running';
      const root = ctx.toolContext.projectRoot || process.cwd();
      saveMarathonRun(root, activeRun);
      console.log(pc.cyan(`\n[MARATHON] Resuming run at milestone ${activeRun.activeMilestoneIndex + 1}/${activeRun.milestones.length}...`));
      let done = false;
      while (!done) {
        const step = await engine.executeNextMilestone();
        done = step.done;
      }
      return;
    }

    // Otherwise, start a new run
    try {
      await engine.startNewRun(trimmed);
      console.log(pc.cyan(`\n[MARATHON] Starting milestone execution...`));
      let done = false;
      while (!done) {
        const step = await engine.executeNextMilestone();
        done = step.done;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(pc.red(`\n[ERROR] Failed to execute marathon: ${msg}`));
    }
  },
};