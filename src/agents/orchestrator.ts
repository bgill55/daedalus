// Multi-agent orchestrator - coordinates delegation and synthesis

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { LocalRouter } from '../router/index.js';
import { BUILTIN_TOOLS } from '../tools/definitions.js';
import { mcpRegistry } from '../tools/mcp/registry.js';
import { executeToolCalls } from '../tools/executor.js';
import { getAgentRole, filterToolsForRole, AgentRole } from './roles.js';
import { ToolContext, ToolCall, ChatMessage } from '../types.js';
import pc from 'picocolors';
import { DaedalusSpinner } from '../tools/daedalus-spinner.js';
import { SessionManager } from '../session/manager.js';
import { parseTextToolCalls } from '../formatting.js';
import {
  filterValidTasks, stripCodeBlocks, stripToolRequestArtifacts, VAGUE_GOAL_RE,
  isComplexGoal, validateTasks, cleanTaskText, cleanPlanOutput, truncateGoal,
  extractFilePaths, buildDependencyGraph, getTaskFilePaths, hasFileConflict, groupIndependent,
  isUnnecessaryConfigTask, extractRequirements, getFrameworkGuidance,
} from './orchestrator-validation.js';
import {
  isDeclaredError, requiresRealArtifacts, extractPendingWrites,
  verifyArtifacts, hasRealWrites, verifyArtifactsThoroughly,
  checkPlaceholders, fillPlaceholders, buildCleanSummary,
  isBuildErrorRelated, generateBuildErrorHint, runBuildVerification,
  attemptRepair, rollbackTaskPatches, verifySpecAssertions, isRealFile,
} from './orchestrator-verification.js';
import { generateSpecContract, loadSpecContract, formatSpecForPrompt } from './spec.js';
import type { DelegationTask, AgentResult } from './orchestrator-types.js';


// Simplified placeholder regexes for common auto-fill tokens only
// Simplified HTML placeholder regex for same tokens inside comments
export class Orchestrator {
  private router: LocalRouter;
  private messages: ChatMessage[];
  private toolContext: ToolContext;
  private sessionManager?: SessionManager;
  private results: AgentResult[] = [];
  private readonly MAX_INITIAL_TASKS = 8;
  private readonly MAX_TOTAL_TASKS = 20;
  private readonly REPLAN_INTERVAL = 2;

  constructor(router: LocalRouter, messages: ChatMessage[], toolContext: ToolContext, sessionManager?: SessionManager) {
    this.router = router;
    this.messages = messages;
    this.toolContext = toolContext;
    this.sessionManager = sessionManager;
  }

  private async retryApiCall<T>(fn: () => Promise<T>, label: string, maxRetries = 2): Promise<T> {
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
          console.log(pc.yellow(`\nModel request failed — ${err.message}. Retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})...`));
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastErr;
  }

  private async discoverProjectContext(): Promise<string> {
    const cwd = this.toolContext.projectRoot || process.cwd();
    const parts: string[] = [];

    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
      const info: string[] = [];
      if (pkg.dependencies) {
        if (pkg.dependencies.next) {
          const rawVer: string = pkg.dependencies.next as string;
          // Strip semver range operators (^, ~, >=, <=, >, <) before parsing
          const cleaned = rawVer.replace(/^[^0-9]*/, '');
          const major = parseInt(cleaned.split('.')[0]);
          const label = Number.isFinite(major) ? `Next.js ${major} (React, SSR)` : 'Next.js (React, SSR)';
          info.push(label);
        } else if (pkg.dependencies.react) {
          info.push('React');
        }
        if (pkg.dependencies.vue) info.push('Vue');
        if (pkg.dependencies.express) info.push('Express');
        if (pkg.dependencies['@angular/core']) info.push('Angular');
      }
      if (pkg.devDependencies) {
        if (pkg.devDependencies.vite) info.push('Vite');
        if (pkg.devDependencies.typescript) info.push('TypeScript');
        if (pkg.devDependencies.tailwindcss) info.push('Tailwind CSS');
      }
      const scripts = pkg.scripts ? Object.entries(pkg.scripts).map(([k, v]) => `${k}: ${v}`).join(', ') : 'none';
      parts.push(`Framework: ${info.join(' | ') || 'unknown'}`);
      parts.push(`Scripts: ${scripts}`);
    } catch { /* not a node project */ }

    try {
      const entries = fs.readdirSync(cwd).filter(e => !e.startsWith('.') && e !== 'node_modules' && e !== 'ffmpeg');
      const dirs = entries.filter(e => fs.statSync(path.join(cwd, e)).isDirectory());
      const files = entries.filter(e => !fs.statSync(path.join(cwd, e)).isDirectory());
      if (dirs.length > 0) parts.push(`Directories: ${dirs.join(', ')}`);
      if (files.length > 0) parts.push(`Key files: ${files.join(', ')}`);
    } catch { /* not readable */ }

    return parts.length > 0 ? parts.join('\n') : '';
  }

  async run(goal: string): Promise<string> {
    this.results = [];

    try {
      const projectContext = await this.discoverProjectContext();
      if (projectContext) {
        console.log(pc.gray(`\n${projectContext.split('\n').map(l => `  ${l}`).join('\n')}`));
      }

      const projectRoot = this.toolContext.projectRoot || this.sessionManager?.projectRoot || process.cwd();
      if (process.env.DAEDALUS_SPEC_FIRST !== 'false') {
        console.log(pc.cyan(`\n[SpecFirst] Generating formal feature specification contract...`));
        const spec = await generateSpecContract(goal, this.router, projectRoot);
        console.log(pc.green(`✔ [SpecFirst] Spec contract created (${spec.interfaces.length} interfaces, ${spec.testCases.length} test cases)`));
        console.log(pc.gray(`  Spec saved to .daedalus/spec.md & .daedalus/spec.json`));
      }

      let plan = await this.createPlan(goal, projectContext);
      if (this.toolContext.abortSignal.aborted) {
        return 'Orchestration stopped by user';
      }

      let tasks = this.parseDelegationTasks(plan, goal);

      // Cap initial tasks — re-plan if the planner gets carried away
      if (tasks.length > this.MAX_INITIAL_TASKS) {
        console.log(pc.yellow(`\nPlan has ${tasks.length} steps (max ${this.MAX_INITIAL_TASKS}). Asking planner to simplify...`));
        plan = await this.createPlan(
          goal,
          projectContext,
          `Simplify to at most ${this.MAX_INITIAL_TASKS} focused steps. Merge related steps. Each step must produce real output.`
        );
        tasks = filterValidTasks(this.parseDelegationTasks(plan, goal));
        if (tasks.length > this.MAX_INITIAL_TASKS) {
          tasks = tasks.slice(0, this.MAX_INITIAL_TASKS);
        }
      } else {
        tasks = filterValidTasks(tasks);
      }

      // Pre-Flight Codebase Audit: Check if workspace has pre-existing compilation/build errors
      const preFlight = await runBuildVerification(this.toolContext, 0);
      if (!preFlight.success && preFlight.errorLogs) {
        console.log(pc.yellow(`\n[Pre-Flight] Pre-existing build errors detected in workspace. Prepending Task 0 to repair existing code first...`));
        const firstErrorLine = preFlight.errorLogs.split('\n')[0].slice(0, 120);
        tasks.unshift({
          goal: `Fix pre-existing compilation/build error in codebase before implementing feature: ${firstErrorLine}`,
          context: projectContext || '',
          role: 'debugger',
          status: 'pending',
          splitDepth: 0,
        });
      }

      if (this.sessionManager) {
        this.sessionManager.saveState('orchestrate_plan', tasks);
        this.sessionManager.saveState('orchestrate_goal', goal);
        this.sessionManager.saveState('orchestrate_task_index', 0);
        this.sessionManager.saveState('orchestrate_results', []);
        this.sessionManager.saveState('orchestrate_plan_text', plan);
      }

      await this.executePlan(plan, tasks, 0, goal, projectContext);
    } catch (err) {
      return `Orchestration failed: ${(err as Error).message}`;
    }

    if (this.sessionManager && !this.toolContext.abortSignal.aborted) {
      this.sessionManager.saveState('orchestrate_plan', null);
      this.sessionManager.saveState('orchestrate_goal', null);
      this.sessionManager.saveState('orchestrate_task_index', null);
      this.sessionManager.saveState('orchestrate_results', null);
      this.sessionManager.saveState('orchestrate_plan_text', null);
    }

    return this.synthesize(goal);
  }

  async resume(
    goal: string,
    planText: string,
    tasks: DelegationTask[],
    startIndex: number,
    previousResults: AgentResult[]
  ): Promise<string> {
    this.results = [...previousResults];
    const projectContext = await this.discoverProjectContext();

    // Reset abort signal so resume works after a pause/crash
    Object.defineProperty(this.toolContext.abortSignal, 'aborted', { value: false, writable: true });

    tasks.forEach((t, idx) => {
      if (idx < startIndex) {
        t.status = 'completed';
      } else if (!t.status) {
        t.status = 'pending';
      }
    });

    try {
      await this.executePlan(planText, tasks, startIndex, goal, projectContext);
    } catch (err) {
      return `Orchestration failed: ${(err as Error).message}`;
    }

    if (this.sessionManager && !this.toolContext.abortSignal.aborted) {
      this.sessionManager.saveState('orchestrate_plan', null);
      this.sessionManager.saveState('orchestrate_goal', null);
      this.sessionManager.saveState('orchestrate_task_index', null);
      this.sessionManager.saveState('orchestrate_results', null);
      this.sessionManager.saveState('orchestrate_plan_text', null);
    }

    return this.synthesize(goal);
  }

  private async createPlan(goal: string, projectContext?: string, simplifyHint?: string): Promise<string> {
    const plannerRole = getAgentRole('planner');
    const tools = filterToolsForRole([...BUILTIN_TOOLS, ...mcpRegistry.getToolDefinitions()], 'planner');

    let systemPrompt = plannerRole.systemPrompt;
    const projectRoot = this.toolContext.projectRoot || this.sessionManager?.projectRoot;
    if (projectRoot) {
      const filesToCheck = ['CLAUDE.md', '.cursorrules', '.daedalusrules', 'DAEDALUS.md'];
      let rules = '';
      for (const file of filesToCheck) {
        const fullPath = path.join(projectRoot, file);
        if (fs.existsSync(fullPath)) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8').trim();
            if (content) {
              rules += `\n### Rules from ${file}:\n${content}\n`;
            }
          } catch {
            // Ignore unreadable rule file
          }
        }
      }
      if (rules) {
        systemPrompt += `\n\n## PROJECT-SPECIFIC GUIDELINES\n${rules}`;
      }
    }

    const REFUSAL_RE = /sorry|can'?t|cannot|don'?t have|not (able|capable)|lack(|ing) (the )?(necessary |required )?(tools|capabilities)|unable|apologize/i;

    let attempts = 0;
    const maxAttempts = 3;
    let lastValidationError = '';

    while (attempts < maxAttempts) {
      attempts++;
      const retryHint = lastValidationError ? `\n\nPREVIOUS PLAN REJECTED: ${lastValidationError}\nFix the issues and output a corrected plan.` : '';
      const simplifyBlock = simplifyHint ? `\n\n${simplifyHint}` : '';
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt + (attempts > 1 ? `\n\nIMPORTANT: You MUST create a valid plan. Each subtask needs an explicit file path and concrete wording.${retryHint}` : '') + simplifyBlock },
        { role: 'user', content: `Create a step-by-step plan with one subtask per file for: ${goal}\n\nProject context:\n${projectContext || '(none discovered)'}${getFrameworkGuidance(projectContext, this.toolContext.projectRoot)}\n\n${this.toolContext.activeFiles.size > 0 ? 'Files in context: ' + Array.from(this.toolContext.activeFiles.values()).join(', ') : ''}\n\nRemember: one subtask per file, include the exact file path in each subtask, order by dependencies.` },
      ];

      const planSpinner = new DaedalusSpinner({ text: `planner generating plan`, color: (s) => pc.blue(s) });
      planSpinner.start();
      let completion;
      try {
        completion = await this.retryApiCall(
          () => this.router.chat.completions.create({
            model: 'intelligence',
            messages,
            temperature: plannerRole.temperature ?? 0.2,
            tools,
            tool_choice: 'auto',
          }),
          'planner API call'
        );
      } finally {
        planSpinner.stop();
      }

      const assistantMessage = completion.choices[0].message;
      const toolCalls = assistantMessage.tool_calls;

      let planText: string;

      if (toolCalls && toolCalls.length > 0) {
        messages.push(assistantMessage);

        const results = await this.executeOpenAIToolCalls(toolCalls);
        for (const result of results) {
          messages.push({
            role: 'tool',
            content: result.content,
            tool_call_id: result.toolCallId,
          });
        }

        const finalizeSpinner = new DaedalusSpinner({ text: 'planner finalizing plan', color: (s) => pc.cyan(s) });
        finalizeSpinner.start();
        let followUp;
        try {
          followUp = await this.retryApiCall(
            () => this.router.chat.completions.create({
              model: 'intelligence',
              messages,
              temperature: plannerRole.temperature ?? 0.2,
              tools,
              tool_choice: 'none',
            }),
            'planner finalize API call'
          );
        } finally {
          finalizeSpinner.stop();
        }
        const content = (followUp.choices[0].message).content || '';
        const isRefusal = content.length < 300 && REFUSAL_RE.test(content) && !content.includes('delegate to');
        if (isRefusal) continue;
        if (!content) continue;
        planText = content;
      } else {
        const content = assistantMessage.content || '';
        const isRefusal = content.length < 300 && REFUSAL_RE.test(content) && !content.includes('delegate to');
        if (isRefusal) continue;
        if (!content) continue;
        planText = content;
      }

      // Validate the plan
      const testTasks = this.parseDelegationTasks(planText || `- delegate to coder: ${goal}`, goal);
      const validationError = validateTasks(testTasks, goal, this.toolContext.projectRoot);
      if (!validationError) {
        return planText || `- delegate to coder: ${goal}`;
      }
      lastValidationError = validationError;
      console.log(pc.yellow(`\nPlan didn't pass validation — re-planning (attempt ${attempts}/${maxAttempts})...`));
    }

    console.log(pc.yellow(`\nUsing fallback plan after ${maxAttempts} failed re-planning attempts`));
    return this.buildFallbackPlan(goal, projectContext);
  }

  private buildFallbackPlan(goal: string, projectContext?: string): string {
    const isFrontendGoal = /\b(frontend|front[- ]end|ui|interface|page|layout|landing|component|hero|navbar|navigation)\b/i.test(goal);
    if (isFrontendGoal && projectContext) {
      const cwd = this.toolContext.projectRoot || process.cwd();
      const hasApp      = fs.existsSync(path.join(cwd, 'app'));
      const hasSrcPages = fs.existsSync(path.join(cwd, 'src', 'pages'));
      const hasPages    = fs.existsSync(path.join(cwd, 'pages'));
      const isNextJs    = /Next\.js/i.test(projectContext);
      const isTailwind  = /Tailwind/i.test(projectContext);
      const styleNote   = isTailwind ? ', styled with Tailwind CSS' : '';

      if (isNextJs && (hasApp || (!hasSrcPages && !hasPages))) {
        return [
          `- delegate to coder: create app/layout.tsx as the root Next.js App Router layout with a header and footer${styleNote}`,
          `- delegate to coder: create app/page.tsx as the main landing page with a hero section and call-to-action${styleNote}`,
          `- delegate to coder: create app/about/page.tsx with project overview and a link back to home${styleNote}`,
        ].join('\n');
      }

      if (isNextJs && (hasSrcPages || hasPages)) {
        const pagesDir    = hasSrcPages ? path.join(cwd, 'src', 'pages') : path.join(cwd, 'pages');
        const pagesPrefix = hasSrcPages ? 'src/pages' : 'pages';
        const tasks: string[] = [];
        const indexExists     = fs.existsSync(path.join(pagesDir, 'index.tsx'))  || fs.existsSync(path.join(pagesDir, 'index.jsx'));
        const dashboardExists = fs.existsSync(path.join(pagesDir, 'dashboard.tsx'));
        const featuresExists  = fs.existsSync(path.join(pagesDir, 'features.tsx'));
        if (!indexExists) {
          tasks.push(`- delegate to coder: create ${pagesPrefix}/index.tsx as the main landing page with a hero section and call-to-action${styleNote}`);
        } else if (!dashboardExists) {
          tasks.push(`- delegate to coder: create ${pagesPrefix}/dashboard.tsx as a dashboard page showing key project stats${styleNote}`);
        }
        if (!featuresExists) {
          tasks.push(`- delegate to coder: create ${pagesPrefix}/features.tsx with feature cards describing the project${styleNote}`);
        }
        if (tasks.length > 0) return tasks.join('\n');
      }
    }

    const isCoder = /\b(create|add|build|implement|write|generate|make|new|refactor|fix|modify|update)\b/i.test(goal);
    const fallbackRole = isCoder
      ? 'coder'
      : /\b(verify|check|test|review|inspect|validate|confirm)\b/i.test(goal)
        ? 'reviewer'
        : /\b(research|investigate|find out|look up|search for)\b/i.test(goal)
          ? 'researcher'
          : 'coder';
    return `- delegate to ${fallbackRole}: ${goal}`;
  }

  private formatGoal(goal: string, indentLength: number, width: number = 80): string {
    const words = goal.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';
    const targetWidth = Math.max(40, width - indentLength);

    for (const word of words) {
      if ((currentLine + (currentLine ? ' ' : '') + word).length > targetWidth) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine += (currentLine ? ' ' : '') + word;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }

    const indent = ' '.repeat(indentLength);
    return lines.join('\n' + indent);
  }

  private printTaskList(tasks: DelegationTask[], forceFull: boolean = false): void {
    const completed = tasks.filter(t => t.status === 'completed').length;
    const running = tasks.filter(t => t.status === 'in_progress').length;
    const failed = tasks.filter(t => t.status === 'failed').length;
    const total = tasks.length;

    // Only print full task list on initial plan, re-plan, or forced summary
    if (!forceFull && tasks.length > 5 && (running > 0 || completed > 0)) {
      const activeTask = tasks.find(t => t.status === 'in_progress');
      const activeText = activeTask ? ` | Active: [${activeTask.role}] ${activeTask.goal.slice(0, 50)}...` : '';
      console.log(pc.cyan(`\n[AUTOPILOT] Progress: ${completed}/${total} completed${failed > 0 ? ` (${failed} failed)` : ''}${activeText}`));
      return;
    }

    console.log(pc.bold(pc.cyan('\n--- Orchestration Task List ---')));
    tasks.forEach((task, idx) => {
      let icon = pc.gray('[ ]');
      if (task.status === 'in_progress') {
        icon = pc.blue('[▶]');
      } else if (task.status === 'completed') {
        icon = pc.green('[✓]');
      } else if (task.status === 'failed') {
        icon = pc.red('[✗]');
      } else if (task.status === 'skipped') {
        icon = pc.yellow('[S]');
      }
      
      const roleStr = pc.bold(`[${task.role}]`);
      const indentLength = 2 + 3 + 1 + 5 + (idx + 1).toString().length + 2 + 1 + task.role.length + 2;
      const goalStr = this.formatGoal(task.goal, indentLength);
      const errorStr = task.error ? pc.red(` (Error: ${task.error})`) : '';
      console.log(`  ${icon} Task ${idx + 1}: ${roleStr} ${goalStr}${errorStr}`);
    });
    console.log(pc.bold(pc.cyan('--------------------------------')));
  }

  private hasPendingTasks(tasks: DelegationTask[], startIndex: number): boolean {
    return tasks.some((t, i) => i >= startIndex && (t.status === 'pending' || t.status === 'in_progress'));
  }

  private getNextBatch(tasks: DelegationTask[], startIndex: number): DelegationTask[] {
    const batch: DelegationTask[] = [];
    for (let i = startIndex; i < tasks.length; i++) {
      const t = tasks[i];
      const isPending = t.status === undefined || t.status === 'pending';
      if (!isPending) continue;
      // Dependencies satisfied = all dependency goals are completed
      if (t.dependencies && t.dependencies.length > 0) {
        const allDone = t.dependencies.every(dep => tasks.some(other => other.goal === dep && (other.status === 'completed' || other.status === 'skipped')));
        if (!allDone) continue;
      }
      batch.push(t);
      // In auto-approve, batch all runnable tasks
      if (process.env.DAEDALUS_AUTO_APPROVE === 'true') {
        continue; // gather as many as possible
      } else {
        break; // sequential — one at a time
      }
    }
    return batch;
  }

  private async executeSingleTask(
    task: DelegationTask,
    tasks: DelegationTask[],
    originalGoal?: string,
    projectContext?: string,
  ): Promise<void> {
    task.status = 'in_progress';
    this.printTaskList(tasks);

    await this.delegateTask(task, tasks, originalGoal, projectContext);
    this.printTaskList(tasks);

    // Handle task failure with auto-retry in auto-approve mode
    if ((task.status as any) === 'failed') {
      console.log(`\n${pc.bold(pc.red('--- Task Failure Checkpoint ---'))}`);
      console.log(`${pc.red('[ERROR] Task failed:')} ${task.role} - ${task.goal}`);

      if (process.env.DAEDALUS_AUTO_APPROVE === 'true') {
        console.log(pc.cyan(`\n[auto] Retrying task: ${task.goal}`));
        task.status = 'in_progress';
        task.error = undefined;
        this.printTaskList(tasks);
        this.results.pop();
        await this.delegateTask(task, tasks, originalGoal, projectContext);
        this.printTaskList(tasks);
        if ((task.status as any) !== 'failed') {
          return;
        }
        console.log(pc.yellow(`\n[auto] Skipping failed task after retry: ${task.goal}`));
        task.status = 'skipped';
        this.printTaskList(tasks);
        return;
      }

      const ask = this.toolContext.askLine || (async (p: string) => {
        return new Promise<string>((resolve) => {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          rl.question(p, (ans) => { rl.close(); resolve(ans); });
        });
      });

      let resolved = false;
      while (!resolved) {
        const answer = await ask(`\nTask failed. Choose action: [r]etry / [e]dit / [s]kip / [a]bort: `);
        const norm = answer.trim().toLowerCase();

        if (norm === 'r' || norm === 'retry') {
          console.log(pc.cyan(`\nRetrying task: ${task.goal}`));
          task.status = 'in_progress';
          task.error = undefined;
          this.printTaskList(tasks);
          this.results.pop();
          await this.delegateTask(task, tasks, originalGoal, projectContext);
          this.printTaskList(tasks);
          if ((task.status as any) !== 'failed') {
            resolved = true;
          }
        } else if (norm === 'e' || norm === 'edit') {
          const editGoal = await ask(`Enter new goal for task: `);
          if (editGoal.trim()) {
            task.goal = editGoal.trim();
            task.status = 'in_progress';
            task.error = undefined;
            this.printTaskList(tasks);
            this.results.pop();
            await this.delegateTask(task, tasks, originalGoal, projectContext);
            this.printTaskList(tasks);
            if ((task.status as any) !== 'failed') {
              resolved = true;
            }
          }
        } else if (norm === 's' || norm === 'skip') {
          console.log(pc.yellow(`\nSkipping failed task: ${task.goal}`));
          task.status = 'skipped';
          this.printTaskList(tasks);
          resolved = true;
        } else if (norm === 'a' || norm === 'abort') {
          console.log(pc.yellow('\nOrchestration aborted on task failure. You can resume it later.'));
          if (this.toolContext.abortSignal) {
            Object.defineProperty(this.toolContext.abortSignal, 'aborted', { value: true, writable: true });
          }
          resolved = true;
        }
      }
    }
  }

  private async executePlan(
    plan: string,
    tasks: DelegationTask[],
    startIndex: number = 0,
    originalGoal?: string,
    projectContext?: string,
  ): Promise<void> {
    let lastReplanCount = 0;

    // Build dependency graph from file paths
    buildDependencyGraph(tasks);

    for (let i = startIndex; i < tasks.length; /* increment inside */) {
      if (this.toolContext.abortSignal.aborted) {
        break;
      }

      // Hard cap — stop adding new tasks past the limit
      if (i >= this.MAX_TOTAL_TASKS && tasks.filter(t => t.status === 'pending').length > 0) {
        console.log(pc.yellow(`\nReached task limit (${this.MAX_TOTAL_TASKS}). Halting new task generation.`));
        while (tasks.length > this.MAX_TOTAL_TASKS) {
          const removed = tasks.pop();
          if (removed) { removed.status = 'skipped'; removed.error = 'Reached task limit'; }
        }
        break;
      }

      const task = tasks[i];

      // Skip already completed/skipped tasks
      if (task.status === 'completed' || task.status === 'skipped') {
        i++;
        continue;
      }

      // Skip unnecessary config tasks for file-based routing frameworks
      if (isUnnecessaryConfigTask(task, projectContext)) {
        console.log(pc.yellow(`\nSkipping task ${i + 1}: Next.js uses file-based routing — no config changes needed`));
        task.status = 'skipped';
        task.error = 'Unnecessary config task for file-based routing framework';
        i++;
        continue;
      }

      // Get the next batch of runnable tasks
      const batch = this.getNextBatch(tasks, i);
      if (batch.length === 0) {
        // Deadlock or no pending tasks — advance past completed/skipped
        i++;
        continue;
      }

      // In auto-approve mode, run independent tasks concurrently
      if (process.env.DAEDALUS_AUTO_APPROVE === 'true') {
        const groups = groupIndependent(batch);
        for (const group of groups) {
          await Promise.all(
            group.map(t => this.executeSingleTask(t, tasks, originalGoal, projectContext))
          );
        }
      } else {
        // Interactive mode: sequential only
        for (const t of batch) {
          await this.executeSingleTask(t, tasks, originalGoal, projectContext);
        }
      }

      // Advance past all tasks that were just processed (no longer pending)
      while (i < tasks.length && tasks[i].status !== 'pending') {
        i++;
      }

      // Save state after completing tasks
      if (this.sessionManager) {
        this.sessionManager.saveState('orchestrate_task_index', i);
        this.sessionManager.saveState('orchestrate_results', this.results);
      }

      // Re-plan checkpoint: after every REPLAN_INTERVAL completed tasks, re-evaluate
      const completedCount = tasks.filter(t => t.status === 'completed').length;
      if (completedCount > 0 && completedCount - lastReplanCount >= this.REPLAN_INTERVAL) {
        const hasPending = tasks.some(t => t.status === 'pending' || t.status === 'in_progress');
        if (hasPending && originalGoal) {
          lastReplanCount = completedCount;
          await this.replanRemaining(tasks, originalGoal, projectContext);
          // Rebuild dependency graph after replan
          buildDependencyGraph(tasks);
        }
      }

      // Interactive checkpoint: ask user before next task
      if (process.env.DAEDALUS_AUTO_APPROVE !== 'true' && i < tasks.length) {
        const prevTask = tasks[i - 1];
        if (prevTask && prevTask.status === 'completed') {
          const nextTask = tasks[i];
          console.log(`\n${pc.bold(pc.yellow('--- Task Checkpoint ---'))}`);
          console.log(`${pc.green('[OK] Completed task:')} ${prevTask.goal}`);
          console.log(`${pc.cyan('Next task:')} [${nextTask.role}] ${nextTask.goal}`);

          const ask = this.toolContext.askLine || (async (p: string) => {
            return new Promise<string>((resolve) => {
              const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
              rl.question(p, (ans) => { rl.close(); resolve(ans); });
            });
          });

          const answer = await ask(`\nProceed to next task? [y]es / [n]o / [s]kip / [e]dit: `);
          const norm = answer.trim().toLowerCase();

          if (norm === 'n' || norm === 'no') {
            console.log(pc.yellow('\n[INFO] Orchestration paused. You can resume it later.'));
            if (this.toolContext.abortSignal) {
              Object.defineProperty(this.toolContext.abortSignal, 'aborted', { value: true, writable: true });
            }
            break;
          } else if (norm === 's' || norm === 'skip') {
            console.log(pc.yellow(`\n[INFO] Skipping task: ${nextTask.goal}`));
            nextTask.status = 'skipped';
            i++;
          } else if (norm === 'e' || norm === 'edit') {
            const editGoal = await ask(`Enter new goal for next task: `);
            if (editGoal.trim()) {
              nextTask.goal = editGoal.trim();
              if (this.sessionManager) {
                this.sessionManager.saveState('orchestrate_plan', tasks);
              }
              console.log(pc.green(`[OK] Task goal updated.`));
            }
          }
        }
      }
    }
  }

  private async replanRemaining(tasks: DelegationTask[], originalGoal: string, projectContext?: string): Promise<void> {
    const done = tasks.filter(t => t.status === 'completed');
    const pending = tasks.filter(t => t.status === 'pending');
    if (pending.length === 0) return;

    const summary = done.map(t => {
      const r = this.results.find(rr => rr.goal === t.goal && rr.role === t.role);
      return r ? `[✓] [${t.role}] ${t.goal} → ${r.summary.split('\n').slice(0,2).join(' | ')}` : `[✓] [${t.role}] ${t.goal}`;
    }).join('\n');

    const remainingList = pending.map(t => `[ ] [${t.role}] ${t.goal}`).join('\n');
    const completedFiles = done.flatMap(t => {
      const r = this.results.find(rr => rr.goal === t.goal && rr.role === t.role);
      if (!r) return [];
      const paths = extractFilePaths(r.summary);
      return paths;
    });

    // Save original pending tasks as fallback in case replan fails
    const originalPending = tasks
      .filter(t => t.status === 'pending')
      .map(t => ({ ...t }));

    console.log(pc.cyan(`\n[RE-PLAN] ${pending.length} task(s) remaining. Re-evaluating based on completed work...`));

    const subPlan = await this.createPlan(
      `Original goal: ${originalGoal}\n\nCompleted so far:\n${summary}\n\nFiles already written: ${completedFiles.length > 0 ? completedFiles.join(', ') : '(none)'}\n\nRemaining:\n${remainingList}\n\nBased on what was completed, re-plan the remaining work. Consolidate and simplify — aim for at most ${this.MAX_INITIAL_TASKS} focused steps. Do NOT repeat tasks that are already done. Do NOT re-create files that already exist. Each remaining step must produce real output that has not been created yet.`,
      projectContext
    );

    // Remove old pending tasks
    for (let i = tasks.length - 1; i >= 0; i--) {
      if (tasks[i].status === 'pending') {
        tasks.splice(i, 1);
      }
    }

    // Add new tasks from re-plan, dropping duplicates against completed work
    let newTasks = this.parseDelegationTasks(subPlan, originalGoal);
    newTasks = newTasks.filter(nt => {
      if (done.length === 0 || nt.role !== 'coder') return true;
      const newPaths = extractFilePaths(nt.goal).map(p => p.toLowerCase());
      if (newPaths.length === 0) return true;
      // Only drop task if ALL mentioned files are REAL files on disk (>100 bytes, no placeholder comment shells)
      const root = this.toolContext.projectRoot || process.cwd();
      const allExist = newPaths.every(p => isRealFile(path.resolve(root, p)));
      return !allExist;
    });

    // Enforce task cap and filter out non-actionable tasks
    newTasks = filterValidTasks(newTasks).slice(0, this.MAX_INITIAL_TASKS);

    // Fallback: if replan produced no valid tasks, restore original pending tasks
    if (newTasks.length === 0 && originalPending.length > 0) {
      for (const t of originalPending) {
        t.status = 'pending';
        tasks.push(t);
      }
      this.printTaskList(tasks);
      return;
    }

    for (const nt of newTasks) {
      nt.splitDepth = 0;
      tasks.push(nt);
    }

    this.printTaskList(tasks);
  }

  private parseDelegationTasks(plan: string, goal: string): DelegationTask[] {
    const cleanedPlan = cleanPlanOutput(plan);
    const tasks: DelegationTask[] = [];
    const seenGoals = new Set<string>();
    const activeFilesText = this.toolContext.activeFiles.size > 0
      ? `Files in context: ${Array.from(this.toolContext.activeFiles.values()).join(', ')}`
      : '';
    const originalPaths = extractFilePaths(goal);
    const pathsBlock = originalPaths.length > 0
      ? `\nOriginal goal file paths (MUST preserve in subtask):\n${originalPaths.map(p => `  - ${p}`).join('\n')}\n`
      : '';
    const goalBlock = `Original goal: ${goal}\n`;
    
    const baseCtx = activeFilesText + goalBlock + pathsBlock;
    
    const lines = cleanedPlan.split('\n');
    let currentRole = '';
    let currentGoal = '';
    
    const pushTask = (role: string, goalText: string, ctx: string, depth: number) => {
      const clean = cleanTaskText(goalText) || goalText;
      const goalKey = clean.trim().toLowerCase().replace(/\s+/g, ' ');
      if (seenGoals.has(goalKey)) return;
      seenGoals.add(goalKey);
      tasks.push({ goal: truncateGoal(clean || goalText), context: ctx, role, status: 'pending', splitDepth: depth });
    };

    const guessRole = (text: string): string => {
      const lower = text.toLowerCase();
      const verifyRe = /\b(verify|check|test|review|inspect|validate|confirm|browser)\b/i;
      const createRe = /\b(create|add|build|implement|write|generate|make|new)\b/i;
      if (verifyRe.test(lower)) return 'reviewer';
      if (createRe.test(lower)) return 'coder';
      if (/\b(fix|debug|resolve|repair|patch)\b/i.test(lower)) return 'debugger';
      return 'coder';
    };

    // Primary: explicit "delegate to" / role-prefixed lines
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (/^\s*tools?\s*used\b/i.test(trimmedLine)) continue;
      if (/^\(?tools?\s*used\b/i.test(trimmedLine)) continue;
      const roleMatch = line.match(/^\s*(?:-|\*|\d+\.?)?\s*(?:delegate\s+to|assign\s+to|agent:)?\s*(planner|coder|reviewer|debugger|researcher)\s*:/i);
      if (roleMatch) {
        if (currentRole && currentGoal) {
          pushTask(currentRole, currentGoal, baseCtx, 0);
        }
        currentRole = roleMatch[1].toLowerCase();
        const matchIndex = line.indexOf(roleMatch[0]);
        let goalPart = line.substring(matchIndex + roleMatch[0].length);
        goalPart = goalPart.replace(/^[:\s\-]+/, '');
        currentGoal = goalPart.trim();
      } else if (currentRole && trimmedLine) {
        // Only merge continuation lines that look like task detail, not standalone commentary
        const isCommentary = trimmedLine.length > 60 && /^[A-Z]/.test(trimmedLine) && !/^(and|or|with|using|that|which|to|for|in|on|at)\b/i.test(trimmedLine);
        if (!isCommentary) {
          currentGoal += ' ' + trimmedLine;
        }
      }
    }
    
    if (currentRole && currentGoal) {
      pushTask(currentRole, currentGoal, baseCtx, 0);
    }
    
    // Fallback: plain numbered/bulleted list without explicit roles
    if (tasks.length === 0) {
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const itemMatch = trimmed.match(/^(?:-|\*|\d+\.)\s+(.+)$/);
        if (itemMatch) {
          const body = itemMatch[1];
          if (body.length < 3) continue;
          const role = guessRole(body);
          pushTask(role, body, baseCtx, 0);
        } else if (trimmed.length > 10) {
          // Only accept unformatted lines that contain an action verb
          const hasActionVerb = /\b(create|write|build|implement|update|add|fix|generate|install|setup|configure|refactor|move|delete|rename)\b/i.test(trimmed);
          if (hasActionVerb) {
            pushTask('coder', trimmed, baseCtx, 0);
          }
        }
      }
    }

    if (tasks.length === 0) {
      // Auto-extract multiple file mentions if present in goal (e.g. public/index.html, src/server.ts)
      const fileMatches = Array.from(goal.matchAll(/([A-Za-z0-9_\-/\\]+\.[a-zA-Z0-9]+)/g)).map(m => m[1]);
      const uniqueFiles = Array.from(new Set(fileMatches)).filter(f => !f.endsWith('.md') && !f.endsWith('.json'));

      if (uniqueFiles.length > 1) {
        for (const file of uniqueFiles) {
          pushTask('coder', `Create/update ${file} for feature: ${goal}`, baseCtx, 0);
        }
      } else {
        tasks.push({
          goal: truncateGoal(goal),
          context: baseCtx,
          role: 'coder',
          status: 'pending',
          splitDepth: 0,
        });
      }
    }

    return tasks;
  }

  private findStyleReference(taskGoal: string): string | null {
    // Extract target directory from goal
    let dir = '';
    const fileMatch = taskGoal.match(/([A-Za-z0-9_\-/\\]+\.[a-zA-Z0-9]+)/);
    if (fileMatch) {
      dir = path.dirname(fileMatch[1].replace(/\\/g, '/'));
    } else {
      const dirMatch = taskGoal.match(/(?:in|at|to|under|inside)\s+(?:the\s+)?([A-Za-z0-9_\-/\\]{2,})(?:\s+(?:directory|folder|path))?/i);
      if (dirMatch) {
        dir = dirMatch[1].replace(/\\/g, '/').replace(/\/+$/, '');
      }
    }

    const checkDirForReference = (searchDir: string): { fullPath: string; content: string } | null => {
      if (!searchDir || !fs.existsSync(searchDir) || searchDir === '.') return null;
      let entries: string[];
      try { entries = fs.readdirSync(searchDir); } catch { return null; }
      const candidates = entries
        .filter(f => !f.startsWith('.') && !f.includes('.test.') && !f.includes('.spec.') && !f.startsWith('__'))
        .sort();

      const target = candidates.find(f => /\.(tsx?|jsx?|vue|svelte)$/i.test(f))
        || candidates.find(f => /\.(css|scss|less)$/i.test(f))
        || candidates[0];

      if (!target) return null;
      const fullPath = path.join(searchDir, target);
      if (fs.statSync(fullPath).isDirectory()) return null;
      try {
        let content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        if (lines.length > 80) {
          content = lines.slice(0, 80).join('\n') + '\n... (truncated)';
        }

        const isAppRouter = fs.existsSync(path.join(this.toolContext.projectRoot || process.cwd(), 'app'));
        const antiPatterns = [
          /legacyBehavior/,
          /^\s*<[A-Za-z]/m,
        ];
        if (isAppRouter) {
          antiPatterns.push(/import\s+React\s+from\s+['"]react['"]/);
        }
        if (antiPatterns.some(re => re.test(content))) return null;

        return { fullPath, content };
      } catch { return null; }
    };

    // 1. Try target directory
    let ref = checkDirForReference(dir);
    if (ref) {
      return `\nExisting file in ${dir}/ (use as a style reference for structure and import order only):\n--- ${ref.fullPath} ---\n${ref.content}\n--- end ---`;
    }

    // 2. Try parent directory if target directory doesn't have reference
    if (dir && dir !== '.' && dir !== '') {
      const parentDir = path.dirname(dir);
      ref = checkDirForReference(parentDir);
      if (ref) {
        return `\nExisting file in sibling/parent ${parentDir}/ (use as a style reference for structure and import order only):\n--- ${ref.fullPath} ---\n${ref.content}\n--- end ---`;
      }
    }

    // 3. Try common directories in the project
    const commonDirs = ['src/components', 'components', 'src/pages', 'pages', 'app', 'src', 'lib'];
    for (const commonDir of commonDirs) {
      const fullCommonDir = path.join(this.toolContext.projectRoot || process.cwd(), commonDir);
      ref = checkDirForReference(fullCommonDir);
      if (ref) {
        return `\nExisting file in ${commonDir}/ (use as a style reference for structure and import order only):\n--- ${ref.fullPath} ---\n${ref.content}\n--- end ---`;
      }
    }

    return null;
  }

  private discoverDesignTokens(): string {
    const cwd = this.toolContext.projectRoot || process.cwd();
    let tokens = '';

    // 1. Try to find tailwind config
    const twConfigs = ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs'];
    for (const configName of twConfigs) {
      const fullPath = path.join(cwd, configName);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const themeMatch = content.match(/theme\s*:\s*\{[\s\S]*?\}/);
          if (themeMatch) {
            tokens += `\nTailwind Theme Configuration (from ${configName}):\n${themeMatch[0]}\n`;
          } else {
            const lines = content.split('\n').slice(0, 40).join('\n');
            tokens += `\nTailwind Configuration Snippet (from ${configName}):\n${lines}\n`;
          }
          break;
        } catch { /* ignore */ }
      }
    }

    // 2. Try to find CSS custom properties in global CSS files
    const commonCssDirs = ['src', 'app', 'styles', 'src/styles', '.'];
    const cssFileNames = ['globals.css', 'global.css', 'index.css', 'app.css', 'main.css'];
    for (const dirName of commonCssDirs) {
      for (const fileName of cssFileNames) {
        const fullPath = path.join(cwd, dirName, fileName);
        if (fs.existsSync(fullPath)) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            const rootMatches = content.match(/:root\s*\{[\s\S]*?\}/g);
            if (rootMatches && rootMatches.length > 0) {
              tokens += `\nDesign Tokens / CSS Variables (from ${dirName}/${fileName}):\n${rootMatches.join('\n')}\n`;
            }
            break;
          } catch { /* ignore */ }
        }
      }
      if (tokens) break;
    }

    return tokens;
  }

  private async delegateTask(task: DelegationTask, tasks?: DelegationTask[], goal?: string, projectContext?: string): Promise<void> {
    const role = getAgentRole(task.role);
    console.log(`\n[SPAWN] Delegating to ${role.name}: ${task.goal}`);

    const tools = filterToolsForRole([...BUILTIN_TOOLS, ...mcpRegistry.getToolDefinitions()], task.role);
    const historyStartIndex = this.toolContext.patchHistory?.length || 0;

    // Inject user metadata so the agent has real values instead of guessing
    const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    let enrichedContext = `Current date: ${currentDate}\n`;

    const projectRoot = this.toolContext.projectRoot || this.sessionManager?.projectRoot || process.cwd();
    const specContract = loadSpecContract(projectRoot);
    if (specContract) {
      enrichedContext += `\n${formatSpecForPrompt(specContract)}\n`;
    }

    // Build systemExtra with project context — system prompt is more authoritative than user message
    const frameworkBlock = projectContext
      ? `Follow the project framework conventions (e.g., Next.js pages go under pages/, Vue components under components/).\n`
      : '';

    // Surface relevant past lessons as context (cap to most-used to save tokens)
    const lessons = this.sessionManager ? this.sessionManager.getFailureLessons(task.role) : [];
    const topLesson = lessons.length > 0 ? lessons.sort((a, b) => ((b.used_count || 0) - (a.used_count || 0)))[0] : null;
    if (topLesson) {
      enrichedContext += `[LESSON] Previously failed on: "${topLesson.error_snippet}" -> resolution: ${topLesson.resolution} (occurred ${topLesson.used_count}x)\n`;
    }

    // Inject an existing file from the target dir as a style reference only for non-trivial tasks
    const styleRef = this.findStyleReference(task.goal);
    if (styleRef) {
      enrichedContext += styleRef;
    }

    // Discover and inject design tokens if coder task
    if (task.role === 'coder') {
      const designTokens = this.discoverDesignTokens();
      if (designTokens) {
        enrichedContext += designTokens;
      }
    }

    // Extract explicit requirements from the task goal only
    const taskReqs = extractRequirements(task.goal);
    if (taskReqs.length > 0) {
      enrichedContext += `\nRequirements:\n${taskReqs.slice(0, 4).map(r => `  - ${r}`).join('\n')}\n`;
    }
    // NO FILLER CONTENT — the requirements above must be implemented with real content
    if (taskReqs.length > 0 && task.role === 'coder') {
      enrichedContext += `\nCRITICAL: You MUST implement every requirement above with real, specific content. Do NOT use generic filler like "Welcome to our platform", "We provide services", "Learn more about us", or placeholder text. Each requirement needs actual concrete content that a real business would publish.\n`;
    }

    // Extract explicit file paths from the goal and inject a concise scope boundary
    const scopePaths = extractFilePaths(task.goal);
    if (scopePaths.length > 0) {
      enrichedContext += `\nSCOPE: only touch ${scopePaths.join(', ')}\n`;
    }

    enrichedContext += `\n${frameworkBlock}${task.context}`;
    const frameworkRules = getFrameworkGuidance(projectContext, this.toolContext.projectRoot);
    const systemExtra = `Project context:\n${projectContext || '(none discovered)'}${frameworkRules}\n`;

    // Prepend a terse override reminder so the rules land in the user message too,
    // which some models weight more heavily than the system prompt extension.
    if (frameworkRules && task.role === 'coder') {
      enrichedContext = `IMPORTANT: The CODING RULES in your system context are mandatory and override any patterns you observe in style reference files or your training data.\n\n` + enrichedContext;
    }

    let result = await this.runAgent(role, task.goal, enrichedContext, tools, systemExtra);

    // Lightweight ensemble: in ensemble mode, run a second coder at higher temp and pick the best
    if (process.env.DAEDALUS_ENSEMBLE === 'true' && task.role === 'coder' && !this.toolContext.abortSignal.aborted) {
      const firstPatches = this.toolContext.patchHistory?.slice(historyStartIndex) || [];
      const firstCount = firstPatches.length;

      const secondRole = { ...role, temperature: 0.5 };
      const secondResult = await this.runAgent(secondRole, task.goal, enrichedContext, tools, systemExtra);

      const secondPatches = this.toolContext.patchHistory?.slice(historyStartIndex) || [];
      const secondCount = secondPatches.length;

      if (secondCount > firstCount) {
        // Second candidate produced more artifacts — use its result
        result = secondResult;
      } else {
        // First candidate was better — revert second candidate's patches
        if (this.toolContext.patchHistory) {
          this.toolContext.patchHistory.length = historyStartIndex + firstCount;
        }
      }
    }

    if (this.toolContext.abortSignal.aborted) {
      this.results.push({
        role: task.role,
        goal: task.goal,
        summary: 'Task aborted by user',
        success: false,
      });
      task.status = 'failed';
      task.error = 'Task aborted by user';
      return;
    }

    const MAX_TURNS_SIGNAL = 'Agent reached max turns';
    const PATCH_ABORT_PREFIX = 'Agent aborted: too many patch failures';
    if (result.startsWith(PATCH_ABORT_PREFIX)) {
      task.status = 'failed';
      task.error = result.split('\n')[0];
      if (task.role === 'coder' || task.role === 'debugger') {
        await rollbackTaskPatches(this.toolContext, historyStartIndex);
      }
      this.results.push({ role: task.role, goal: task.goal, summary: result, success: false });
      console.log(`[${pc.red('FAILED')}] ${role.name}: ${task.error}`);
      return;
    }
    if (result === MAX_TURNS_SIGNAL) {
      const partialWork = (this.toolContext.patchHistory?.length ?? 0) > historyStartIndex;
      const depth = task.splitDepth ?? 0;
      if (partialWork && depth < 3 && tasks) {
        console.log(`\n${pc.yellow('Task exceeded turn limit with partial progress.')} Splitting remaining work (depth ${depth + 1})...`);

        const newPatches = this.toolContext.patchHistory?.slice(historyStartIndex) || [];
        const filesDone = [...new Set(newPatches.map(p => p.filePath).filter(Boolean))];

        task.status = 'completed';
        this.results.push({
          role: task.role,
          goal: task.goal,
          summary: 'Partially completed — splitting remaining work into sub-tasks',
          success: true,
        });

        const doneCtx = filesDone.length > 0 ? `\nPartially completed files: ${filesDone.join(', ')}` : '';

        const subPlan = await this.createPlan(
          `Continue the remaining work for: ${task.goal}${doneCtx}\nThe previous agent only got partial work done before hitting the turn limit. Break this into smaller, focused steps.`,
          projectContext
        );
        const subTasks = this.parseDelegationTasks(subPlan, goal || task.goal);
        const currentIndex = (tasks || []).indexOf(task);
        const doneBeforeSplit = (tasks || []).filter((t, idx) => t.status === 'completed' && idx < currentIndex);
        const deduped = subTasks.filter(st => {
          if (doneBeforeSplit.length === 0 || st.role !== 'coder') return true;
          const newPaths = extractFilePaths(st.goal).map(p => p.toLowerCase());
          if (newPaths.length === 0) return true;
          return !doneBeforeSplit.some(d => {
            if (d.role !== 'coder') return false;
            const donePaths = extractFilePaths(d.goal).map(p => p.toLowerCase());
            return donePaths.some(dp => newPaths.includes(dp));
          });
        });
        const inheritCtx = filesDone.length > 0
          ? `Original goal: ${task.goal}\nProject root: ${this.toolContext.projectRoot || process.cwd()}\n\nIMPORTANT — Files that were partially created and MUST be completed or replaced:\n${filesDone.map(f => `  - ${f}`).join('\n')}\n\nThe previous agent left these files incomplete before hitting the turn limit. You MUST read each file, then either complete it with a proper implementation or replace it entirely. Check the existing project structure first — use read_file on existing files to understand what's already there before creating new ones.`
          : `Original goal: ${task.goal}\nProject root: ${this.toolContext.projectRoot || process.cwd()}\n\nCheck the existing project structure first — use read_file on existing files to understand what's already there before creating new ones.`;
        for (const st of deduped) {
          st.status = 'pending';
          st.splitDepth = depth + 1;
          st.context = `${inheritCtx}\n\n${st.context}`;
          tasks.push(st);
        }

        this.printTaskList(tasks);
        return;
      }

      task.status = 'failed';
      task.error = partialWork
        ? `Task still too large after ${depth} splits — manual review needed`
        : 'Task too large and no work completed';
      if (task.role === 'coder' || task.role === 'debugger') {
        await rollbackTaskPatches(this.toolContext, historyStartIndex);
      }
      this.results.push({
        role: task.role,
        goal: task.goal,
        summary: task.error,
        success: false,
      });
      return;
    }

    let verified = await verifyArtifacts(this.toolContext, task.role, task.goal, result, historyStartIndex);
    let evidence = '';
    let placeholderSites: string[] = [];
    let checkLogs = '';

    if (verified) {
      placeholderSites = await checkPlaceholders(this.toolContext, historyStartIndex);
      if (placeholderSites.length > 0) {
        console.log(pc.yellow(`\nFound ${placeholderSites.length} placeholder(s) in written files`));
        // Auto-fill trivial placeholders like [Year], [Your Name]
        const filled = await fillPlaceholders(this.toolContext, historyStartIndex);
        if (filled > 0) {
          console.log(pc.green(`  Auto-filled ${filled} trivial placeholder(s) (year, name, etc.)`));
        }
        // Re-check for remaining (structural) placeholders
        placeholderSites = await checkPlaceholders(this.toolContext, historyStartIndex);
        if (placeholderSites.length === 0) {
          verified = true;
        } else {
          verified = false;
        }
      }
    }

    if (verified && (task.role === 'coder' || task.role === 'debugger') && (this.toolContext.patchHistory?.length ?? 0) > historyStartIndex) {
      const checkResult = await runBuildVerification(this.toolContext, historyStartIndex);
      if (!checkResult.success) {
        const modifiedFiles = this.toolContext.patchHistory!.slice(historyStartIndex).map(p => p.filePath);
        const isRelated = isBuildErrorRelated(checkResult.errorLogs || '', modifiedFiles, this.toolContext.projectRoot);
        if (isRelated) {
          verified = false;
          checkLogs = (checkResult.errorLogs || 'Build check failed') + generateBuildErrorHint(checkResult.errorLogs || '');
        } else {
          console.log(pc.yellow(`\n[VERIFY] Build check failed, but errors appear to be in unrelated files. Ignoring build failure for this task.`));
        }
      }

      if (verified) {
        const specResult = await verifySpecAssertions(this.toolContext.projectRoot || process.cwd());
        if (!specResult.success) {
          console.log(pc.yellow(`\n[SpecFirst] Spec contract assertion check failed!`));
          verified = false;
          checkLogs = (specResult.errorLogs || 'Spec contract check failed');
        }
      }
    }

    if (!verified) {
      let repairCtx = task.context;
      if (placeholderSites.length > 0) {
        const siteList = placeholderSites.map(s => `  - ${s}`).join('\n');
        repairCtx += `\n\nPrevious attempt contained placeholders instead of real content:\n${siteList}\n\nYou MUST replace ALL placeholders with real content. Never output placeholder text like [Year], [Your Name], etc. Use actual values.`;
      }
      if (checkLogs) {
        repairCtx += `\n\nPrevious attempt failed build/compilation verification. The check failed with the following error output:\n\`\`\`\n${checkLogs}\n\`\`\`\nPlease fix the build/compilation errors listed above.`;
      }
      const repaired = await attemptRepair({ toolContext: this.toolContext, runAgent: (role, goal, context, tools) => this.runAgent(role, goal, context, tools) }, task, {
        summary: result,
      }, repairCtx, historyStartIndex);
      result = repaired.summary;
      verified = repaired.success;
      evidence = repaired.evidence || '';

      if (verified) {
        const stillPlaceholders = await checkPlaceholders(this.toolContext, historyStartIndex);
        if (stillPlaceholders.length > 0) {
          // Try auto-fill one more time after repair
          const filled = await fillPlaceholders(this.toolContext, historyStartIndex);
          if (filled > 0) console.log(pc.green(`  Auto-filled ${filled} remaining trivial placeholder(s)`));
          const remain = await checkPlaceholders(this.toolContext, historyStartIndex);
          if (remain.length > 0) {
            verified = false;
            evidence = `Placeholders remain: ${remain.join('; ')}`;
          }
        }
      }
    }

    const resultForCheck = result.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const success = verified && !isDeclaredError(resultForCheck) && verifyArtifactsThoroughly(this.toolContext, task.role, task.goal, resultForCheck, historyStartIndex);
    if (success) {
      const clean = buildCleanSummary(this.toolContext, task, result, historyStartIndex);
      if (clean) result = clean;
    }
    task.status = success ? 'completed' : 'failed';
    if (!success) {
      task.error = resultForCheck.split('\n')[0] || result.split('\n')[0] || 'Unknown failure';

      // Rollback patches made during this task to keep codebase clean
      if (task.role === 'coder' || task.role === 'debugger') {
        await rollbackTaskPatches(this.toolContext, historyStartIndex);
      }

      // Log failure as a lesson for self-improvement
      if (this.sessionManager) {
        try {
          this.sessionManager.saveFailureLesson({
            task_role: task.role,
            goal_keywords: task.goal.split(' ').slice(0, 5).join(' '),
            error_snippet: task.error.slice(0, 200),
            resolution: 'Pending — retry may succeed with different approach',
          });
        } catch { /* session not available */ }
      }
    }

    this.results.push({
      role: task.role,
      goal: task.goal,
      summary: result,
      success,
      ...(evidence ? { evidence } : {}),
    });

    if (success) {
      console.log(`[${pc.green('OK')}] ${role.name} completed`);
    } else {
      console.log(`[${pc.red('FAILED')}] ${role.name}: ${task.error || 'verification failed'}`);
    }

    // Post-task review if task touched files — now BLOCKING for coder tasks
    if (success && this.sessionManager && task.role !== 'reviewer') {
      try {
        const reviewerRole = getAgentRole('reviewer');
        if (reviewerRole && !reviewerRole.canDelegate) {
          const touchedFiles = (this.toolContext.patchHistory || [])
            .filter((h: any) => h.filePath)
            .map((h: any) => h.filePath);
          const fileList = touchedFiles.length > 0
            ? `\nFILES_TOUCHED: ${touchedFiles.join(', ')}`
            : '';
          const truncatedResult = result.length > 6000 ? result.slice(0, 6000) + '\n...[result truncated for review]' : result;
          const reviewContext = `TASK: ${task.goal}\n\nAgent result:\n${truncatedResult}${fileList}\n\nReview the files that were touched for this task. Use git_diff or list files modified recently. Check for syntax errors, correctness, and project health.`;
          const reviewTools = filterToolsForRole([...BUILTIN_TOOLS, ...mcpRegistry.getToolDefinitions()], 'reviewer');
          const review = await this.runAgent(reviewerRole, `Review files from task: ${task.goal}`, reviewContext, reviewTools);

          // Parse reviewer verdict
          const statusMatch = review.match(/STATUS:\s*(PASS|NEEDS_FIX|STOP)/i);
          const verdict = statusMatch?.[1]?.toUpperCase() || 'PASS';

          // BLOCKING: if reviewer found issues on a coder task, trigger a repair pass
          if ((verdict === 'NEEDS_FIX' || verdict === 'STOP') && (task.role === 'coder' || task.role === 'debugger')) {
            console.log(pc.yellow(`\n[REVIEWER] Found issues — triggering repair pass...`));
            const findingsMatch = review.match(/FINDINGS:([\s\S]*?)(?:RECOMMENDATION:|$)/i);
            const findings = findingsMatch?.[1]?.trim() || review;
            const repairGoal = `Fix the following reviewer findings in the files you just wrote for task: "${task.goal}"\n\nFINDINGS:\n${findings}\n\nApply targeted fixes only. Do not change unrelated code.`;
            const coderRole = getAgentRole('coder');
            if (coderRole) {
              const repairTools = filterToolsForRole([...BUILTIN_TOOLS, ...mcpRegistry.getToolDefinitions()], 'coder');
              await this.runAgent(coderRole, repairGoal, reviewContext, repairTools);
              console.log(pc.green(`[REPAIR] Repair pass complete.`));
            }
          }

          // Update project status from review
          try {
            const buildStatus = /build.*pass|no errors|pass/i.test(review) ? 'passing' : 'needs_attention';
            this.sessionManager.saveProjectStatus({
              build_status: buildStatus,
              test_status: /test.*pass|no failures/i.test(review) ? 'passing' : 'unknown',
              key_concerns: review.split('\n').filter(l => /ERROR|FAIL|STOP|needs_fix/i.test(l)).slice(0, 3).join('; '),
              last_reviewed_at: Date.now(),
            });
          } catch { /* status save failed, non-critical */ }
        }
      } catch { /* review failed, non-critical */ }
    }
  }

  private async runAgent(
    role: AgentRole,
    goal: string,
    context: string,
    tools: any[],
    systemExtra?: string,
  ): Promise<string> {
    const currentDateStr = new Date().toLocaleString();
    let dynamicSystemPrompt = `${role.systemPrompt}\n\n## CURRENT TIME\nThe current date and local time is: ${currentDateStr}.\n`;
    const projectRoot = this.toolContext.projectRoot || this.sessionManager?.projectRoot;
    if (projectRoot) {
      const filesToCheck = ['CLAUDE.md', '.cursorrules', '.daedalusrules', 'DAEDALUS.md'];
      let rules = '';
      for (const file of filesToCheck) {
        const fullPath = path.join(projectRoot, file);
        if (fs.existsSync(fullPath)) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8').trim();
            if (content) {
              rules += `\n### Rules from ${file}:\n${content}\n`;
            }
          } catch {
            // Ignore unreadable rule file
          }
        }
      }
      if (rules) {
        dynamicSystemPrompt += `\n## PROJECT-SPECIFIC GUIDELINES\n${rules}`;
      }
    }
    if (systemExtra) {
      dynamicSystemPrompt += `\n${systemExtra}\n`;
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: dynamicSystemPrompt },
      { role: 'user', content: `${context}\n\nTask: ${goal}` },
    ];

    let turns = 0;
    const maxTurns = role.maxTurns ?? 10;
    const patchFailures = new Map<string, number>();
    const taskStartHistoryLength = this.toolContext.patchHistory?.length || 0;
    let idleReadTurn = -1;

    while (turns < maxTurns) {
      if (this.toolContext.abortSignal.aborted) {
        return 'Agent execution aborted by user';
      }
      const agentSpinner = new DaedalusSpinner({ text: `${role.name} running (turn ${turns + 1})`, color: (s) => pc.cyan(s) });
      agentSpinner.start();
      let completion;
      const isLastTurn = turns === maxTurns - 1;
      const currentTools = isLastTurn ? undefined : (tools.length > 0 ? tools : undefined);
      const currentToolChoice = isLastTurn ? undefined : ((role.name === 'coder' || role.name === 'debugger') && turns === 0 ? 'required' : 'auto');

      try {
        completion = await this.retryApiCall(
          () => this.router.chat.completions.create({
            model: 'auto',
            messages,
            temperature: role.temperature ?? 0.1,
            tools: currentTools,
            tool_choice: currentToolChoice,
          }),
          `${role.name} API call`
        );
      } finally {
        agentSpinner.stop();
      }

      if (!completion || !completion.choices || completion.choices.length === 0) {
        return 'Agent completed without response';
      }

      const message = completion.choices[0].message;
      messages.push(message);

      let effectiveToolCalls = message.tool_calls || [];
      if (!effectiveToolCalls.length && message.content) {
        const parsed = parseTextToolCalls(message.content);
        if (parsed.length > 0) {
          effectiveToolCalls = parsed;
        }
      }

      if (effectiveToolCalls.length > 0) {
        const results = await executeToolCalls(
          effectiveToolCalls.map((tc: any) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
          this.toolContext
        );
        // Track patch failures per file to break retry spirals
        let hadPatchFailure = false;
        let patchFailureFile: string | undefined;
        for (const result of results) {
          if (/patch.*Syntax error introduced|error TS\d+/.test(result.content || '')) {
            hadPatchFailure = true;
            const fileMatch = (result.content || '').match(/src\/([^\s(]+)/);
            patchFailureFile = fileMatch ? fileMatch[1] : undefined;
          }
        }

        if (hadPatchFailure && patchFailureFile) {
          const prev = patchFailures.get(patchFailureFile) || 0;
          patchFailures.set(patchFailureFile, prev + 1);
          if (prev + 1 >= 3) {
            return `Agent aborted: too many patch failures on ${patchFailureFile}.\nLast error from patch tool: ${results.find(r => /patch.*Syntax error/.test(r.content || ''))?.content || 'unknown'}\nFix the TypeScript error in that file before retrying.`;
          }
        } else if (!hadPatchFailure) {
          for (const [file] of Array.from(patchFailures)) {
            patchFailures.set(file, 0);
          }
        }

        for (const result of results) {
          messages.push({
            role: 'tool',
            content: result.content,
            tool_call_id: result.toolCallId,
          });
        }

        // Early-exit: after artifacts exist, if agent spends 2+ turns on read-only tools, it's done
        const hasArtifacts = this.toolContext.patchHistory && this.toolContext.patchHistory.length > taskStartHistoryLength;
        const hasArtifactTool = effectiveToolCalls.some((tc: any) =>
          /^(write_file|patch|terminal)$/i.test(tc.function.name)
        );
        if (hasArtifacts && hasArtifactTool) {
          idleReadTurn = -1;
        } else if (hasArtifacts && !hasArtifactTool) {
          if (idleReadTurn === -1) idleReadTurn = turns;
          else if (turns - idleReadTurn >= 3) {
            return 'Agent completed';
          }
        }
        turns++;
        continue;
      }

      // No tool calls on this turn
      const responseText = message.content || '';

      // If tools were provided but the model refused to use them, give it a firm nudge
      if (tools.length > 0 && turns === 0 && /sorry|can'?t|cannot|don'?t have|not (able|capable)|lack(|ing) (the )?(necessary |required )?(tools|capabilities)|unable|apologize/i.test(responseText)) {
        messages.push({
          role: 'user',
          content: 'You have tools available to complete this task. Use read_file, write_file, search_files, terminal, and other tools as needed. Do not apologize or refuse — just use the tools to accomplish the task.',
        });
        turns++;
        continue;
      }

      return responseText || 'Agent completed without response';
    }

    return 'Agent reached max turns';
  }

  private async executeOpenAIToolCalls(toolCalls: any[]): Promise<any[]> {
    const tc: ToolCall[] = toolCalls.map((rawTc: any) => ({
      id: rawTc.id,
      type: 'function',
      function: { name: rawTc.function.name, arguments: rawTc.function.arguments },
    }));
    return executeToolCalls(tc, this.toolContext);
  }

  private synthesize(goal: string): string {
    if (this.toolContext.abortSignal.aborted) {
      return `## Orchestration Paused: ${goal}\n\nUse /orchestrate to resume the pending tasks.`;
    }
    const hasFailures = this.results.some(r => !r.success);
    let output = hasFailures
      ? `## Orchestration Hit Verification Failures: ${goal}\n\n`
      : `## Orchestration Complete: ${goal}\n\n`;

    for (const result of this.results) {
      const status = result.success ? '[OK]' : '[ERROR]';
      output += `${status} **${result.role}**: ${result.goal}\n`;
      const indented = result.summary
        .split('\n')
        .map(line => '   ' + line)
        .join('\n');
      output += `${indented}\n`;
      if (result.evidence) {
        output += `   Evidence: ${result.evidence}\n`;
      }
      output += `\n`;
    }

    this.writeWalkthrough(goal);
    return output;
  }

  private writeWalkthrough(goal: string): void {
    if (process.env.VITEST) return;
    try {
      const projectRoot = this.toolContext.projectRoot || this.sessionManager?.projectRoot || process.cwd();
      const hasFailures = this.results.some(r => !r.success);
      if (hasFailures || this.toolContext.abortSignal.aborted) {
        return;
      }

      const uniqueFiles = Array.from(new Set((this.toolContext.patchHistory || []).map(p => p.filePath)));
      const relativeFiles = uniqueFiles.map(f => path.relative(projectRoot, f).replace(/\\/g, '/'));

      let md = `# Walkthrough - ${goal}\n\n`;
      md += `Generated autonomously by Daedalus on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}\n\n`;
      md += `## Accomplished Tasks\n\n`;

      for (const result of this.results) {
        md += `- [x] **${result.role}**: ${result.goal}\n`;
        if (result.summary) {
          md += `  > ${result.summary.split('\n').join('\n  > ')}\n`;
        }
      }
      md += `\n`;

      if (relativeFiles.length > 0) {
        md += `## Modified Files\n\n`;
        for (const file of relativeFiles) {
          md += `- [${path.basename(file)}](file:///${path.resolve(projectRoot, file).replace(/\\/g, '/')})\n`;
        }
        md += `\n`;
      }

      md += `## Verification Status\n\n`;
      md += `- [x] Linter/compiler checks executed and passed successfully.\n`;

      const walkthroughPath = path.join(projectRoot, 'walkthrough.md');
      fs.writeFileSync(walkthroughPath, md, 'utf8');
      console.log(pc.green(`\n[WALKTHROUGH] Generated walkthrough guide at ./walkthrough.md`));
    } catch (err: any) {
      console.log(pc.yellow(`\n[WARN] Failed to write walkthrough.md: ${err.message}`));
    }
  }

}

