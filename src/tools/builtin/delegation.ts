// Delegation tool for spawning sub-agents

import { ToolContext, ToolResult } from '../../types.js';
import { BUILTIN_TOOLS } from '../definitions.js';
import { executeToolCalls } from '../executor.js';
import { getAgentRole, filterToolsForRole } from '../../agents/roles.js';

import type { ChatMessage, ToolCall } from '../../types.js';
import type { ChatRequest, ChatResponse } from '../../router/types.js';
import { maskSecrets } from '../../security/secret-detector.js';
import { messageText } from '../../types.js';

interface LocalRouter {
  chat: {
    completions: {
      create(params: ChatRequest): Promise<ChatResponse>;
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
    const currentDateStr = new Date().toLocaleString();
    const dynamicSystemPrompt = `${agentRole.systemPrompt}\n\n## CURRENT TIME\nThe current date and local time is: ${currentDateStr}.\n`;
    const messages: ChatMessage[] = [
      { role: 'system', content: dynamicSystemPrompt },
      { role: 'user', content: `${args.context ?? ''}\n\nTask: ${args.goal}` },
    ];

    const tools = filterToolsForRole(BUILTIN_TOOLS, role);
    let turns = 0;
    const maxTurns = 10;

    while (turns < maxTurns) {
      const completion = await routerClient.chat.completions.create({
        model: 'auto',
        complexity: 'complex',
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
          message.tool_calls.map((tc: ToolCall) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
          subContext
        );

        for (const result of results) {
          messages.push({
            role: 'tool',
            content: maskSecrets(result.content),
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
        content: messageText(message.content) || 'Sub-agent completed',
      };
    }

    return {
      toolCallId: '',
      name: 'delegate_task',
      success: true,
      content: 'Sub-agent reached max turns',
    };
  } catch (err) {
    return {
      toolCallId: '',
      name: 'delegate_task',
      success: false,
      content: '',
      error: `Delegation failed: ${(err instanceof Error ? err.message : String(err))}`,
    };
  }
}

// Role prompts and tool filtering are now centrally defined in agents/roles.ts.