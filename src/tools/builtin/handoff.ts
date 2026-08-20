import { ToolDefinition, ToolResult, ToolContext } from '../../types.js';

export const VALID_AGENT_ROLES = ['planner', 'coder', 'reviewer', 'debugger', 'researcher'] as const;
export type AgentRole = typeof VALID_AGENT_ROLES[number];

export const handoffTaskToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'handoff_task',
    description: 'Dynamically hand off the active execution turn to another specialized sub-agent role (planner, coder, reviewer, debugger, researcher) with notes and shared context updates.',
    parameters: {
      type: 'object',
      properties: {
        target_role: {
          type: 'string',
          description: 'The target sub-agent role to transfer control to (planner, coder, reviewer, debugger, researcher).',
        },
        handoff_notes: {
          type: 'string',
          description: 'Summary of work accomplished and specific instructions for the next agent role.',
        },
        context_updates: {
          type: 'object',
          description: 'Optional key-value pairs to store in shared contextVariables for subsequent agent turns.',
        },
      },
      required: ['target_role', 'handoff_notes'],
      additionalProperties: false,
    },
  },
};

export const setContextVariableToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'set_context_variable',
    description: 'Set a key-value pair in the shared contextVariables state bag to persist structured metadata across agent turns and handoffs.',
    parameters: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'The state variable key name (e.g. target_files, test_status, pr_number).',
        },
        value: {
          description: 'The value to store (string, number, boolean, array, or object).',
        },
      },
      required: ['key', 'value'],
    },
  },
};

export async function handoffTask(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const targetRole = String(args.target_role || '').trim().toLowerCase();
  const handoffNotes = String(args.handoff_notes || '').trim();
  const contextUpdates = args.context_updates as Record<string, unknown> | undefined;

  if (!VALID_AGENT_ROLES.includes(targetRole as AgentRole)) {
    return {
      toolCallId: '',
      name: 'handoff_task',
      success: false,
      content: `Invalid target_role: "${targetRole}". Must be one of: ${VALID_AGENT_ROLES.join(', ')}`,
      error: `Invalid target_role: "${targetRole}"`,
    };
  }

  // Update active agent role in tool context
  context.agentRole = targetRole;

  // Initialize and merge context variables
  if (!context.contextVariables) {
    context.contextVariables = {};
  }

  if (contextUpdates && typeof contextUpdates === 'object') {
    Object.assign(context.contextVariables, contextUpdates);
  }

  return {
    toolCallId: '',
    name: 'handoff_task',
    success: true,
    content: `[HANDOFF] Successfully transferred control to the ${targetRole} agent.\nNotes: ${handoffNotes}\nUpdated contextVariables: ${JSON.stringify(context.contextVariables)}`,
  };
}

export async function setContextVariable(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const key = String(args.key || '').trim();
  if (!key) {
    return {
      toolCallId: '',
      name: 'set_context_variable',
      success: false,
      content: 'Missing required parameter: key',
      error: 'Missing required parameter: key',
    };
  }

  if (!context.contextVariables) {
    context.contextVariables = {};
  }

  context.contextVariables[key] = args.value;

  return {
    toolCallId: '',
    name: 'set_context_variable',
    success: true,
    content: `[CONTEXT] Set context variable "${key}" = ${JSON.stringify(args.value)}`,
  };
}
