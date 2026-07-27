import { getSystemDiagnostics } from '../../config/systemInfo.js';
import type { ToolContext, ToolResult } from '../../types.js';

export async function systemInfo(_args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
  const diag = getSystemDiagnostics();
  return {
    toolCallId: '',
    name: 'system_info',
    success: true,
    content: JSON.stringify(diag, null, 2),
  };
}
