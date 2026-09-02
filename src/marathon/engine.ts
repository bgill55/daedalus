import pc from 'picocolors';
import { LocalRouter } from '../router/index.js';
import { ToolContext, ChatMessage } from '../types.js';
import { SessionManager } from '../session/manager.js';
import { detectBaseBranch } from '../git/safe-git.js';
import { initProjectMemDb } from '../session/sqlite.js';
import { SigmaMemEngine } from '../session/sigma-mem.js';
import {
  MarathonRun,
  MarathonEvaluationReport,
} from './types.js';
import {
  initMarathonRun,
  loadMarathonRun,
  saveMarathonRun,
  updateMilestoneStatus,
  advanceToNextMilestone,
} from './state.js';
import {
  isGitRepository,
  createMilestoneCheckpoint,
  rollbackToLastCheckpoint,
  ensureMarathonBranch,
  getMilestoneTag,
} from './git-checkpoint.js';
import { planMarathonRoadmap } from './planner.js';
import { evaluateMilestone } from './evaluator.js';

export interface MarathonEngineOptions {
  router: LocalRouter;
  toolContext: ToolContext;
  sessionManager?: SessionManager;
  modelOverride?: string;
}

export class MarathonEngine {
  private router: LocalRouter;
  private toolContext: ToolContext;
  private sessionManager?: SessionManager;
  private modelOverride?: string;

  constructor(opts: MarathonEngineOptions) {
    this.router = opts.router;
    this.toolContext = opts.toolContext;
    this.sessionManager = opts.sessionManager;
    this.modelOverride = opts.modelOverride;
  }

  private get projectRoot(): string {
    return this.toolContext.projectRoot || process.cwd();
  }

  public getActiveRun(): MarathonRun | null {
    return loadMarathonRun(this.projectRoot);
  }

  public async startNewRun(macroGoal: string): Promise<MarathonRun> {
    const isGit = isGitRepository(this.projectRoot);
    const baseBranch = isGit ? detectBaseBranch(this.projectRoot) : 'main';

    console.log(pc.cyan(`\n[MARATHON] Initializing Harness-of-Harness run for: ${pc.bold(macroGoal)}`));
    console.log(pc.dim(`  Project root: ${this.projectRoot}`));
    console.log(pc.dim(`  Base branch:  ${baseBranch}`));

    // Step 1: Metis macro-planning
    console.log(pc.blue(`\n[METIS] Synthesizing milestone roadmap...`));
    const milestones = await planMarathonRoadmap(macroGoal, {
      router: this.router,
      modelOverride: this.modelOverride,
      projectContext: `Project at ${this.projectRoot}`,
    });

    console.log(pc.green(`[OK] Generated ${milestones.length} verifiable milestone(s).`));

    // Step 2: Initialize run state
    const run = initMarathonRun(this.projectRoot, macroGoal, baseBranch, milestones);

    if (isGit) {
      ensureMarathonBranch(this.projectRoot, run.marathonBranch, baseBranch);
      console.log(pc.green(`[OK] Integration branch prepared: ${run.marathonBranch}`));
    }

    run.status = 'running';
    saveMarathonRun(this.projectRoot, run);

    return run;
  }

  public async rollbackActiveMilestone(): Promise<{ success: boolean; message: string }> {
    const run = this.getActiveRun();
    if (!run) {
      return { success: false, message: 'No active marathon run found.' };
    }

    const activeIndex = run.activeMilestoneIndex;
    const currentMilestone = run.milestones[activeIndex];
    if (!currentMilestone) {
      return { success: false, message: 'No active milestone to rollback.' };
    }

    let targetTag: string | undefined;
    if (activeIndex > 0) {
      const prevMilestone = run.milestones[activeIndex - 1];
      targetTag = prevMilestone.gitTag || getMilestoneTag(prevMilestone.id);
    }

    if (targetTag) {
      const ok = rollbackToLastCheckpoint(this.projectRoot, targetTag);
      if (ok) {
        updateMilestoneStatus(run, currentMilestone.id, 'rolled_back');
        run.metrics.totalRollbacks += 1;
        saveMarathonRun(this.projectRoot, run);
        return {
          success: true,
          message: `Rolled back working tree to checkpoint ${targetTag}. Milestone ${currentMilestone.id} marked rolled back.`,
        };
      }
      return { success: false, message: `Failed to reset to checkpoint ${targetTag}.` };
    } else {
      // Rollback to base branch
      if (isGitRepository(this.projectRoot)) {
        ensureMarathonBranch(this.projectRoot, run.marathonBranch, run.baseBranch);
      }
      updateMilestoneStatus(run, currentMilestone.id, 'rolled_back');
      run.metrics.totalRollbacks += 1;
      saveMarathonRun(this.projectRoot, run);
      return {
        success: true,
        message: `Rolled back to clean base integration branch for milestone ${currentMilestone.id}.`,
      };
    }
  }

  public async executeNextMilestone(): Promise<{ done: boolean; run: MarathonRun }> {
    const run = this.getActiveRun();
    if (!run || run.status !== 'running') {
      throw new Error('No running marathon to execute.');
    }

    const milestone = run.milestones[run.activeMilestoneIndex];
    if (!milestone) {
      run.status = 'completed';
      saveMarathonRun(this.projectRoot, run);
      return { done: true, run };
    }

    console.log(pc.bold(pc.cyan(`\n════════════════════════════════════════════════════════════════`)));
    console.log(pc.bold(pc.white(` [MARATHON] Executing Milestone ${milestone.id.toUpperCase()}: ${milestone.title}`)));
    console.log(pc.dim(` ${milestone.description}`));
    console.log(pc.dim(` Attempt ${milestone.attempts + 1} of ${milestone.maxAttempts}`));
    console.log(pc.bold(pc.cyan(`════════════════════════════════════════════════════════════════\n`)));

    updateMilestoneStatus(run, milestone.id, 'in_progress');
    milestone.attempts += 1;
    run.metrics.totalIterations += 1;
    saveMarathonRun(this.projectRoot, run);

    // Dynamic import Orchestrator to prevent circular imports
    const { Orchestrator } = await import('../agents/orchestrator.js');
    const messages: ChatMessage[] = [];
    const orchestrator = new Orchestrator(
      this.router,
      messages,
      this.toolContext,
      this.sessionManager,
      this.modelOverride
    );

    // Step A: Implementation Sprint
    const goal = `Milestone ${milestone.id.toUpperCase()}: ${milestone.title}\n${milestone.description}\nTarget files: ${milestone.targetFiles.join(', ') || 'as needed'}`;
    let sprintPassed = true;

    const prevAutoApprove = process.env.DAEDALUS_AUTO_APPROVE;
    process.env.DAEDALUS_AUTO_APPROVE = 'true';
    try {
      const result = await orchestrator.run(goal);
      if (result.includes('Orchestration failed') || result.includes('## Orchestration Hit Verification Failures')) {
        sprintPassed = false;
      }
    } catch {
      sprintPassed = false;
    } finally {
      if (prevAutoApprove !== undefined) {
        process.env.DAEDALUS_AUTO_APPROVE = prevAutoApprove;
      } else {
        delete process.env.DAEDALUS_AUTO_APPROVE;
      }
    }

    // Step B: Air-Gapped Apollo Evaluation
    console.log(pc.magenta(`\n[APOLLO] Running air-gapped independent evaluation...`));
    run.status = 'evaluating';
    saveMarathonRun(this.projectRoot, run);

    const prevTag = run.activeMilestoneIndex > 0
      ? run.milestones[run.activeMilestoneIndex - 1].gitTag
      : undefined;

    const report: MarathonEvaluationReport = await evaluateMilestone(
      milestone,
      {
        router: this.router,
        modelOverride: this.modelOverride,
        projectRoot: this.projectRoot,
      },
      prevTag
    );

    run.metrics.totalEvaluations += 1;
    milestone.evalReport = report;
    console.log(pc.white(`\n[APOLLO AUDIT REPORT]`));
    console.log(`  Verdict:    ${report.passed ? pc.bold(pc.green('PASSED')) : pc.bold(pc.red('FAILED'))}`);
    console.log(`  Score:      ${report.score >= 80 ? pc.green(`${report.score}/100`) : pc.red(`${report.score}/100`)}`);
    console.log(`  Summary:    ${report.summary}`);

    if (report.regressions.length > 0) {
      console.log(pc.yellow(`  Regressions: ${report.regressions.join(', ')}`));
    }

    // Connect with Σ-Mem Anti-Pattern engine
    try {
      const db = initProjectMemDb(this.projectRoot);
      if (!report.passed || !sprintPassed) {
        SigmaMemEngine.recordAntiPattern(db, {
          taskCategory: 'marathon_milestone',
          targetFile: milestone.targetFiles[0],
          attemptSummary: `Failed milestone ${milestone.id}: ${milestone.title}`,
          errorSignature: report.summary || 'Failed verification criteria',
          suggestedAlternative: report.repairRecommendations[0],
        });
        db.close();
      } else {
        if (milestone.targetFiles[0]) {
          SigmaMemEngine.resolveAntiPattern(
            db,
            milestone.targetFiles[0],
            `Completed milestone ${milestone.id}: ${milestone.title}`
          );
        }
        db.close();
      }
    } catch {
      // Memory persistence best effort
    }

    // Step C: Checkpoint or Rollback Arbitration
    if (sprintPassed && report.passed && report.score >= 70) {
      console.log(pc.green(`\n[OK] Milestone ${milestone.id.toUpperCase()} approved by Apollo.`));
      const cp = createMilestoneCheckpoint(this.projectRoot, milestone);
      updateMilestoneStatus(run, milestone.id, 'passed', {
        gitTag: cp?.tag,
        gitCommit: cp?.commit,
      });

      const hasMore = advanceToNextMilestone(run);
      if (hasMore) {
        run.status = 'running';
        saveMarathonRun(this.projectRoot, run);
        return { done: false, run };
      } else {
        console.log(pc.bold(pc.green(`\n🎉 [MARATHON COMPLETED] All milestones achieved successfully!`)));
        run.status = 'completed';
        saveMarathonRun(this.projectRoot, run);
        return { done: true, run };
      }
    } else {
      console.log(pc.red(`\n[FAIL] Milestone ${milestone.id.toUpperCase()} failed evaluation.`));

      if (milestone.attempts < milestone.maxAttempts) {
        console.log(pc.yellow(`[REPAIR] Retrying milestone with targeted healing recommendations...`));
        run.status = 'running';
        saveMarathonRun(this.projectRoot, run);
        return { done: false, run };
      } else {
        console.log(pc.bold(pc.red(`\n[ARBITRATOR] Max attempts reached for ${milestone.id}. Executing hard rollback...`)));
        await this.rollbackActiveMilestone();
        run.status = 'paused';
        saveMarathonRun(this.projectRoot, run);
        console.log(pc.yellow(`[PAUSED] Run paused at milestone ${milestone.id}. Inspect MARATHON_ROADMAP.md and run '/marathon resume'.`));
        return { done: true, run };
      }
    }
  }
}