// Tool executor - loads and executes tool implementations

import { ToolContext, ToolResult, ToolCall } from '../types.js';
import { TOOL_IMPLEMENTATIONS, BUILTIN_TOOLS, POWER_TOOLS } from './definitions.js';
import { executeMCPTool } from './mcp/tool-executor.js';

const implementationCache = new Map<string, any>();

async function loadImplementation(modulePath: string): Promise<any> {
  if (implementationCache.has(modulePath)) {
    return implementationCache.get(modulePath);
  }
  try {
    const mod = await import(modulePath);
    implementationCache.set(modulePath, mod);
    return mod;
  } catch (err: any) {
    throw new Error(`Failed to load tool implementation ${modulePath}: ${err.message}`);
  }
}

function validateArgs(toolName: string, args: Record<string, any>): string | null {
  const allTools = [...(BUILTIN_TOOLS || []), ...(POWER_TOOLS || [])];
  const tool = allTools.find(t => t.function.name === toolName);
  if (!tool) return null;

  const schema = tool.function.parameters;
  if (!schema || schema.type !== 'object') return null;

  const required = schema.required || [];
  const missing: string[] = [];

  for (const req of required) {
    if (args[req] === undefined || args[req] === null || args[req] === '') {
      missing.push(req);
    }
  }

  if (missing.length > 0) {
    const props = schema.properties || {};
    let errorMsg = `Tool '${toolName}' call failed validation: missing required parameter(s): ${missing.join(', ')}.\n\n`;
    errorMsg += `Expected Schema:\n`;
    for (const [name, prop] of Object.entries(props)) {
      const isRequired = required.includes(name) ? '(required)' : '(optional)';
      const p = prop as any;
      errorMsg += `- ${name}: ${p.type} ${isRequired} - ${p.description || ''}\n`;
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
    return executeMCPTool(toolName, JSON.parse(toolCall.function.arguments), context);
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
  } catch (err: any) {
    return {
      toolCallId: toolCall.id,
      name: toolName,
      success: false,
      content: '',
      error: `Invalid tool arguments JSON: ${err.message}`,
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
  } catch (err: any) {
    return {
      toolCallId: toolCall.id,
      name: toolName,
      success: false,
      content: '',
      error: `Tool execution failed: ${err.message}`,
    };
  }
}

export async function executeToolCalls(
  toolCalls: ToolCall[],
  context: ToolContext
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  for (const tc of toolCalls) {
    results.push(await executeToolCall(tc, context));
  }
  return results;
}