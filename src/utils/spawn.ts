// Centralized, crash-hardened process spawning.
//
// Spawning children directly (execSync / spawn) inherits the parent's stdin pipe
// and process group. When Daedalus runs non-interactively (a piped task whose
// stdin hits EOF) or receives a console/Ctrl-C, the signal can propagate into the
// child tree and kill it with 0xC0000142 / STATUS_CONTROL_C_EXIT on Windows.
//
// The terminal tool already applied this fix (stdio ignore + win32 detached).
// These helpers centralize the same hardening so EVERY spawn site in the codebase
// gets it, not just the terminal tool. See docs/windows-terminal-crash-fix.md.

import { spawn, execSync } from 'child_process';
import type { SpawnOptions, ExecSyncOptions, ExecSyncOptionsWithStringEncoding } from 'child_process';

/**
 * Spawn a child with stdin ignored and (on Windows) in its own detached process
 * group, so a closed parent stdin pipe or a Ctrl-C aimed at the parent cannot kill
 * the child tree. Mirrors the terminal tool's hardened spawn options.
 */
export function spawnDetached(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): import('child_process').ChildProcess {
  return spawn(command, args, {
    ...options,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    detached: options.detached ?? (process.platform === 'win32'),
    windowsHide: options.windowsHide ?? true,
  });
}

/**
 * Run a synchronous command with stdin ignored, preventing EOF/Ctrl-C propagation
 * from the parent into the child. Preserves stdout/stderr capture (stdio
 * ['ignore', 'pipe', 'pipe']), so callers that read the return value still work.
 */
export function execSafe(command: string, options: ExecSyncOptionsWithStringEncoding): string;
export function execSafe(command: string, options?: ExecSyncOptions): string | Buffer;
export function execSafe(command: string, options: ExecSyncOptions = {}): string | Buffer {
  return execSync(command, {
    ...options,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    windowsHide: options.windowsHide ?? true,
  });
}
