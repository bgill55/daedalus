// Auto-routing primitive for single-agent (REPL) mode.
//
// Lets the active agent fan a large task out to helper sub-agents WITHOUT the
// user having to spawn them manually. The agent stays the conductor: it asks
// the user for permission (via ask_user) first, then calls route_task with
// confirmed: true to delegate independent sub-tasks in parallel.

import { ToolContext, ToolResult } from '../../types.js';
import { getAgentRole, filterToolsForRole } from '../../agents/roles.js';
import { BUILTIN_TOOLS } from '../definitions.js';

// Derive a human-readable cause for why a sub-agent (route/delegate) hit its turn
// budget. The sub-agent loops are minimal (no consecutive-failure ledger like the
// main loop), so we track only: the last tool names attempted, and the last tool
// failure observed. That is enough to distinguish a runaway (same failing command
// repeated), a stall (kept calling tools but never finished), or a natural cap.
export function subAgentMaxTurnsCause(lastToolNames: string[], lastFailure: string | null): string {
  if (lastFailure) {
    const breaker = /\[CIRCUIT BREAKER\]/i.test(lastFailure);
    const auth = /401|403|invalid api key|unauthorized|ECONNREFUSED|ETIMEDOUT|timed out|timeout/i.test(lastFailure);
    if (breaker) return `repeated failed command tripped the terminal circuit breaker (loop/retry guard) — ${lastFailure.split('\n')[0].slice(0, 120)}`;
    if (auth) return `API/auth or timeout stalls — ${lastFailure.split('\n')[0].slice(0, 120)}`;
    return `last tool call failed — ${lastFailure.split('\n')[0].slice(0, 120)}`;
  }
  const tools = lastToolNames.length > 0 ? [...new Set(lastToolNames)].join(', ') : 'none';
  return `budget exhausted while still emitting tool calls (${tools}) — likely a large/iterative task that needs more turns or a smaller scope`;
}
import { executeToolCalls } from '../executor.js';
import { messageText } from '../../types.js';
import type { ChatMessage, ToolCall } from '../../types.js';
import type { ChatRequest } from '../../router/types.js';
import { VALID_AGENT_ROLES } from './handoff.js';

interface LocalRouter {
  chat: {
    completions: {
      create(params: ChatRequest): Promise<any>;
    };
  };
}

let routerClient: LocalRouter | null = null;

export function setRouteRouterClient(client: LocalRouter) {
  routerClient = client;
}

interface SubTask {
  role: string;
  goal: string;
  context?: string;
}

interface RouteArgs {
  tasks: SubTask[];
  confirmed?: boolean;
  handoff_notes?: string;
}

async function runOneSubTask(task: SubTask, context: ToolContext): Promise<string> {
  const role = VALID_AGENT_ROLES.includes(task.role as any) ? task.role : 'coder';
  const agentRole = getAgentRole(role);
  const currentDateStr = new Date().toLocaleString();
  const dynamicSystemPrompt = `${agentRole.systemPrompt}\n\n## CURRENT TIME\nThe current date and local time is: ${currentDateStr}.\n`;
  const messages: ChatMessage[] = [
    { role: 'system', content: dynamicSystemPrompt },
    { role: 'user', content: `${task.context ?? ''}\n\nTask: ${task.goal}` },
  ];

  const tools = filterToolsForRole(BUILTIN_TOOLS, role);
  const maxTurns = agentRole.maxTurns ?? 10;
  const lastToolNames: string[] = [];
  let lastFailure: string | null = null;

  for (let turns = 0; turns < maxTurns; turns++) {
    const completion = await routerClient!.chat.completions.create({
      model: 'auto',
      complexity: 'complex',
      messages,
      temperature: agentRole.temperature ?? 0.1,
      tools,
      tool_choice: 'auto',
    } as ChatRequest);

    const message = completion.choices[0].message;
    messages.push(message);

    if (message.tool_calls && message.tool_calls.length > 0) {
      const subContext = { ...context, agentRole: role };
      const results = await executeToolCalls(
        message.tool_calls.map((tc: ToolCall) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
        subContext,
      );
      for (const result of results) {
        lastToolNames.push(result.name);
        if (!result.success && result.error) lastFailure = `${result.error}`;
        messages.push({
          role: 'tool',
          content: result.content,
          tool_call_id: result.toolCallId,
        });
      }
      continue;
    }

    return messageText(message.content) || 'Sub-agent completed';
  }

  return `Sub-agent reached max turns (cause: ${subAgentMaxTurnsCause(lastToolNames, lastFailure)})`;
}

export async function routeTask(args: RouteArgs, context: ToolContext): Promise<ToolResult> {
  if (!routerClient) {
    return {
      toolCallId: '',
      name: 'route_task',
      success: false,
      content: '',
      error: 'Router client not initialized for routing',
    };
  }

  const tasks = Array.isArray(args.tasks) ? args.tasks : [];
  if (tasks.length === 0) {
    return {
      toolCallId: '',
      name: 'route_task',
      success: false,
      content: '',
      error: 'No tasks provided to route_task',
    };
  }

  // Permission gate: the agent MUST confirm the user approved routing. It should
  // obtain that approval via ask_user before calling this tool with confirmed: true.
  if (!args.confirmed) {
    return {
      toolCallId: '',
      name: 'route_task',
      success: false,
      content: '[ROUTE] Permission not confirmed. Ask the user for approval (ask_user) before routing, then call route_task with confirmed: true.',
      error: 'Routing requires explicit user confirmation (confirmed: true).',
    };
  }

  try {
    const settled = await Promise.allSettled(
      tasks.map((t) => runOneSubTask(t, context))
    );

    const lines: string[] = [];
    let anyFailed = false;
    settled.forEach((res, i) => {
      const t = tasks[i];
      if (res.status === 'fulfilled') {
        lines.push(`### ${t.role}: ${t.goal}\n${res.value}`);
      } else {
        anyFailed = true;
        lines.push(`### ${t.role}: ${t.goal}\n[FAILED] ${res.reason instanceof Error ? res.reason.message : String(res.reason)}`);
      }
    });

    const summary = `[ROUTED] Completed ${settled.filter((s) => s.status === 'fulfilled').length}/${tasks.length} sub-tasks in parallel.${args.handoff_notes ? `\n\nHandoff notes: ${args.handoff_notes}` : ''}\n\n${lines.join('\n\n')}`;

    return {
      toolCallId: '',
      name: 'route_task',
      success: !anyFailed,
      content: summary,
    };
  } catch (err) {
    return {
      toolCallId: '',
      name: 'route_task',
      success: false,
      content: '',
      error: `Routing failed: ${(err instanceof Error ? err.message : String(err))}`,
    };
  }
}

// Heuristic nudge signal: does this single-agent request look like a large,
// multi-phase task that could benefit from routing to helper agents?
// Pure + deterministic so it is cheap to call on every turn and unit-testable.
const MULTI_PHASE_CUES = [
  /\b(implement|build|create|add|set up|scaffold)\b/i,
  /\b(and|plus|along with|as well as)\b/i,
  /\b(research|investigate|figure out|understand)\b/i,
  /\b(plan|design|architecture|architect)\b/i,
  /\b(then|after that|followed by|next)\b/i,
  /\bmultiple (files|modules|services|components|packages)\b/i,
  /\b(end[\s-]?to[\s-]?end|full[- ]stack|e2e)\b/i,
  /\b(with (a |an )?(test|tests|tests? suite|documentation|docs))\b/i,
];

export function looksMultiPhase(request: string): boolean {
  const text = (request || '').trim();
  if (text.length < 25) return false; // too short to be a multi-phase task
  // Require both an action verb AND a second phase/coordination cue, so a
  // single-file "fix the bug in X" never triggers the nudge.
  const hasAction = MULTI_PHASE_CUES.slice(0, 1).some((re) => re.test(text));
  const hasSecondPhase = MULTI_PHASE_CUES.slice(1).some((re) => re.test(text));
  return hasAction && hasSecondPhase;
}
