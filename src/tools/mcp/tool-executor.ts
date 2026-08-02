// MCP tool executor - bridges LLM tool calls to MCP servers

import { ToolContext, ToolResult } from '../../types.js';
import { mcpRegistry } from './registry.js';

function unwrapMcpContent(result: unknown): string {
  if (result && typeof result === 'object' && Array.isArray((result as { content?: unknown[] }).content)) {
    const parts = (result as { content: { text?: unknown }[] }).content
      .filter((c) => typeof c?.text === 'string')
      .map((c) => c.text as string);
    if (parts.length > 0) return parts.join('\n');
  }
  if (typeof result === 'string') return result;
  return JSON.stringify(result, null, 2);
}

export async function executeMCPTool(prefixedName: string, args: Record<string, unknown>, _context: ToolContext, toolCallId: string): Promise<ToolResult> {
  try {
    const result = await mcpRegistry.callTool(prefixedName, args);
    return {
      toolCallId,
      name: prefixedName,
      success: true,
      content: unwrapMcpContent(result),
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      toolCallId,
      name: prefixedName,
      success: false,
      content: '',
      error: `MCP tool error: ${errorMessage}`,
    };
  }
}

