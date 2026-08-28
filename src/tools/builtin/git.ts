// Git tools
//
// These run git directly via execFileSync (no interactive shell). Routing git
// through the terminal tool's shell pipeline (cmd.exe detection, detached spawn,
// pager/autocrlf handling) made `git diff` output capture flaky on CI Windows,
// where the shell environment differs from a dev machine. Direct exec is
// deterministic across platforms and avoids the terminal tool's install-gates,
// dev-server blocks, and circuit breakers — none of which apply to read-only
// git inspection.

import { execFileSync } from 'child_process';
import { ToolContext, ToolResult } from '../../types.js';

function runGit(args: string[], context: ToolContext): ToolResult {
  try {
    const stdout = execFileSync('git', args, {
      cwd: context.projectRoot,
      encoding: 'utf8',
      // Never let a pager intercept output, even if core.pager/GIT_PAGER is set.
      env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat' },
      // git exits 1 when there are differences (normal for `diff`); that is not
      // an error for our purposes, so don't throw on non-zero status.
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return {
      toolCallId: '',
      name: 'git',
      success: true,
      content: stdout || '(no output)',
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number; message?: string };
    const out = (e.stdout || '') + (e.stderr || '');
    // A diff with changes exits 1 by design — treat as success with the diff content.
    if (e.status !== undefined && e.status !== 0 && out.trim()) {
      return { toolCallId: '', name: 'git', success: true, content: out };
    }
    return {
      toolCallId: '',
      name: 'git',
      success: false,
      content: out || '',
      error: `git ${args.join(' ')} failed: ${e.message ?? 'unknown error'}`,
    };
  }
}

export async function diff(args: { staged?: boolean; path?: string }, context: ToolContext): Promise<ToolResult> {
  const gitArgs = ['diff'];
  if (args.staged) gitArgs.push('--staged');
  if (args.path) gitArgs.push('--', args.path);
  return runGit(gitArgs, context);
}

export async function status(_args: Record<string, never>, context: ToolContext): Promise<ToolResult> {
  return runGit(['status', '--porcelain'], context);
}
