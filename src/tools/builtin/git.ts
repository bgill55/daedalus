// Git tools

import { ToolContext, ToolResult } from '../../types.js';
import { execute } from './terminal.js';

export async function diff(args: { staged?: boolean; path?: string }, context: ToolContext): Promise<ToolResult> {
  const staged = args.staged ? '--staged' : '';
  const pathArg = args.path ? ` -- ${args.path}` : '';
  return execute({ command: `git diff ${staged}${pathArg}`, timeout: 30, workdir: context.projectRoot }, context);
}

export async function status(args: Record<string, never>, context: ToolContext): Promise<ToolResult> {
  return execute({ command: 'git status --porcelain', timeout: 10, workdir: context.projectRoot }, context);
}