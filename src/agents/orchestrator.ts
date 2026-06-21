// Multi-agent orchestrator - coordinates delegation and synthesis

import readline from 'readline';
import { LocalRouter } from '../router/index.js';
import { BUILTIN_TOOLS } from '../tools/definitions.js';
import { executeToolCalls } from '../tools/executor.js';
import { getAgentRole, filterToolsForRole, AgentRole } from './roles.js';
import { ToolContext, ToolCall, ChatMessage } from '../types.js';
import pc from 'picocolors';
import { DaedalusSpinner } from '../tools/daedalus-spinner.js';
import { SessionManager } from '../session/manager.js';

interface DelegationTask {
  goal: string;
  context: string;
  role: string;
  toolsets?: string[];
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  error?: string;
}

interface AgentResult {
  role: string;
  goal: string;
  summary: string;
  success: boolean;
  evidence?: string;
}

export class Orchestrator {
  private router: LocalRouter;
  private messages: ChatMessage[];
  private toolContext: ToolContext;
  private sessionManager?: SessionManager;
  private results: AgentResult[] = [];

  constructor(router: LocalRouter, messages: ChatMessage[], toolContext: ToolContext, sessionManager?: SessionManager) {
    this.router = router;
    this.messages = messages;
    this.toolContext = toolContext;
    this.sessionManager = sessionManager;
  }

  async run(goal: string): Promise<string> {
    this.results = [];

    try {
      const plan = await this.createPlan(goal);
      if (this.toolContext.abortSignal.aborted) {
        return 'Orchestration stopped by user';
      }

      const tasks = this.parseDelegationTasks(plan);

      if (this.sessionManager) {
        this.sessionManager.saveState('orchestrate_plan', tasks);
        this.sessionManager.saveState('orchestrate_goal', goal);
        this.sessionManager.saveState('orchestrate_task_index', 0);
        this.sessionManager.saveState('orchestrate_results', []);
        this.sessionManager.saveState('orchestrate_plan_text', plan);
      }

      await this.executePlan(plan, tasks, 0);
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

    tasks.forEach((t, idx) => {
      if (idx < startIndex) {
        t.status = 'completed';
      } else if (!t.status) {
        t.status = 'pending';
      }
    });

    try {
      if (this.toolContext.abortSignal.aborted) {
        return 'Orchestration stopped by user';
      }
      await this.executePlan(planText, tasks, startIndex);
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

  private async createPlan(goal: string): Promise<string> {
    const plannerRole = getAgentRole('planner');
    const tools = filterToolsForRole(BUILTIN_TOOLS, 'planner');

    const systemPrompt = plannerRole.systemPrompt;
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Create a plan for: ${goal}\n\nContext:\n${this.toolContext.activeFiles.size > 0 ? 'Files in context: ' + Array.from(this.toolContext.activeFiles.values()).join(', ') : 'No files in context'}` },
    ];

    const planSpinner = new DaedalusSpinner({ text: 'planner generating plan', color: (s) => pc.cyan(s) });
    planSpinner.start();
    let completion;
    try {
      completion = await this.router.chat.completions.create({
        model: 'auto',
        messages,
        temperature: plannerRole.temperature ?? 0.2,
        tools,
        tool_choice: 'auto',
      });
    } finally {
      planSpinner.stop();
    }

    const assistantMessage = completion.choices[0].message;
    const toolCalls = assistantMessage.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      // Push the assistant turn with its tool calls
      messages.push(assistantMessage);

      // Execute tool calls and push results back into the conversation
      const results = await this.executeOpenAIToolCalls(toolCalls);
      for (const result of results) {
        messages.push({
          role: 'tool',
          content: result.content,
          tool_call_id: result.toolCallId,
        });
      }

      // Ask the planner for a final text summary now that tools have run
      const finalizeSpinner = new DaedalusSpinner({ text: 'planner finalizing plan', color: (s) => pc.cyan(s) });
      finalizeSpinner.start();
      let followUp;
      try {
        followUp = await this.router.chat.completions.create({
          model: 'auto',
          messages,
          temperature: plannerRole.temperature ?? 0.2,
          tools,
          tool_choice: 'none', // No more tool calls — just produce the plan text
        });
      } finally {
        finalizeSpinner.stop();
      }
      return (followUp.choices[0].message).content || 'No plan generated';
    }

    return assistantMessage.content || 'No plan generated';
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

  private async executePlan(
    plan: string,
    tasks: DelegationTask[],
    startIndex: number = 0
  ): Promise<void> {
    for (let i = startIndex; i < tasks.length; i++) {
      if (this.toolContext.abortSignal.aborted) {
        break;
      }
      const task = tasks[i];
      task.status = 'in_progress';
      this.printTaskList(tasks);

      await this.delegateTask(task);
      this.printTaskList(tasks);

      if (this.sessionManager) {
        this.sessionManager.saveState('orchestrate_task_index', i + 1);
        this.sessionManager.saveState('orchestrate_results', this.results);
      }

      if ((task.status as any) === 'failed') {
        console.log(`\n${pc.bold(pc.red('--- Task Failure Checkpoint ---'))}`);
        console.log(`${pc.red('[ERROR] Task failed:')} ${task.role} - ${task.goal}`);

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
            await this.delegateTask(task);
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
              await this.delegateTask(task);
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
            break;
          }
        }

        if (this.toolContext.abortSignal.aborted) {
          break;
        }
      }

      if (i < tasks.length - 1 && process.env.DAEDALUS_AUTO_APPROVE !== 'true') {
        console.log(`\n${pc.bold(pc.yellow('--- Task Checkpoint ---'))}`);
        console.log(`${pc.green('[OK] Completed task:')} ${task.goal}`);
        const nextTask = tasks[i + 1];
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
          if (this.sessionManager) {
            this.sessionManager.saveState('orchestrate_task_index', i + 2);
          }
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

  private parseDelegationTasks(plan: string): DelegationTask[] {
    const tasks: DelegationTask[] = [];
    const activeFilesText = this.toolContext.activeFiles.size > 0
      ? `Files in context: ${Array.from(this.toolContext.activeFiles.values()).join(', ')}`
      : '';
    
    const lines = plan.split('\n');
    let currentRole = '';
    let currentGoal = '';
    
    for (const line of lines) {
      const roleMatch = line.match(/^\s*(?:-|\*|\d+\.)?\s*(?:delegate to|assign to|have|assign|role|agent:)?\s*(planner|coder|reviewer|debugger|researcher)\b/i);
      if (roleMatch) {
        if (currentRole && currentGoal) {
          tasks.push({ goal: currentGoal, context: activeFilesText, role: currentRole, status: 'pending' });
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
      tasks.push({ goal: currentGoal, context: activeFilesText, role: currentRole, status: 'pending' });
    }
    
    if (tasks.length === 0) {
      tasks.push({ 
        goal: plan, 
        context: `Files in context: ${Array.from(this.toolContext.activeFiles.values()).join(', ')}`, 
        role: 'coder',
        status: 'pending'
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

  private async attemptRepair(
    task: DelegationTask,
    previous: AgentResult
  ): Promise<{ success: boolean; summary: string; evidence?: string }> {
    const role = getAgentRole(task.role);
    const tools = filterToolsForRole(BUILTIN_TOOLS, task.role);
    const maxRetries = 2;
    let attempt = 0;
    let currentSummary = previous.summary;

    while (attempt < maxRetries) {
      if (this.toolContext.abortSignal.aborted) {
        break;
      }
      attempt++;
      console.log(`\n[REPAIR] Attempt ${attempt}/${maxRetries} to repair task: ${task.goal}`);

      const repairContext = `${task.context}\n\nPrevious attempt failed verification. Output was:\n${currentSummary}\n\nPlease retry and ensure you actually write the required files/artifacts.`;

      const historyStartIndex = this.toolContext.patchHistory?.length || 0;
      const result = await this.runAgent(role, task.goal, repairContext, tools);

      if (this.toolContext.abortSignal.aborted) {
        return { success: false, summary: 'Task aborted by user' };
      }

      const verified = await this.verifyArtifacts(task.role, task.goal, result, historyStartIndex);

      if (verified && !this.isDeclaredError(result)) {
        return { success: true, summary: result };
      }
      currentSummary = result;
    }

    return { success: false, summary: currentSummary, evidence: 'no artifacts' };
  }

  private async delegateTask(task: DelegationTask): Promise<void> {
    const role = getAgentRole(task.role);
    console.log(`\n[SPAWN] Delegating to ${role.name}: ${task.goal}`);

    const tools = filterToolsForRole(BUILTIN_TOOLS, task.role);
    const historyStartIndex = this.toolContext.patchHistory?.length || 0;
    let result = await this.runAgent(role, task.goal, task.context, tools);

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

    let verified = await this.verifyArtifacts(task.role, task.goal, result, historyStartIndex);
    let evidence = '';

    if (!verified) {
      const repaired = await this.attemptRepair(task, {
        role: task.role,
        goal: task.goal,
        summary: result,
        success: false,
      });
      result = repaired.summary;
      verified = repaired.success;
      evidence = repaired.evidence || '';
    }

    const success = verified && !this.isDeclaredError(result);
    task.status = success ? 'completed' : 'failed';
    if (!success) {
      task.error = result.split('\n')[0] || 'Unknown failure';
    }

    this.results.push({
      role: task.role,
      goal: task.goal,
      summary: result,
      success,
      ...(evidence ? { evidence } : {}),
    });

    console.log(`[OK] ${role.name} completed`);
  }

  private async runAgent(
    role: AgentRole,
    goal: string,
    context: string,
    tools: any[]
  ): Promise<string> {
    const currentDateStr = new Date().toLocaleString();
    const dynamicSystemPrompt = `${role.systemPrompt}\n\n## CURRENT TIME\nThe current date and local time is: ${currentDateStr}.\n`;
    const messages: ChatMessage[] = [
      { role: 'system', content: dynamicSystemPrompt },
      { role: 'user', content: `${context}\n\nTask: ${goal}` },
    ];

    let turns = 0;
    const maxTurns = role.maxTurns ?? 10;

    while (turns < maxTurns) {
      if (this.toolContext.abortSignal.aborted) {
        return 'Agent execution aborted by user';
      }
      const agentSpinner = new DaedalusSpinner({ text: `${role.name} running (turn ${turns + 1})`, color: (s) => pc.cyan(s) });
      agentSpinner.start();
      let completion;
      try {
        completion = await this.router.chat.completions.create({
          model: 'auto',
          messages,
          temperature: role.temperature ?? 0.1,
          tools,
          tool_choice: 'auto',
        });
      } finally {
        agentSpinner.stop();
      }

      if (!completion || !completion.choices || completion.choices.length === 0) {
        return 'Agent completed without response';
      }

      const message = completion.choices[0].message;
      messages.push(message);

      if (message.tool_calls && message.tool_calls.length > 0) {
        const results = await executeToolCalls(
          message.tool_calls.map((tc: any) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
          this.toolContext
        );

        for (const result of results) {
          messages.push({
            role: 'tool',
            content: result.content,
            tool_call_id: result.toolCallId,
          });
        }
        turns++;
        continue;
      }

      // No tool calls - agent is done
      return message.content || 'Agent completed without response';
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
}

