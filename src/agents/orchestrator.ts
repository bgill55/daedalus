// Multi-agent orchestrator - coordinates delegation and synthesis

import { LocalRouter } from '../router/index.js';
import { BUILTIN_TOOLS } from '../tools/definitions.js';
import { executeToolCalls } from '../tools/executor.js';
import { getAgentRole, filterToolsForRole, AgentRole } from './roles.js';
import { ToolContext, ToolCall, ChatMessage } from '../types.js';

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

    const completion = await this.router.chat.completions.create({
      model: 'auto',
      messages,
      temperature: plannerRole.temperature ?? 0.2,
      tools,
      tool_choice: 'auto',
    });

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
      const followUp = await this.router.chat.completions.create({
        model: 'auto',
        messages,
        temperature: plannerRole.temperature ?? 0.2,
        tools,
        tool_choice: 'none', // No more tool calls — just produce the plan text
      });
      return (followUp.choices[0].message).content || 'No plan generated';
    }

    return assistantMessage.content || 'No plan generated';
  }

  private async executePlan(plan: string): Promise<void> {
    const delegationTasks = this.parseDelegationTasks(plan);
    
    for (const task of delegationTasks) {
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

  private async delegateTask(task: DelegationTask): Promise<void> {
    const role = getAgentRole(task.role);
    console.log(`\n[SPAWN] Delegating to ${role.name}: ${task.goal.slice(0, 80)}...`);
    
    const tools = filterToolsForRole(BUILTIN_TOOLS, task.role);
    const result = await this.runAgent(role, task.goal, task.context, tools);
    
    this.results.push({
      role: task.role,
      goal: task.goal,
      summary: result,
      success: !/^(Error|Failed)/.test(result.trim()),
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
      const completion = await this.router.chat.completions.create({
        model: 'auto',
        messages,
        temperature: role.temperature ?? 0.1,
        tools,
        tool_choice: 'auto',
      });

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
    let output = `## Orchestration Complete: ${goal}\n\n`;
    
    for (const result of this.results) {
      const status = result.success ? '[OK]' : '[ERROR]';
      output += `${status} **${result.role}**: ${result.goal.slice(0, 100)}\n`;
      output += `   ${result.summary.slice(0, 200)}\n\n`;
    }
    
    return output;
  }
}

