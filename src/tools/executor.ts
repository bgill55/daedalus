// Tool executor - loads and executes tool implementations

import { ToolContext, ToolResult, ToolCall } from '../types.js';
import { TOOL_IMPLEMENTATIONS, BUILTIN_TOOLS, POWER_TOOLS } from './definitions.js';
import { executeMCPTool } from './mcp/tool-executor.js';

type ModuleNamespace = Record<string, unknown>;

const implementationCache = new Map<string, ModuleNamespace>();

async function loadImplementation(modulePath: string): Promise<ModuleNamespace> {
  const cached = implementationCache.get(modulePath);
  if (cached) {
    return cached;
  }
  try {
    const mod = (await import(modulePath)) as ModuleNamespace;
    implementationCache.set(modulePath, mod);
    return mod;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load tool implementation ${modulePath}: ${message}`);
  }
}

interface JsonSchemaProperty {
  type?: string;
  description?: string;
}

export function normalizeToolArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...args };
  if (['write_file', 'patch', 'edit_file', 'read_file'].includes(toolName)) {
    if (!normalized.path) {
      const altPath = normalized.filepath ?? normalized.file_path ?? normalized.file ?? normalized.target_file ?? normalized.filename;
      if (typeof altPath === 'string' && altPath.trim()) normalized.path = altPath.trim();
    }
    if (!normalized.content && toolName === 'write_file') {
      const altContent = normalized.new_content ?? normalized.file_content ?? normalized.code_content ?? normalized.code ?? normalized.newcontent;
      if (typeof altContent === 'string') normalized.content = altContent;
    }
  }
  return normalized;
}

function validateArgs(toolName: string, args: Record<string, unknown>): string | null {
  const allTools = [...(BUILTIN_TOOLS || []), ...(POWER_TOOLS || [])];
  const tool = allTools.find(t => t.function.name === toolName);
  if (!tool) return null;

  const schema = tool.function.parameters;
  if (!schema || schema.type !== 'object') return null;

  const required = schema.required || [];
  const missing: string[] = [];

  for (const req of required) {
    const value = args[req];
    if (value === undefined || value === null || value === '') {
      missing.push(req);
    }
  }

  if (missing.length > 0) {
    const props = schema.properties || {};
    let errorMsg = `Tool '${toolName}' call failed validation: missing required parameter(s): ${missing.join(', ')}.\n\n`;
    errorMsg += `Expected Schema:\n`;
    for (const [name, prop] of Object.entries(props)) {
      const isRequired = required.includes(name) ? '(required)' : '(optional)';
      const p = prop as JsonSchemaProperty;
      errorMsg += `- ${name}: ${p.type ?? 'unknown'} ${isRequired} - ${p.description || ''}\n`;
    }
    return errorMsg;
  }

  return null;
}

export async function executeToolCall(
  toolCall: ToolCall,
  context: ToolContext
): Promise<ToolResult> {
  const toolName = toolCall.function.name;

  // Handle MCP tools (prefixed with mcp_)
  if (toolName.startsWith('mcp_')) {
    return executeMCPTool(toolName, JSON.parse(toolCall.function.arguments), context, toolCall.id);
  }

  const implPath = TOOL_IMPLEMENTATIONS[toolName];

  if (!implPath) {
    return {
      toolCallId: toolCall.id,
      name: toolName,
      success: false,
      content: '',
      error: `Unknown tool: ${toolName}`,
    };
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(toolCall.function.arguments);
    args = normalizeToolArgs(toolName, args);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      toolCallId: toolCall.id,
      name: toolName,
      success: false,
      content: '',
      error: `Invalid tool arguments JSON: ${message}`,
    };
  }

  const validationError = validateArgs(toolName, args);
  if (validationError) {
    return {
      toolCallId: toolCall.id,
      name: toolName,
      success: false,
      content: '',
      error: validationError,
    };
  }

  const lastDot = implPath.lastIndexOf('.');
  const moduleName = lastDot === -1 ? implPath : implPath.substring(0, lastDot);
  const functionName = lastDot === -1 ? '' : implPath.substring(lastDot + 1);

  // Convert 'tools/builtin/files' to './builtin/files.js'
  let relativePath = moduleName;
  if (relativePath.startsWith('tools/')) {
    relativePath = './' + relativePath.substring(6) + '.js';
  } else if (!relativePath.startsWith('.') && !relativePath.startsWith('/')) {
    relativePath = './' + relativePath + '.js';
  }

  try {
    const mod = await loadImplementation(relativePath);
    // Find the exported function
    const fn = (functionName ? mod[functionName] : null) ?? mod.default ?? mod[toolName] ?? Object.values(mod)[0];
    if (typeof fn !== 'function') {
      throw new Error(`No executable function found in ${relativePath}`);
    }

    const result = await fn(args, context);
    return {
      ...result,
      toolCallId: toolCall.id,
      name: toolName,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      toolCallId: toolCall.id,
      name: toolName,
      success: false,
      content: '',
      error: `Tool execution failed: ${message}`,
    };
  }
}

export async function executeToolCalls(
  toolCalls: ToolCall[],
  context: ToolContext
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  let mutatingFailed = false;
  for (const tc of toolCalls) {
    const name = tc.function.name;
    // If a file-mutating tool already failed in this batch, skip subsequent
    // file-mutating or build/test (terminal) calls — running them would operate
    // on a broken/incomplete state and waste the global failure budget.
    if (mutatingFailed && (name === 'patch' || name === 'write_file' || name === 'terminal')) {
      results.push({
        toolCallId: tc.id,
        name,
        success: false,
        content: '',
        error: '[SKIPPED] Skipped because a prior file-mutation tool in this batch failed.',
      });
      continue;
    }
    const result = await executeToolCall(tc, context);
    if ((name === 'patch' || name === 'write_file') && !result.success) {
      mutatingFailed = true;
    }
    results.push(result);
  }
  return results;
}