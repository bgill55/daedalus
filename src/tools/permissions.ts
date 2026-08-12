import { ToolContext } from '../types.js';

export interface ToolPermissionPolicy {
  terminal: 'auto' | 'ask';
  files: 'auto' | 'ask';
}

export function checkToolPermission(
  toolName: string,
  policy?: Partial<ToolPermissionPolicy>,
  _context?: ToolContext
): { allowed: boolean; reason?: string } {
  const terminalPolicy = policy?.terminal || 'auto';
  const filesPolicy = policy?.files || 'auto';

  if (toolName === 'terminal' && terminalPolicy === 'ask') {
    return {
      allowed: false,
      reason: '[PERMISSION DENIED] Execution of terminal command requires user confirmation under current tool permissions policy.',
    };
  }

  if ((toolName === 'write_file' || toolName === 'patch') && filesPolicy === 'ask') {
    return {
      allowed: false,
      reason: '[PERMISSION DENIED] File modification requires user confirmation under current tool permissions policy.',
    };
  }

  return { allowed: true };
}
