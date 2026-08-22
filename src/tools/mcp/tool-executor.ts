// MCP tool executor - bridges LLM tool calls to MCP servers

import path from 'node:path';
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

export async function executeMCPTool(prefixedName: string, args: Record<string, unknown>, context: ToolContext, toolCallId: string): Promise<ToolResult> {
  try {
    const resolvedArgs = resolveMcpFilePaths(args, context);
    const result = await mcpRegistry.callTool(prefixedName, resolvedArgs);
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

// MCP filesystem servers fail hard on a relative or wrong-root path (e.g. the model
// emitting "C:\src\server.ts" when the project is at D:\prompt-vault\src\server.ts,
// or a bare "src/server.ts"). Best-effort: if a file-path arg is relative, resolve it
// against the session's projectRoot so it lands on a real file. Absolute paths and
// non-path args pass through untouched. This is defense-in-depth on top of the system
// prompt stating the real Working Directory — it cannot fix a model that picks a
// completely wrong drive, but it converts the common relative-path case into a hit.
const MCP_PATH_ARG_KEYS = ['path', 'filepath', 'file_path', 'filePath', 'target', 'source', 'destination'];

function resolveMcpFilePaths(args: Record<string, unknown>, context: ToolContext): Record<string, unknown> {
  const root = context?.projectRoot;
  if (!root || typeof root !== 'string') return args;
  const out: Record<string, unknown> = { ...args };
  for (const key of MCP_PATH_ARG_KEYS) {
    const val = args[key];
    if (typeof val !== 'string' || val.trim() === '') continue;
    if (path.isAbsolute(val)) continue; // already rooted — leave it to the server
    const resolved = path.resolve(root, val);
    if (resolved !== val) out[key] = resolved;
  }
  return out;
}

