// Multi-agent orchestrator - coordinates delegation and synthesis

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { LocalRouter } from '../router/index.js';
import { BUILTIN_TOOLS } from '../tools/definitions.js';
import { executeToolCalls } from '../tools/executor.js';
import { getAgentRole, filterToolsForRole, AgentRole } from './roles.js';
import { ToolContext, ToolCall, ChatMessage } from '../types.js';
import pc from 'picocolors';
import { DaedalusSpinner } from '../tools/daedalus-spinner.js';
import { SessionManager } from '../session/manager.js';
import { parseTextToolCalls } from '../formatting.js';

interface DelegationTask {
  goal: string;
  context: string;
  role: string;
  toolsets?: string[];
  dependencies?: string[];  // file paths this task depends on (auto-detected)
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  error?: string;
  splitDepth?: number;
}

interface AgentResult {
  role: string;
  goal: string;
  summary: string;
  success: boolean;
  evidence?: string;
}

// Simplified placeholder regexes for common auto-fill tokens only
const PLACEHOLDER_RE = /\[(?:YEAR|Year|year|YYYY|yyyy|DATE|Date|date|TODAY|Today|today|YOUR\s+NAME|Your\s+Name|your\s+name|FULLNAME|Fullname|fullname|AUTHOR|Author|author|USERNAME|Username|username|OWNER|Owner|owner)\]/i;
// Simplified HTML placeholder regex for same tokens inside comments
const HTML_PLACEHOLDER_RE = /<!--[^>]*?(?:YEAR|Year|year|DATE|Date|date|YOUR\s+NAME|Your\s+Name|your\s+name)\s*-->/i;

export class Orchestrator {
  private router: LocalRouter;
  private messages: ChatMessage[];
  private toolContext: ToolContext;
  private sessionManager?: SessionManager;
  private results: AgentResult[] = [];
  private readonly MAX_INITIAL_TASKS = 4;
  private readonly MAX_TOTAL_TASKS = 10;
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
    const cwd = process.cwd();
    const parts: string[] = [];

    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
      const info: string[] = [];
      if (pkg.dependencies) {
        if (pkg.dependencies.next) info.push('Next.js (React, SSR)');
        else if (pkg.dependencies.react) info.push('React');
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

      let plan = await this.createPlan(goal, projectContext);
      if (this.toolContext.abortSignal.aborted) {
        return 'Orchestration stopped by user';
      }

      let tasks = this.parseDelegationTasks(plan, goal);

      // Cap initial tasks — re-plan if the planner gets carried away
      if (tasks.length > this.MAX_INITIAL_TASKS) {
        console.log(pc.yellow(`\nPlan has ${tasks.length} steps (max ${this.MAX_INITIAL_TASKS}). Asking planner to simplify...`));
        plan = await this.createPlan(
          `${goal}\n\nYour previous plan had ${tasks.length} steps which is too many. Create a simpler plan with at most ${this.MAX_INITIAL_TASKS} focused steps. Merge related steps together. Each step must produce real output.`,
          projectContext
        );
        tasks = Orchestrator.filterValidTasks(this.parseDelegationTasks(plan, goal));
      } else {
        tasks = Orchestrator.filterValidTasks(tasks);
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

  private async createPlan(goal: string, projectContext?: string): Promise<string> {
    const plannerRole = getAgentRole('planner');
    const tools = filterToolsForRole(BUILTIN_TOOLS, 'planner');

    const systemPrompt = plannerRole.systemPrompt;

    const REFUSAL_RE = /sorry|can'?t|cannot|don'?t have|not (able|capable)|lack(|ing) (the )?(necessary |required )?(tools|capabilities)|unable|apologize/i;

    let attempts = 0;
    const maxAttempts = 3;
    let lastValidationError = '';

    while (attempts < maxAttempts) {
      attempts++;
      const retryHint = lastValidationError ? `\n\nPREVIOUS PLAN REJECTED: ${lastValidationError}\nFix the issues and output a corrected plan.` : '';
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt + (attempts > 1 ? `\n\nIMPORTANT: You MUST create a valid plan. Each subtask needs an explicit file path and concrete wording.${retryHint}` : '') },
        { role: 'user', content: `Create a step-by-step plan with one subtask per file for: ${goal}\n\nProject context:\n${projectContext || '(none discovered)'}${Orchestrator.getFrameworkGuidance(projectContext)}\n\n${this.toolContext.activeFiles.size > 0 ? 'Files in context: ' + Array.from(this.toolContext.activeFiles.values()).join(', ') : ''}\n\nRemember: one subtask per file, include the exact file path in each subtask, order by dependencies.` },
      ];

      const planSpinner = new DaedalusSpinner({ text: `planner generating plan`, color: (s) => pc.cyan(s) });
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
        if (content && REFUSAL_RE.test(content)) {
          continue;
        }
        planText = content;
      } else {
        const content = assistantMessage.content || '';
        if (content && REFUSAL_RE.test(content)) {
          continue;
        }
        planText = content;
      }

      // Validate the plan
      const testTasks = this.parseDelegationTasks(planText || `- delegate to coder: ${goal}`, goal);
      const validationError = Orchestrator.validateTasks(testTasks, goal, this.toolContext.projectRoot);
      if (!validationError) {
        return planText || `- delegate to coder: ${goal}`;
      }
      lastValidationError = validationError;
      console.log(pc.yellow(`\nPlan didn't pass validation — re-planning (attempt ${attempts}/${maxAttempts})...`));
    }

    console.log(pc.yellow(`\nUsing fallback plan after ${maxAttempts} failed re-planning attempts`));
    return `- delegate to coder: ${goal}`;
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

  private printTaskList(tasks: DelegationTask[]): void {
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

  private static getTaskFilePaths(task: DelegationTask): string[] {
    return Orchestrator.extractFilePaths(task.goal);
  }

  private static hasFileConflict(a: DelegationTask, b: DelegationTask): boolean {
    const aPaths = Orchestrator.getTaskFilePaths(a);
    const bPaths = Orchestrator.getTaskFilePaths(b);
    // If either has no detected paths, assume conflict (conservative)
    if (aPaths.length === 0 || bPaths.length === 0) return true;
    return aPaths.some(ap => bPaths.includes(ap));
  }

  private static groupIndependent(tasks: DelegationTask[]): DelegationTask[][] {
    const groups: DelegationTask[][] = [];
    for (const t of tasks) {
      let placed = false;
      for (const group of groups) {
        const noConflict = group.every(g => !Orchestrator.hasFileConflict(g, t));
        if (noConflict) {
          group.push(t);
          placed = true;
          break;
        }
      }
      if (!placed) {
        groups.push([t]);
      }
    }
    return groups;
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
    Orchestrator.buildDependencyGraph(tasks);

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
      if (Orchestrator.isUnnecessaryConfigTask(task, projectContext)) {
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
        const groups = Orchestrator.groupIndependent(batch);
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
          Orchestrator.buildDependencyGraph(tasks);
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
      const paths = Orchestrator.extractFilePaths(r.summary);
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
      const newPaths = Orchestrator.extractFilePaths(nt.goal).map(p => p.toLowerCase());
      if (newPaths.length === 0) return true;
      const keep = !done.some(d => {
        if (d.role !== 'coder') return false;
        const donePaths = Orchestrator.extractFilePaths(d.goal).map(p => p.toLowerCase());
        return donePaths.some(dp => newPaths.includes(dp));
      });
      return keep;
    });

    // Enforce task cap and filter out non-actionable tasks
    newTasks = Orchestrator.filterValidTasks(newTasks).slice(0, this.MAX_INITIAL_TASKS);

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

  private static filterValidTasks(tasks: DelegationTask[]): DelegationTask[] {
    const doneRe = /\b(open|launch|start|run|execute)\b.*\b(file|editor|IDE|app|application|browser|window)\b|\b(commit|push|pull|merge)\b|\b(researcher)\b.*\b(identify and install)\b/i;
    const filtered = tasks.filter(t => !doneRe.test(t.goal));
    const metaRe = /\b(save changes|save the file|ensure that|ensure the)\b/i;
    const metaSaveRe = /(?:save|write)\s+the\s+(?:changes|file)/i;
    const guiTestRe = /\b(cypress|playwright|puppeteer|selenium)\b/i;
    const fileSimpleRe = /\b(create|write|build|make|generate|add)\b.*\b(file|component|page|layout|module|function|class|route)\b/i;
    const pathRe = /([a-z0-9_\-./\\:]+\\.[a-z0-9]+)/i;

    const seen = new Map<string, DelegationTask>();
    const out: DelegationTask[] = [];

    for (const t of filtered) {
      const rawGoal = t.goal;
      const cleanedGoal = Orchestrator.cleanTaskText(rawGoal) || rawGoal;

      if (doneRe.test(cleanedGoal)) continue;
      if (metaRe.test(cleanedGoal)) continue;
      if (metaSaveRe.test(cleanedGoal)) continue;
      if (guiTestRe.test(cleanedGoal)) continue;
      if (/\b(open|view|check)\b/i.test(cleanedGoal) && cleanedGoal.length < 25) continue;

      const lower = cleanedGoal.toLowerCase();
      if (t.role === 'coder') {
        const pathMatch = lower.match(pathRe);
        const key = pathMatch ? `${t.role}:${pathMatch[1]}` : `${t.role}:${lower}`;

        if (seen.has(key)) {
          const existing = seen.get(key)!;
          if (cleanedGoal.length > existing.goal.length) existing.goal = cleanedGoal;
          continue;
        }
        seen.set(key, t);

        const isSimpleFileTask = fileSimpleRe.test(lower);
        if (isSimpleFileTask) {
          const simpleFileCount = out.filter(o => {
            if (o.role !== 'coder') return false;
            const p = o.goal.toLowerCase().match(pathRe);
            return p && pathMatch && p[1] === pathMatch[1];
          }).length;
          if (simpleFileCount >= 2) continue;
        }
      }

      t.goal = cleanedGoal;
      out.push(t);
    }

    return out;
  }

  private static stripCodeBlocks(text: string): string {
    // Strip triple-backtick code fences (language identifier + code block)
    let result = text.replace(/```[\s\S]*?```/g, '').trim();
    // Unwrap inline backticks — keep the content (e.g. `src/pages/about.tsx` stays)
    result = result.replace(/`([^`]+)`/g, '$1').trim();
    return result;
  }

  private static stripToolRequestArtifacts(text: string): string {
    // Remove [TOOL_REQUEST]...[END_TOOL_REQUEST] blocks (including trailing JSON)
    let result = text.replace(/\[TOOL_REQUEST\][\s\S]*?\[END_TOOL_REQUEST\]/gi, '').trim();
    // Remove trailing whitespace / stray colons left behind
    result = result.replace(/[:\s]+$/g, '').trim();
    return result;
  }

  private static VAGUE_GOAL_RE = /\b(appropriate|proper|correct|suitable|generic|placeholder|add the necessary|add the required|install the necessary|install the required)\b/i;

  private static validateTasks(tasks: DelegationTask[], goal: string, projectRoot?: string): string | null {
    if (tasks.length === 0) return 'No tasks generated';
    const isSplit = goal.toLowerCase().includes('continue the remaining work');
    if (!isSplit && tasks.length === 1 && Orchestrator.extractFilePaths(goal).length > 1) {
      return `Expected multiple tasks (one per file) but got only 1 task for goal with multiple file paths: ${goal}`;
    }
    for (const t of tasks) {
      if (Orchestrator.VAGUE_GOAL_RE.test(t.goal)) {
        return `Task "${t.goal.slice(0, 80)}" contains vague wording — be concrete`;
      }
      const paths = Orchestrator.extractFilePaths(t.goal);
      if ((t.role === 'coder' || t.role === 'debugger') && paths.length === 0) {
        return `Task "${t.goal.slice(0, 80)}" has no file path — each task must target a specific file`;
      }
      if (projectRoot) {
        for (const p of paths) {
          const basename = path.basename(p);
          const normalizedP = p.replace(/\\/g, '/');
          if (normalizedP.startsWith('src/') || normalizedP.startsWith('lib/')) {
            const rootPath = path.join(projectRoot, basename);
            const srcPath = path.join(projectRoot, p);
            if (fs.existsSync(rootPath) && !fs.existsSync(srcPath)) {
              return `Task "${t.goal.slice(0, 80)}" targets "${p}" but the file actually exists at the root level ("${basename}"). Correct the path.`;
            }
          }
        }
      }
    }
    return null;
  }

  private static cleanTaskText(text: string): string {
    const withoutBlocks = Orchestrator.stripCodeBlocks(text);
    const withoutToolRequests = Orchestrator.stripToolRequestArtifacts(withoutBlocks);
    return withoutToolRequests || withoutBlocks || text;
  }

  private static cleanPlanOutput(text: string): string {
    // Clean the entire planner output before parsing to remove all tool request clutter
    return Orchestrator.stripToolRequestArtifacts(text);
  }

  private truncateGoal(text: string): string {
    if (text.length <= 200) return text;
    return text.slice(0, 197) + '...';
  }

  private parseDelegationTasks(plan: string, goal: string): DelegationTask[] {
    const cleanedPlan = Orchestrator.cleanPlanOutput(plan);
    const tasks: DelegationTask[] = [];
    const seenGoals = new Set<string>();
    const activeFilesText = this.toolContext.activeFiles.size > 0
      ? `Files in context: ${Array.from(this.toolContext.activeFiles.values()).join(', ')}`
      : '';
    const originalPaths = Orchestrator.extractFilePaths(goal);
    const pathsBlock = originalPaths.length > 0
      ? `\nOriginal goal file paths (MUST preserve in subtask):\n${originalPaths.map(p => `  - ${p}`).join('\n')}\n`
      : '';
    const goalBlock = `Original goal: ${goal}\n`;
    
    const baseCtx = activeFilesText + goalBlock + pathsBlock;
    
    const lines = cleanedPlan.split('\n');
    let currentRole = '';
    let currentGoal = '';
    
    const pushTask = (role: string, goalText: string, ctx: string, depth: number) => {
      const clean = Orchestrator.cleanTaskText(goalText) || goalText;
      const goalKey = clean.trim().toLowerCase().replace(/\s+/g, ' ');
      if (seenGoals.has(goalKey)) return;
      seenGoals.add(goalKey);
      tasks.push({ goal: this.truncateGoal(clean || goalText), context: ctx, role, status: 'pending', splitDepth: depth });
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
      if (/^\s*tools\s*used\b/i.test(line)) continue;
      const roleMatch = line.match(/^\s*(?:-|\*|\d+\.?)?\s*(?:delegate to|assign to|have|assign|role|agent:)?\s*(planner|coder|reviewer|debugger|researcher)\b/i);
      if (roleMatch) {
        if (currentRole && currentGoal) {
          pushTask(currentRole, currentGoal, baseCtx, 0);
        }
        currentRole = roleMatch[1].toLowerCase();
        const matchIndex = line.indexOf(roleMatch[0]);
        let goalPart = line.substring(matchIndex + roleMatch[0].length);
        goalPart = goalPart.replace(/^[:\s\-]+/, '');
        currentGoal = goalPart.trim();
      } else if (currentRole && line.trim()) {
        currentGoal += ' ' + line.trim();
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
        } else if (trimmed.length > 5) {
          // Unformatted line — treat as a single coder task
          pushTask('coder', trimmed, baseCtx, 0);
        }
      }
    }

    if (tasks.length === 0) {
      tasks.push({
        goal: this.truncateGoal(goal),
        context: baseCtx,
        role: 'coder',
        status: 'pending',
        splitDepth: 0,
      });
    }

    return tasks;
  }

  private isDeclaredError(result: string): boolean {
    const normalized = result.trim().toLowerCase();
    return /^(error|failed)/.test(normalized);
  }

  private requiresRealArtifacts(role: string, goal: string): boolean {
    if (role !== 'coder') return false;
    const keywords = ['implement', 'create', 'write', 'add', 'make', 'build', 'update', 'change', 'modify', 'generate', 'setup', 'fix'];
    const lower = goal.toLowerCase();
    return keywords.some(k => lower.includes(k));
  }

  private extractPendingWrites(result: string): string[] {
    const paths: string[] = [];
    const regex = /(?:created|wrote|added|updated|modified|in)\s+([A-Za-z0-9_\-./\\:]+\.[A-Za-z0-9]+)/gi;
    let match;
    while ((match = regex.exec(result)) !== null) {
      paths.push(match[1]);
    }
    const standaloneRegex = /\b([A-Za-z0-9_\-./\\:]+\.[a-zA-Z0-9]+)\b/g;
    let standaloneMatch;
    while ((standaloneMatch = standaloneRegex.exec(result)) !== null) {
      const p = standaloneMatch[1];
      if (!paths.includes(p) && (p.includes('/') || p.includes('\\') || p.includes('.'))) {
        paths.push(p);
      }
    }
    return paths;
  }

  private async verifyArtifacts(role: string, goal: string, result: string, historyStartIndex: number = 0): Promise<boolean> {
    if (!this.requiresRealArtifacts(role, goal)) return true;
    if (this.isDeclaredError(result)) return true;

    if (!this.toolContext.patchHistory || this.toolContext.patchHistory.length <= historyStartIndex) {
      return false;
    }

    const rawPaths = this.extractPendingWrites(result);
    const paths = rawPaths.map(p => p.replace(/\\/g, '/'));

    const currentPatches = this.toolContext.patchHistory.slice(historyStartIndex);
    const normalizedHistory = currentPatches.map(h => ({
      ...h,
      normalizedPath: h.filePath.replace(/\\/g, '/')
    }));

    const hasPatchedMentioned = normalizedHistory.some(h =>
      paths.includes(h.normalizedPath) || paths.some(p => h.normalizedPath.endsWith(p) || p.endsWith(h.normalizedPath))
    );
    if (hasPatchedMentioned) return true;

    const hasRelevantPatch = normalizedHistory.some(h => {
      const base = h.normalizedPath.split('/').pop() || '';
      const goalLower = goal.toLowerCase();
      return goalLower.includes(base.split('.')[0].toLowerCase());
    });
    if (hasRelevantPatch) return true;

    return false;
  }

  private async checkPlaceholders(historyStartIndex: number): Promise<string[]> {
    const history = this.toolContext.patchHistory || [];
    const placeholders: string[] = [];
    for (let i = historyStartIndex; i < history.length; i++) {
      const entry = history[i];
      if (!entry.filePath) continue;
      try {
        const content = fs.readFileSync(entry.filePath, 'utf8');
        const lines = content.split('\n');
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const bracketMatch = lines[lineIdx].match(PLACEHOLDER_RE);
          if (bracketMatch) {
            placeholders.push(`${entry.filePath}:${lineIdx + 1} — ${bracketMatch[0].trim()}`);
          }
          const htmlMatch = lines[lineIdx].match(HTML_PLACEHOLDER_RE);
          if (htmlMatch) {
            placeholders.push(`${entry.filePath}:${lineIdx + 1} — HTML comment placeholder`);
          }
        }
      } catch {
        // file might have been deleted — skip
      }
    }
    return placeholders;
  }

  private async fillPlaceholders(historyStartIndex: number): Promise<number> {
    const history = this.toolContext.patchHistory || [];
    let filled = 0;
    const year = new Date().getFullYear().toString();
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    let userName: string;
    try { userName = os.userInfo().username; } catch { userName = 'user'; }

    for (let i = historyStartIndex; i < history.length; i++) {
      const entry = history[i];
      if (!entry.filePath) continue;
      try {
        const content = fs.readFileSync(entry.filePath, 'utf8');
        const newContent = content
          // Year/date — universally guessable
          .replace(/\[(?:YEAR|Year|year|YYYY|yyyy)\]/g, year)
          .replace(/\[(?:DATE|Date|date|TODAY|Today|today)\]/g, today)
          // Name/author/owner — use system account name
          .replace(/\[(?:YOUR\s+NAME|Your\s+Name|your\s+name|FULLNAME|Fullname|fullname|AUTHOR|Author|author|USERNAME|Username|username|OWNER|Owner|owner)\]/g, userName);
        if (newContent !== content) {
          fs.writeFileSync(entry.filePath, newContent, 'utf8');
          const bracketCount = (content.match(/\[/g) || []).length;
          const newBracketCount = (newContent.match(/\[/g) || []).length;
          filled += bracketCount - newBracketCount;
        }
      } catch {
        // skip
      }
    }
    return filled;
  }

  private async attemptRepair(
    task: DelegationTask,
    previous: AgentResult,
    customContext?: string
  ): Promise<{ success: boolean; summary: string; evidence?: string }> {
    const role = getAgentRole(task.role);
    const tools = filterToolsForRole(BUILTIN_TOOLS, task.role);
    const maxRetries = 2;
    let attempt = 0;
    let currentSummary = previous.summary;
    let currentCustomContext = customContext;

    while (attempt < maxRetries) {
      if (this.toolContext.abortSignal.aborted) {
        break;
      }
      attempt++;
      console.log(`\n[REPAIR] Attempt ${attempt}/${maxRetries} to repair task: ${task.goal}`);

      const baseCtx = currentCustomContext || task.context;
      let repairHint = '';
      if (currentSummary && currentSummary.toLowerCase().includes('i will') && !currentSummary.includes('`write_file`') && !currentSummary.includes('`patch`') && !currentSummary.includes('`terminal`')) {
        repairHint = `\n\nCRITICAL: Your previous response described the work as text but did not actually call any tools. Do not describe WHAT you will do — directly EXECUTE the write_file or patch tool now. Your response must contain a tool call, not a plan or explanation.`;
      }
      const repairContext = `${baseCtx}\n\nPrevious attempt failed verification. Output was:\n${currentSummary}\n\nPlease retry and ensure you actually write the required files/artifacts.${repairHint}`;

      const historyStartIndex = this.toolContext.patchHistory?.length || 0;
      const result = await this.runAgent(role, task.goal, repairContext, tools);

      if (this.toolContext.abortSignal.aborted) {
        return { success: false, summary: 'Task aborted by user' };
      }

      let verified = await this.verifyArtifacts(task.role, task.goal, result, historyStartIndex);
      let repairCheckLogs = '';
      if (verified && (task.role === 'coder' || task.role === 'debugger') && (this.toolContext.patchHistory?.length ?? 0) > historyStartIndex) {
        const checkResult = await this.runBuildVerification();
        if (!checkResult.success) {
          verified = false;
          repairCheckLogs = checkResult.errorLogs || 'Build check failed';
        }
      }

      if (verified && !this.isDeclaredError(result)) {
        return { success: true, summary: result };
      }

      if (repairCheckLogs) {
        currentCustomContext = (customContext || task.context) + `\n\nAdditionally, the build/compilation check failed with error output:\n\`\`\`\n${repairCheckLogs}\n\`\`\``;
      }
      currentSummary = result;
    }

    return { success: false, summary: currentSummary, evidence: 'no artifacts' };
  }

  private hasRealWrites(result: string): boolean {
    const claimed = this.extractPendingWrites(result);
    if (claimed.length === 0) return false;
    const history = this.toolContext.patchHistory || [];
    const historyPaths = new Set(history.map(h => (h.filePath || '').replace(/\\/g, '/')));
    return claimed.some(p => historyPaths.has(p.replace(/\\/g, '/')));
  }

  private verifyArtifactsThoroughly(role: string, goal: string, result: string): boolean {
    if (!this.requiresRealArtifacts(role, goal)) return true;
    if (this.hasRealWrites(result)) return true;
    return !result.toLowerCase().includes('implemented the full');
  }

  private buildCleanSummary(task: DelegationTask, result: string, historyStartIndex: number): string | null {
    const history = this.toolContext.patchHistory || [];
    const newPatches = [];
    for (let i = historyStartIndex; i < history.length; i++) {
      newPatches.push(history[i]);
    }
    if (newPatches.length === 0 || result.split(/\s+/).length < 30) return null;
    const files = [...new Set(newPatches.map(p => p.filePath).filter(Boolean))];
    if (files.length === 0) return null;
    return `Completed: ${task.goal} — Files: ${files.join(', ')}`;
  }

  private static isUnnecessaryConfigTask(task: DelegationTask, projectContext?: string): boolean {
    if (!projectContext) return false;
    const goal = task.goal.toLowerCase();
    const isNextJs = /\bNext\.js\b/i.test(projectContext);
    const isVue = /\b(Vue|Nuxt)\b/i.test(projectContext);

    if (isNextJs && /\bnext\.config\b/i.test(goal)) return true;
    if (isVue && /\b(vue|nuxt)\.config\b/i.test(goal)) return true;

    return false;
  }

  private static getFrameworkGuidance(projectContext?: string): string {
    if (!projectContext) return '';
    const ctx = projectContext;
    if (/\bNext\.js\b/i.test(ctx)) {
      return '\n\nIMPORTANT FRAMEWORK NOTE: Next.js uses file-based routing. Any .tsx or .js file added to pages/ or src/pages/ is automatically available as a web page. No edits to next.config.js or any other config file are needed when adding new pages. Do NOT create tasks for modifying config files.\nROUTING: Use next/link for client-side navigation. Do NOT use react-router-dom, vue-router, or any other router library.\n';
    }
    if (/\b(Vue|Nuxt)\b/i.test(ctx)) {
      return '\n\nFRAMEWORK NOTE: This project uses Vue/Vue Router. New pages typically need route entries added to the router config, not config files like vue.config.js.\n';
    }
    if (/\bExpress\b/i.test(ctx)) {
      return '\n\nFRAMEWORK NOTE: Express requires explicit route handlers. New endpoints must be added to the server/ or routes/ directory.\n';
    }
    return '';
  }

  private static extractRequirements(text: string): string[] {
    if (!text) return [];
    const reqs: string[] = [];
    const m = text.match(/(?:with|including|containing|that\s+(?:has|includes|contains|features?)|featuring)\s+(.+)/i);
    if (!m) return reqs;

    const items = m[1]
      .split(/\s*(?:,\s*|\sand\s|\s*&)\s*/)
      .map(s => s.replace(/^(?:an?\s+|the\s+)/i, '').replace(/\.$/, '').trim())
      .filter(Boolean);

    const filler = new Set(['the following content', 'the specified content', 'appropriate content', 'content', 'your code']);
    for (const item of items) {
      const lower = item.toLowerCase();
      if (!filler.has(lower) && lower.length > 2) {
        reqs.push(item);
      }
    }
    return reqs;
  }

  private static extractFilePaths(text: string): string[] {
    if (!text) return [];
    const paths: string[] = [];
    const re = /(?:\(|\[|\s|^)((?:[A-Za-z0-9_\-./\\]+[\\/])?[A-Za-z0-9_\-]+\.(?:tsx?|jsx?|vue|svelte|css|scss|json|md|csv|txt|yaml|yml|toml|py|rs|go|java|md))(?:[)\s,;]|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const p = m[1].replace(/\\/g, '/');
      if (!p.startsWith('http') && !p.startsWith('node_modules') && p.length < 200) {
        paths.push(p);
      }
    }
    return [...new Set(paths)];
  }

  private static buildDependencyGraph(tasks: DelegationTask[]): void {
    // Auto-detect dependencies: if task B mentions a file path that is the
    // primary target file of an earlier task A, then B depends on A.
    for (let i = 0; i < tasks.length; i++) {
      const laterPaths = Orchestrator.extractFilePaths(tasks[i].goal);
      for (let j = 0; j < i; j++) {
        const earlierPaths = Orchestrator.extractFilePaths(tasks[j].goal);
        const shared = earlierPaths.some(ep => laterPaths.includes(ep));
        if (shared) {
          if (!tasks[i].dependencies) tasks[i].dependencies = [];
          // Only add if not already present
          if (!tasks[i].dependencies!.includes(tasks[j].goal)) {
            tasks[i].dependencies!.push(tasks[j].goal);
          }
        }
      }
    }
  }

  private findStyleReference(taskGoal: string): string | null {
    // Extract target directory from goal
    let dir = '';
    // Try file path first: "src/pages/about.tsx" → "src/pages"
    const fileMatch = taskGoal.match(/([A-Za-z0-9_\-/\\]+\.[a-zA-Z0-9]+)/);
    if (fileMatch) {
      dir = path.dirname(fileMatch[1].replace(/\\/g, '/'));
    } else {
      // Try explicit directory: "in src/components/" or "at pages/"
      const dirMatch = taskGoal.match(/(?:in|at|to|under|inside)\s+(?:the\s+)?([A-Za-z0-9_\-/\\]{2,})(?:\s+(?:directory|folder|path))?/i);
      if (dirMatch) {
        dir = dirMatch[1].replace(/\\/g, '/').replace(/\/+$/, '');
      }
    }
    if (!dir || !fs.existsSync(dir) || dir === '.' || dir === '') return null;

    // Pick a non-test, non-hidden file as style reference
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { return null; }
    const candidates = entries
      .filter(f => !f.startsWith('.') && !f.includes('.test.') && !f.includes('.spec.') && !f.startsWith('__'))
      .sort();

    const target = candidates.find(f => /\.(tsx?|jsx?|vue|svelte)$/i.test(f))
      || candidates.find(f => /\.(css|scss|less)$/i.test(f))
      || candidates[0];

    if (!target) return null;

    const fullPath = path.join(dir, target);
    let content: string;
    try {
      content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      if (lines.length > 50) {
        content = lines.slice(0, 50).join('\n') + '\n... (truncated)';
      }
    } catch { return null; }

    return `\nExisting file in ${dir}/ (use as a style reference):\n--- ${fullPath} ---\n${content}\n--- end ---`;
  }

  private async delegateTask(task: DelegationTask, tasks?: DelegationTask[], goal?: string, projectContext?: string): Promise<void> {
    const role = getAgentRole(task.role);
    console.log(`\n[SPAWN] Delegating to ${role.name}: ${task.goal}`);

    const tools = filterToolsForRole(BUILTIN_TOOLS, task.role);
    const historyStartIndex = this.toolContext.patchHistory?.length || 0;

    // Inject user metadata so the agent has real values instead of guessing
    const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    let enrichedContext = `Current date: ${currentDate}\n`;

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
    const simpleFileRe = /\b(create|write|build|make|generate|add)\b.*\b(file|component|page|layout|module|function|class|route)\b/i;
    const isSimpleFileTask = simpleFileRe.test(task.goal.toLowerCase());
    const styleRef = !isSimpleFileTask ? this.findStyleReference(task.goal) : null;
    if (styleRef) {
      enrichedContext += styleRef;
    }

    // Extract explicit requirements from the task goal only
    const taskReqs = Orchestrator.extractRequirements(task.goal);
    if (taskReqs.length > 0) {
      enrichedContext += `\nRequirements:\n${taskReqs.slice(0, 4).map(r => `  - ${r}`).join('\n')}\n`;
    }
    // NO FILLER CONTENT — the requirements above must be implemented with real content
    if (taskReqs.length > 0 && task.role === 'coder') {
      enrichedContext += `\nCRITICAL: You MUST implement every requirement above with real, specific content. Do NOT use generic filler like "Welcome to our platform", "We provide services", "Learn more about us", or placeholder text. Each requirement needs actual concrete content that a real business would publish.\n`;
    }

    // Extract explicit file paths from the goal and inject a concise scope boundary
    const scopePaths = Orchestrator.extractFilePaths(task.goal);
    if (scopePaths.length > 0) {
      enrichedContext += `\nSCOPE: only touch ${scopePaths.join(', ')}\n`;
    }

    enrichedContext += `\n${frameworkBlock}${task.context}`;
    const systemExtra = `Project context:\n${projectContext || '(none discovered)'}${Orchestrator.getFrameworkGuidance(projectContext)}\n`;

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
          `Continue the remaining work for: ${task.goal}${doneCtx}\nThe previous agent only got partial work done before hitting the turn limit. Break this into smaller, focused steps.`
        );
        const subTasks = this.parseDelegationTasks(subPlan, goal || task.goal);
        const doneInTasks = (tasks || []).filter(t => t.status === 'completed');
        const deduped = subTasks.filter(st => {
          if (doneInTasks.length === 0 || st.role !== 'coder') return true;
          const newPaths = Orchestrator.extractFilePaths(st.goal).map(p => p.toLowerCase());
          if (newPaths.length === 0) return true;
          return !doneInTasks.some(d => {
            if (d.role !== 'coder') return false;
            const donePaths = Orchestrator.extractFilePaths(d.goal).map(p => p.toLowerCase());
            return donePaths.some(dp => newPaths.includes(dp));
          });
        });
        const inheritCtx = filesDone.length > 0
          ? `Original goal: ${task.goal}\nProject root: ${process.cwd()}\n\nIMPORTANT — Files that were partially created and MUST be completed or replaced:\n${filesDone.map(f => `  - ${f}`).join('\n')}\n\nThe previous agent left these files incomplete before hitting the turn limit. You MUST read each file, then either complete it with a proper implementation or replace it entirely. Check the existing project structure first — use read_file on existing files to understand what's already there before creating new ones.`
          : `Original goal: ${task.goal}\nProject root: ${process.cwd()}\n\nCheck the existing project structure first — use read_file on existing files to understand what's already there before creating new ones.`;
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
        await this.rollbackTaskPatches(historyStartIndex);
      }
      this.results.push({
        role: task.role,
        goal: task.goal,
        summary: task.error,
        success: false,
      });
      return;
    }

    let verified = await this.verifyArtifacts(task.role, task.goal, result, historyStartIndex);
    let evidence = '';
    let placeholderSites: string[] = [];
    let checkLogs = '';

    if (verified) {
      placeholderSites = await this.checkPlaceholders(historyStartIndex);
      if (placeholderSites.length > 0) {
        console.log(pc.yellow(`\nFound ${placeholderSites.length} placeholder(s) in written files`));
        // Auto-fill trivial placeholders like [Year], [Your Name]
        const filled = await this.fillPlaceholders(historyStartIndex);
        if (filled > 0) {
          console.log(pc.green(`  Auto-filled ${filled} trivial placeholder(s) (year, name, etc.)`));
        }
        // Re-check for remaining (structural) placeholders
        placeholderSites = await this.checkPlaceholders(historyStartIndex);
        if (placeholderSites.length === 0) {
          verified = true;
        } else {
          verified = false;
        }
      }
    }

    if (verified && (task.role === 'coder' || task.role === 'debugger') && (this.toolContext.patchHistory?.length ?? 0) > historyStartIndex) {
      const checkResult = await this.runBuildVerification();
      if (!checkResult.success) {
        verified = false;
        checkLogs = checkResult.errorLogs || 'Build check failed';
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
      const repaired = await this.attemptRepair(task, {
        role: task.role,
        goal: task.goal,
        summary: result,
        success: false,
      }, repairCtx);
      result = repaired.summary;
      verified = repaired.success;
      evidence = repaired.evidence || '';

      if (verified) {
        const stillPlaceholders = await this.checkPlaceholders(historyStartIndex);
        if (stillPlaceholders.length > 0) {
          // Try auto-fill one more time after repair
          const filled = await this.fillPlaceholders(historyStartIndex);
          if (filled > 0) console.log(pc.green(`  Auto-filled ${filled} remaining trivial placeholder(s)`));
          const remain = await this.checkPlaceholders(historyStartIndex);
          if (remain.length > 0) {
            verified = false;
            evidence = `Placeholders remain: ${remain.join('; ')}`;
          }
        }
      }
    }

    const resultForCheck = result.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const success = verified && !this.isDeclaredError(resultForCheck) && this.verifyArtifactsThoroughly(task.role, task.goal, resultForCheck);
    if (success) {
      const clean = this.buildCleanSummary(task, result, historyStartIndex);
      if (clean) result = clean;
    }
    task.status = success ? 'completed' : 'failed';
    if (!success) {
      task.error = resultForCheck.split('\n')[0] || result.split('\n')[0] || 'Unknown failure';

      // Rollback patches made during this task to keep codebase clean
      if (task.role === 'coder' || task.role === 'debugger') {
        await this.rollbackTaskPatches(historyStartIndex);
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

    console.log(`[OK] ${role.name} completed`);

    // Post-task review if task touched files
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
          const reviewContext = `TASK: ${task.goal}\n\nAgent result:\n${result}${fileList}\n\nReview the files that were touched for this task. Use git_diff or list files modified recently. Check for syntax errors, correctness, and project health.`;
          const reviewTools = filterToolsForRole(BUILTIN_TOOLS, 'reviewer');
          const review = await this.runAgent(reviewerRole, `Review files from task: ${task.goal}`, reviewContext, reviewTools);
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
      try {
        completion = await this.retryApiCall(
          () => this.router.chat.completions.create({
            model: 'auto',
            messages,
            temperature: role.temperature ?? 0.1,
            tools,
            tool_choice: (role.name === 'coder' || role.name === 'debugger') ? 'required' : 'auto',
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

    return output;
  }

  private async rollbackTaskPatches(historyStartIndex: number): Promise<void> {
    const history = this.toolContext.patchHistory;
    if (!history || history.length <= historyStartIndex) return;

    console.log(pc.yellow(`\n[ROLLBACK] Task failed verification. Rolling back changes to preserve workspace health...`));

    // Revert patches in reverse order
    for (let i = history.length - 1; i >= historyStartIndex; i--) {
      const patch = history[i];
      try {
        if (fs.existsSync(patch.filePath)) {
          fs.writeFileSync(patch.filePath, patch.oldContent, 'utf8');
          console.log(pc.gray(`  Reverted changes to ${path.relative(process.cwd(), patch.filePath)}`));
        }
      } catch (err: any) {
        console.log(pc.red(`  Failed to revert changes to ${patch.filePath}: ${err.message}`));
      }
    }

    // Truncate the patch history
    history.length = historyStartIndex;
  }

  private async runBuildVerification(): Promise<{ success: boolean; errorLogs?: string }> {
    const cwd = process.cwd();
    let command = '';

    // Auto-discover verification command
    if (fs.existsSync(path.join(cwd, 'package.json'))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
        if (pkg.scripts && pkg.scripts['daedalus-check']) {
          command = 'npm run daedalus-check';
        } else if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
          command = 'npx tsc --noEmit';
        } else if (pkg.scripts && pkg.scripts.build) {
          command = 'npm run build';
        }
      } catch { /* ignored */ }
    } else if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
      command = 'cargo check';
    } else if (fs.existsSync(path.join(cwd, 'go.mod'))) {
      command = 'go build ./...';
    }

    if (!command) {
      return { success: true };
    }

    console.log(pc.cyan(`\n[VERIFY] Running verification command: "${command}"...`));
    const { exec } = await import('child_process');
    return new Promise((resolve) => {
      exec(command, { cwd, timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          const logs = (stdout + '\n' + stderr).trim();
          console.log(pc.red(`[VERIFY] Verification failed!`));
          resolve({ success: false, errorLogs: logs });
        } else {
          console.log(pc.green(`[VERIFY] Verification passed.`));
          resolve({ success: true });
        }
      });
    });
  }
}

