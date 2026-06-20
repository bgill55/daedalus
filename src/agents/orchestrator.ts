// Multi-agent orchestrator - coordinates delegation and synthesis

import { LocalRouter } from '../router/index.js';
import { BUILTIN_TOOLS } from '../tools/definitions.js';
import { executeToolCalls } from '../tools/executor.js';
import { getAgentRole, filterToolsForRole, AgentRole } from './roles.js';
import { ToolContext, ToolCall, ChatMessage } from '../types.js';
import pc from 'picocolors';
import { DaedalusSpinner } from '../tools/daedalus-spinner.js';

interface DelegationTask {
  goal: string;
  context: string;
  role: string;
  toolsets?: string[];
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
  private results: AgentResult[] = [];

  constructor(router: LocalRouter, messages: ChatMessage[], toolContext: ToolContext) {
    this.router = router;
    this.messages = messages;
    this.toolContext = toolContext;
  }

  async run(goal: string): Promise<string> {
    this.results = [];

    try {
      const plan = await this.createPlan(goal);
      if (this.toolContext.abortSignal.aborted) {
        return 'Orchestration stopped by user';
      }
      await this.executePlan(plan);
    } catch (err) {
      return `Orchestration failed: ${(err as Error).message}`;
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

  private async executePlan(plan: string): Promise<void> {
    const delegationTasks = this.parseDelegationTasks(plan);
    
    for (const task of delegationTasks) {
      if (this.toolContext.abortSignal.aborted) {
        break;
      }
      await this.delegateTask(task);
    }
  }

  private parseDelegationTasks(plan: string): DelegationTask[] {
    const tasks: DelegationTask[] = [];
    
    const lines = plan.split('\n');
    let currentRole = '';
    let currentGoal = '';
    
    for (const line of lines) {
      const roleMatch = line.match(/(?:delegate to|have|assign to)\s+(planner|coder|reviewer|debugger|researcher)/i);
      if (roleMatch) {
        if (currentRole && currentGoal) {
          tasks.push({ goal: currentGoal, context: '', role: currentRole });
        }
        currentRole = roleMatch[1].toLowerCase();
        currentGoal = line.replace(roleMatch[0], '').trim();
      } else if (currentRole && line.trim()) {
        currentGoal += ' ' + line.trim();
      }
    }
    
    if (currentRole && currentGoal) {
      tasks.push({ goal: currentGoal, context: '', role: currentRole });
    }
    
    // If no explicit delegation found, default to coder for implementation tasks
    if (tasks.length === 0) {
      tasks.push({ 
        goal: plan, 
        context: `Files in context: ${Array.from(this.toolContext.activeFiles.values()).join(', ')}`, 
        role: 'coder' 
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

  private async verifyArtifacts(role: string, goal: string, result: string): Promise<boolean> {
    if (!this.requiresRealArtifacts(role, goal)) return true;
    if (this.isDeclaredError(result)) return true;

    if (!this.toolContext.patchHistory || this.toolContext.patchHistory.length === 0) {
      return false;
    }

    const rawPaths = this.extractPendingWrites(result);
    const paths = rawPaths.map(p => p.replace(/\\/g, '/'));

    const normalizedHistory = this.toolContext.patchHistory.map(h => ({
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
      console.log(`\n[REPAIR] Attempt ${attempt}/${maxRetries} to repair task: ${task.goal.slice(0, 60)}...`);

      const repairContext = `${task.context}\n\nPrevious attempt failed verification. Output was:\n${currentSummary}\n\nPlease retry and ensure you actually write the required files/artifacts.`;

      const result = await this.runAgent(role, task.goal, repairContext, tools);
      const verified = await this.verifyArtifacts(task.role, task.goal, result);

      if (verified && !this.isDeclaredError(result)) {
        return { success: true, summary: result };
      }
      currentSummary = result;
    }

    return { success: false, summary: currentSummary, evidence: 'no artifacts' };
  }

  private async delegateTask(task: DelegationTask): Promise<void> {
    const role = getAgentRole(task.role);
    console.log(`\n[SPAWN] Delegating to ${role.name}: ${task.goal.slice(0, 80)}...`);

    const tools = filterToolsForRole(BUILTIN_TOOLS, task.role);
    let result = await this.runAgent(role, task.goal, task.context, tools);

    let verified = await this.verifyArtifacts(task.role, task.goal, result);
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

    this.results.push({
      role: task.role,
      goal: task.goal,
      summary: result,
      success: verified && !this.isDeclaredError(result),
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
    const messages: ChatMessage[] = [
      { role: 'system', content: role.systemPrompt },
      { role: 'user', content: `${context}\n\nTask: ${goal}` },
    ];

    let turns = 0;
    const maxTurns = role.maxTurns ?? 10;

    while (turns < maxTurns) {
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
    const hasFailures = this.results.some(r => !r.success);
    let output = hasFailures
      ? `## Orchestration Hit Verification Failures: ${goal}\n\n`
      : `## Orchestration Complete: ${goal}\n\n`;

    for (const result of this.results) {
      const status = result.success ? '[OK]' : '[ERROR]';
      output += `${status} **${result.role}**: ${result.goal.slice(0, 100)}\n`;
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

