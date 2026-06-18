// Delegation tool for spawning sub-agents

import { ToolContext, ToolResult } from '../../types.js';
import { BUILTIN_TOOLS } from '../definitions.js';
import { executeToolCalls } from '../executor.js';
import { getAgentRole, filterToolsForRole } from '../../agents/roles.js';

interface LocalRouter {
  chat: {
    completions: {
      create(params: any): Promise<any>;
    };
  };
}

let routerClient: LocalRouter | null = null;

export function setRouterClient(client: LocalRouter) {
  routerClient = client;
}

export async function manage(args: { goal: string; context?: string; role?: string; toolsets?: string[] }, context: ToolContext): Promise<ToolResult> {
  if (!routerClient) {
    return {
      toolCallId: '',
      name: 'delegate_task',
      success: false,
      content: '',
      error: 'Router client not initialized for delegation',
    };
  }

  try {
    const role = args.role ?? 'coder';
    const agentRole = getAgentRole(role);
    const messages: any[] = [
      { role: 'system', content: agentRole.systemPrompt },
      { role: 'user', content: `${args.context ?? ''}\n\nTask: ${args.goal}` },
    ];

    const tools = filterToolsForRole(BUILTIN_TOOLS, role);
    let turns = 0;
    const maxTurns = 10;

    while (turns < maxTurns) {
      const completion = await routerClient.chat.completions.create({
        model: 'auto',
        messages,
        temperature: 0.1,
        tools,
        tool_choice: 'auto',
      });

      const message = completion.choices[0].message;
      messages.push(message);

      if (message.tool_calls && message.tool_calls.length > 0) {
        const subContext = {
          ...context,
          agentRole: role,
        };
        const results = await executeToolCalls(
          message.tool_calls.map((tc: any) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
          subContext
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

      // Agent completed
      return {
        toolCallId: '',
        name: 'delegate_task',
        success: true,
        content: message.content || 'Sub-agent completed',
      };
    }

    return {
      toolCallId: '',
      name: 'delegate_task',
      success: true,
      content: 'Sub-agent reached max turns',
    };
  } catch (err: any) {
    return {
      toolCallId: '',
      name: 'delegate_task',
      success: false,
      content: '',
      error: `Delegation failed: ${err.message}`,
    };
  }
}

// Role prompts and tool filtering are now centrally defined in agents/roles.ts.