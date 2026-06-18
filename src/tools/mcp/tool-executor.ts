// MCP tool executor - bridges LLM tool calls to MCP servers

import { ToolContext, ToolResult } from '../../types.js';
import { mcpRegistry } from './registry.js';

export async function executeMCPTool(prefixedName: string, args: any, context: ToolContext): Promise<ToolResult> {
  try {
    const result = await mcpRegistry.callTool(prefixedName, args);
    return {
      toolCallId: '',
      name: prefixedName,
      success: true,
      content: JSON.stringify(result, null, 2),
    };
  } catch (err: any) {
    return {
      toolCallId: '',
      name: prefixedName,
      success: false,
      content: '',
      error: `MCP tool error: ${err.message}`,
    };
  }
}

