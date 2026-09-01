// Multi-agent orchestrator - coordinates delegation and synthesis

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { LocalRouter } from '../router/index.js';
import { BUILTIN_TOOLS } from '../tools/definitions.js';
import { mcpRegistry } from '../tools/mcp/registry.js';
import { getAgentRole, filterToolsForRole, roleLabel, resolveRoleKey } from './roles.js';
import { ToolContext, ChatMessage, messageText, ToolDefinition, ToolCall, ToolResult } from '../types.js';
import pc from 'picocolors';
import { DaedalusSpinner } from '../tools/daedalus-spinner.js';
import { SessionManager } from '../session/manager.js';

import { errMessage } from '../utils/errors.js';
import {
  filterValidTasks,
  validateTasks, cleanTaskText, cleanPlanOutput, truncateGoal,
  extractFilePaths, buildDependencyGraph, groupIndependent,
  isUnnecessaryConfigTask, getFrameworkGuidance,
} from './orchestrator-validation.js';
import {
  runBuildVerification, isRealFile,
} from './orchestrator-verification.js';
import { generateSpecContract } from './spec.js';
import type { DelegationTask, AgentResult } from './orchestrator-types.js';
import { maskSecrets } from '../security/secret-detector.js';
import { TaskDelegator } from './task-delegator.js';

export class Orchestrator {
  private router: LocalRouter;
  private messages: ChatMessage[];
  private toolContext: ToolContext;
  private sessionManager?: SessionManager;
  private modelOverride?: string;
  private taskDelegator: TaskDelegator;
  public get results(): AgentResult[] {
    return this.taskDelegator.results;
  }
  public set results(val: AgentResult[]) {
    this.taskDelegator.results = val;
  }

  private readonly MAX_INITIAL_TASKS = 12;
  private readonly MAX_TOTAL_TASKS = 20;
  private readonly REPLAN_INTERVAL = 2;

  constructor(
    router: LocalRouter,
    messages: ChatMessage[],
    toolContext: ToolContext,
    sessionManager?: SessionManager,
    modelOverride?: string
  ) {
    this.router = router;
    this.messages = messages;
    this.toolContext = toolContext;
    this.sessionManager = sessionManager;
    this.modelOverride = modelOverride;

    this.taskDelegator = new TaskDelegator(
      this.router,
      this.toolContext,
      this.sessionManager,
      this.modelOverride,
      undefined,
      {
        createPlan: (g, p) => this.createPlan(g, p),
        parseDelegationTasks: (p, g) => this.parseDelegationTasks(p, g),
        printTaskList: (t, f) => this.printTaskList(t, f),
      }
    );
  }

  private async retryApiCall<T>(fn: () => Promise<T>, label: string, maxRetries = 2): Promise<T> {
    return this.taskDelegator.getSubAgentRunner().retryApiCall(fn, label, maxRetries);
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
          const cleaned = rawVer.replace(/^[^0-9]*/, '');
          const major = parseInt(cleaned.split('.')[0]);
          const isAppRouter = fs.existsSync(path.join(cwd, 'app'));
          info.push(`Next.js (v${rawVer}${major >= 13 ? (isAppRouter ? ' App Router' : ' Pages Router') : ''})`);
        } else if (pkg.dependencies.react) {
          info.push(`React (v${pkg.dependencies.react})`);
        }
        if (pkg.dependencies.vue) info.push(`Vue (v${pkg.dependencies.vue})`);
        if (pkg.dependencies.svelte) info.push(`Svelte (v${pkg.dependencies.svelte})`);
        if (pkg.dependencies.tailwindcss || pkg.devDependencies?.tailwindcss) info.push('Tailwind CSS');
        if (pkg.dependencies['@prisma/client'] || pkg.devDependencies?.prisma) info.push('Prisma ORM');
        if (pkg.dependencies.drizzle || pkg.devDependencies?.['drizzle-orm']) info.push('Drizzle ORM');
      }
      if (info.length > 0) parts.push(`Framework/Stack: ${info.join(', ')}`);
    } catch { /* no package.json or invalid JSON */ }

    try {
      const entries = fs.readdirSync(cwd).filter(f => !f.startsWith('.') && f !== 'node_modules' && f !== 'dist');
      parts.push(`Key directories: ${entries.slice(0, 8).join(', ')}`);
    } catch { /* unreadable directory */ }

    return parts.join('\n');
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

      if (tasks.length === 0) {
        return `Orchestration failed: planning produced no executable tasks for goal: ${goal}. The planner returned an empty or unparseable plan (delegate-to lines must name a known agent role, e.g. "delegate to Hephaestus: ...").`;
      }

      const preFlight = await runBuildVerification(this.toolContext, 0);
      const isNoInputsErr = preFlight.errorLogs && (preFlight.errorLogs.includes('TS18003') || preFlight.errorLogs.includes('No inputs were found'));
      if (!preFlight.success && preFlight.errorLogs && !isNoInputsErr) {
        console.log(pc.yellow(`\n[Pre-Flight] Pre-existing build errors detected in workspace. Prepending Task 0 to repair existing code first...`));
        const firstErrorLine = preFlight.errorLogs.split('\n')[0].trim().slice(0, 300);
        tasks.unshift({
          goal: `Fix pre-existing compilation/build error in codebase before implementing feature: ${firstErrorLine}`,
          context: `${projectContext || ''}\n\n[COMPILATION ERROR DETAILS]\n${preFlight.errorLogs}`,
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
            model: this.modelOverride || 'intelligence',
            complexity: this.modelOverride ? undefined : 'complex',
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
            content: maskSecrets(result.content),
            tool_call_id: result.toolCallId,
          });
        }

        const finalizeSpinner = new DaedalusSpinner({ text: `${roleLabel('planner')} finalizing plan`, color: (s) => pc.cyan(s) });
        finalizeSpinner.start();
        let followUp;
        try {
          followUp = await this.retryApiCall(
            () => this.router.chat.completions.create({
              model: this.modelOverride || 'intelligence',
              complexity: this.modelOverride ? undefined : 'complex',
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
        const content = messageText((followUp.choices[0].message).content);
        const isRefusal = content.length < 300 && REFUSAL_RE.test(content) && !content.includes('delegate to');
        if (isRefusal) continue;
        if (!content) continue;
        planText = content;
      } else {
        const content = messageText(assistantMessage.content);
        const isRefusal = content.length < 300 && REFUSAL_RE.test(content) && !content.includes('delegate to');
        if (isRefusal) continue;
        if (!content) continue;
        planText = content;
      }

      const testTasks = this.parseDelegationTasks(planText || `- delegate to ${roleLabel('coder')}: ${goal}`, goal);
      const validationError = validateTasks(testTasks, goal, this.toolContext.projectRoot);
      if (!validationError) {
        return planText || `- delegate to ${roleLabel('coder')}: ${goal}`;
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
          `- delegate to ${roleLabel('coder')}: create app/layout.tsx as the root Next.js App Router layout with a header and footer${styleNote}`,
          `- delegate to ${roleLabel('coder')}: create app/page.tsx as the main landing page with a hero section and call-to-action${styleNote}`,
          `- delegate to ${roleLabel('coder')}: create app/about/page.tsx with project overview and a link back to home${styleNote}`,
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
          tasks.push(`- delegate to ${roleLabel('coder')}: create ${pagesPrefix}/index.tsx as the main landing page with a hero section and call-to-action${styleNote}`);
        } else if (!dashboardExists) {
          tasks.push(`- delegate to ${roleLabel('coder')}: create ${pagesPrefix}/dashboard.tsx as a dashboard page showing key project stats${styleNote}`);
        }
        if (!featuresExists) {
          tasks.push(`- delegate to ${roleLabel('coder')}: create ${pagesPrefix}/features.tsx with feature cards describing the project${styleNote}`);
        }
        if (tasks.length > 0) return tasks.join('\n');
      }
    }

    const constraintRe = /(?:do\s+not\s+modify|don'?t\s+(?:touch|modify|change)|without\s+(?:changing|modifying)|leave\s+\S*\s+alone|existing\s+(?:endpoints?|files?|routes?)\s+(?:in|at)|keep\s+\S*\s+unchanged)[^.;]*?(?:src|tests|public|app|pages)\/[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+/gi;
    const constraintPaths = new Set<string>(
      (goal.match(constraintRe) || [])
        .map((m) => (m.match(/(?:src|tests|public|app|pages)\/[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+/) || [])[0])
        .filter((p): p is string => typeof p === 'string')
    );
    const strippedGoal = constraintPaths.size > 0
      ? goal.replace(new RegExp([...constraintPaths].map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi'), ' ')
      : goal;

    const explicitFiles = Array.from(
      new Set(
        (strippedGoal.match(/(?:\b(?:src|tests|public|app|pages)\/[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]+)/g) || [])
          .map((f) => f.replace(/[.\s]+$/, ''))
      )
    );
    if (explicitFiles.length > 1) {
      const uniqueFiles = Array.from(new Set(explicitFiles));
      return uniqueFiles.map(f => `- delegate to ${roleLabel('coder')}: create or update ${f} to support: ${goal.slice(0, 100)}`).join('\n');
    }

    const isCoder = /\b(create|add|build|implement|write|generate|make|new|refactor|fix|modify|update)\b/i.test(goal);
    const fallbackRole = isCoder
      ? 'coder'
      : /\b(verify|check|test|review|inspect|validate|confirm)\b/i.test(goal)
        ? 'reviewer'
        : /\b(research|investigate|find out|look up|search for)\b/i.test(goal)
          ? 'researcher'
          : 'coder';
    return `- delegate to ${roleLabel(fallbackRole)}: ${goal}`;
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

    if (!forceFull && (running > 0 || completed > 0)) {
      const activeTask = tasks.find(t => t.status === 'in_progress');
      const activeText = activeTask ? ` | Active: [${roleLabel(activeTask.role)}] ${activeTask.goal.slice(0, 50)}...` : '';
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
      } else if ((task.status as string) === 'failed') {
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
      if (t.dependencies && t.dependencies.length > 0) {
        const allDone = t.dependencies.every(dep => tasks.some(other => other.goal === dep && (other.status === 'completed' || other.status === 'skipped')));
        if (!allDone) continue;
      }
      batch.push(t);
      if (process.env.DAEDALUS_AUTO_APPROVE === 'true' && batch.length < 2) {
        continue;
      } else {
        break;
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

    if ((task.status as string) === 'failed') {
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
        if ((task.status as string) !== 'failed') {
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
          if ((task.status as string) !== 'failed') {
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
            if ((task.status as string) !== 'failed') {
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

    buildDependencyGraph(tasks);

    for (let i = startIndex; i < tasks.length; /* increment inside */) {
      if (this.toolContext.abortSignal.aborted) {
        break;
      }

      if (i >= this.MAX_TOTAL_TASKS && tasks.filter(t => t.status === 'pending').length > 0) {
        console.log(pc.yellow(`\nReached task limit (${this.MAX_TOTAL_TASKS}). Halting new task generation.`));
        while (tasks.length > this.MAX_TOTAL_TASKS) {
          const removed = tasks.pop();
          if (removed) { removed.status = 'skipped'; removed.error = 'Reached task limit'; }
        }
        break;
      }

      const task = tasks[i];

      if (task.status === 'completed' || task.status === 'skipped') {
        i++;
        continue;
      }

      if (isUnnecessaryConfigTask(task, projectContext)) {
        console.log(pc.yellow(`\nSkipping task ${i + 1}: Next.js uses file-based routing — no config changes needed`));
        task.status = 'skipped';
        task.error = 'Unnecessary config task for file-based routing framework';
        i++;
        continue;
      }

      const batch = this.getNextBatch(tasks, i);
      if (batch.length === 0) {
        i++;
        continue;
      }

      if (process.env.DAEDALUS_AUTO_APPROVE === 'true') {
        const groups = groupIndependent(batch);
        for (const group of groups) {
          await Promise.all(
            group.map(t => this.executeSingleTask(t, tasks, originalGoal, projectContext))
          );
        }
      } else {
        for (const t of batch) {
          await this.executeSingleTask(t, tasks, originalGoal, projectContext);
        }
      }

      while (i < tasks.length && tasks[i].status !== 'pending') {
        i++;
      }

      if (this.sessionManager) {
        this.sessionManager.saveState('orchestrate_task_index', i);
        this.sessionManager.saveState('orchestrate_results', this.results);
      }

      const completedCount = tasks.filter(t => t.status === 'completed').length;
      if (completedCount > 0 && completedCount - lastReplanCount >= this.REPLAN_INTERVAL) {
        const hasPending = tasks.some(t => t.status === 'pending' || t.status === 'in_progress');
        if (hasPending && originalGoal) {
          lastReplanCount = completedCount;
          await this.replanRemaining(tasks, originalGoal, projectContext);
          buildDependencyGraph(tasks);
        }
      }

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

    const executed = tasks.filter(t => t.status === 'completed' || t.status === 'in_progress').length;
    const anyDelegated = (this.results?.length ?? 0) > 0;
    if (executed === 0 && !anyDelegated) {
      throw new Error('Orchestration produced no executed tasks — plan collapsed to zero runnable work. No artifacts were generated.');
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

    const originalPending = tasks
      .filter(t => t.status === 'pending')
      .map(t => ({ ...t }));

    console.log(pc.cyan(`\n[RE-PLAN] ${pending.length} task(s) remaining. Re-evaluating based on completed work...`));

    const subPlan = await this.createPlan(
      `Original goal: ${originalGoal}\n\nCompleted so far:\n${summary}\n\nFiles already written: ${completedFiles.length > 0 ? completedFiles.join(', ') : '(none)'}\n\nRemaining:\n${remainingList}\n\nBased on what was completed, re-plan the remaining work. Consolidate and simplify — aim for at most ${this.MAX_INITIAL_TASKS} focused steps. Do NOT repeat tasks that are already done. Do NOT re-create files that already exist. Each remaining step must produce real output that has not been created yet.`,
      projectContext
    );

    for (let i = tasks.length - 1; i >= 0; i--) {
      if (tasks[i].status === 'pending') {
        tasks.splice(i, 1);
      }
    }

    let newTasks = this.parseDelegationTasks(subPlan, originalGoal);
    newTasks = newTasks.filter(nt => {
      if (done.length === 0 || nt.role !== 'coder') return true;
      const newPaths = extractFilePaths(nt.goal).map(p => p.toLowerCase());
      if (newPaths.length === 0) return true;
      const root = this.toolContext.projectRoot || process.cwd();
      const allExist = newPaths.every(p => isRealFile(path.resolve(root, p)));
      return !allExist;
    });

    newTasks = filterValidTasks(newTasks).slice(0, this.MAX_INITIAL_TASKS);

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

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (/^\s*tools?\s*used\b/i.test(trimmedLine)) continue;
      if (/^\(?tools?\s*used\b/i.test(trimmedLine)) continue;
      const roleRe = /^\s*(?:-|\*|\d+\.?)?\s*(?:delegate\s+to|assign\s+to|agent:)?\s*(planner|coder|reviewer|debugger|researcher|hephaestus|apollo|themis|metis|asclepius|mnemosyne|daedalus)\s*:/i;
      const roleMatch = line.match(roleRe);
      if (roleMatch) {
        if (currentRole && currentGoal) {
          pushTask(currentRole, currentGoal, baseCtx, 0);
        }
        currentRole = resolveRoleKey(roleMatch[1]);
        const matchIndex = line.indexOf(roleMatch[0]);
        let goalPart = line.substring(matchIndex + roleMatch[0].length);
        goalPart = goalPart.replace(/^[:\s\-]+/, '');
        currentGoal = goalPart.trim();
      } else if (currentRole && trimmedLine) {
        const isCommentary = trimmedLine.length > 60 && /^[A-Z]/.test(trimmedLine) && !/^(and|or|with|using|that|which|to|for|in|on|at)\b/i.test(trimmedLine);
        if (!isCommentary) {
          currentGoal += ' ' + trimmedLine;
        }
      }
    }
    
    if (currentRole && currentGoal) {
      pushTask(currentRole, currentGoal, baseCtx, 0);
    }
    
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
          const hasActionVerb = /\b(create|write|build|implement|update|add|fix|generate|install|setup|configure|refactor|move|delete|rename)\b/i.test(trimmed);
          if (hasActionVerb) {
            pushTask('coder', trimmed, baseCtx, 0);
          }
        }
      }
    }

    if (tasks.length === 0) {
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

  private async delegateTask(task: DelegationTask, tasks?: DelegationTask[], goal?: string, projectContext?: string): Promise<void> {
    return this.taskDelegator.delegateTask(task, tasks, goal, projectContext);
  }

  private async runAgent(
    role: import('./roles.js').AgentRole,
    goal: string,
    context: string,
    tools: ToolDefinition[],
    systemExtra?: string,
  ): Promise<string> {
    return this.taskDelegator.getSubAgentRunner().runAgent(role, goal, context, tools, systemExtra);
  }

  private async executeOpenAIToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    return this.taskDelegator.getSubAgentRunner().executeOpenAIToolCalls(toolCalls);
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

      const daedalusDir = path.join(projectRoot, '.daedalus');
      if (!fs.existsSync(daedalusDir)) {
        fs.mkdirSync(daedalusDir, { recursive: true });
      }
      const walkthroughPath = path.join(daedalusDir, 'walkthrough.md');
      fs.writeFileSync(walkthroughPath, md, 'utf8');
      console.log(pc.green(`\n[WALKTHROUGH] Generated walkthrough guide at .daedalus/walkthrough.md`));
    } catch (err) {
      console.log(pc.yellow(`\n[WARN] Failed to write walkthrough.md: ${errMessage(err)}`));
    }
  }
}
