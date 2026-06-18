// Terminal execution tool

import { spawn, execSync } from 'child_process';
import { ToolContext, ToolResult } from '../../types.js';

export async function execute(args: { command: string; timeout?: number; workdir?: string }, context: ToolContext): Promise<ToolResult> {
  const timeout = args.timeout ?? 180;
  const workdir = args.workdir ?? context.projectRoot;
  const command = args.command;

  return new Promise((resolve) => {
    let output = '';
    let errorOutput = '';
    let exited = false;

    // Cross-platform shell detection: prefer bash, fall back to system shell
    function detectShell(): { shell: string; args: string[] } {
      if (process.platform === 'win32') {
        const bashPaths = ['bash.exe', 'C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'];
        for (const bp of bashPaths) {
          try { execSync(`where "${bp}"`, { stdio: 'ignore' }); return { shell: bp, args: ['-c', command] }; } catch {}
        }
        return { shell: 'cmd.exe', args: ['/c', command] };
      }
      return { shell: '/bin/bash', args: ['-c', command] };
    }

    const { shell, args: shellArgs } = detectShell();

    const child = spawn(shell, shellArgs, {
      cwd: workdir,
      env: { ...process.env },
      shell: false,
    });

    const killTimer = setTimeout(() => {
      if (!exited) {
        exited = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!exited) child.kill('SIGKILL');
        }, 5000);
        resolve({
          toolCallId: '',
          name: 'terminal',
          success: false,
          content: output + errorOutput,
          error: `Command timed out after ${timeout}s`,
        });
      }
    }, timeout * 1000);

    child.stdout?.on('data', (data) => {
      output += data.toString();
    });

    child.stderr?.on('data', (data) => {
      errorOutput += data.toString();
    });

    child.on('error', (err) => {
      if (!exited) {
        exited = true;
        clearTimeout(killTimer);
        resolve({
          toolCallId: '',
          name: 'terminal',
          success: false,
          content: '',
          error: `Failed to start command: ${err.message}`,
        });
      }
    });

    child.on('close', (code) => {
      if (!exited) {
        exited = true;
        clearTimeout(killTimer);
        const fullOutput = output + (errorOutput ? `\n[stderr]\n${errorOutput}` : '');
        resolve({
          toolCallId: '',
          name: 'terminal',
          success: code === 0,
          content: fullOutput || '(no output)',
          error: code !== 0 ? `Exit code: ${code}` : undefined,
        });
      }
    });

    // Handle abort signal
    context.abortSignal?.addEventListener('abort', () => {
      if (!exited) {
        exited = true;
        clearTimeout(killTimer);
        child.kill('SIGTERM');
        resolve({
          toolCallId: '',
          name: 'terminal',
          success: false,
          content: output + errorOutput,
          error: 'Command aborted',
        });
      }
    });
  });
}