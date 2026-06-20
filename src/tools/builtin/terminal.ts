// Terminal execution tool

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ToolContext, ToolResult } from '../../types.js';
import { loadConfig } from '../../config/index.js';

const SENSITIVE_ENV_KEYS = new Set([
  'AWS_SECRET_ACCESS_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SESSION_TOKEN',
  'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID',
  'GITHUB_TOKEN', 'GIT_TOKEN', 'NPM_TOKEN',
  'DATABASE_URL', 'DB_URL', 'MONGODB_URI', 'MYSQL_URL', 'PGURL',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY',
  'HF_TOKEN', 'HUGGINGFACE_TOKEN',
]);

const BLOCKED_ENV_KEYS = new Set([
  'NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES',
]);

function sanitizeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (BLOCKED_ENV_KEYS.has(key)) continue;
    if (SENSITIVE_ENV_KEYS.has(key)) continue;
    env[key] = value;
  }
  return env;
}

interface ShellConfig {
  shell: string;
  type: 'bash' | 'cmd' | 'powershell';
}

function getShellType(shellPath: string): 'bash' | 'cmd' | 'powershell' {
  const lower = shellPath.toLowerCase();
  if (lower.includes('powershell') || lower.includes('pwsh')) {
    return 'powershell';
  }
  if (lower.includes('cmd.exe') || lower.endsWith('cmd')) {
    return 'cmd';
  }
  return 'bash';
}

function getShellArgs(type: 'bash' | 'cmd' | 'powershell', command: string): string[] {
  switch (type) {
    case 'powershell':
      return ['-NoProfile', '-Command', command];
    case 'cmd':
      return ['/c', command];
    case 'bash':
    default:
      return ['-c', command];
  }
}

export const state: { cachedShell: ShellConfig | null } = {
  cachedShell: null,
};

export function resetCachedShell(): void {
  state.cachedShell = null;
}

export async function execute(args: { command: string; timeout?: number; workdir?: string }, context: ToolContext): Promise<ToolResult> {
  const timeout = args.timeout ?? 180;
  const workdir = args.workdir ?? context.projectRoot;
  const command = args.command;

  return new Promise((resolve) => {
    let output = '';
    let errorOutput = '';
    let exited = false;

    function detectShell(): { shell: string; args: string[] } {
      if (!state.cachedShell) {
        const envShell = process.env.DAEDALUS_SHELL || process.env.SHELL;
        if (envShell) {
          state.cachedShell = { shell: envShell, type: getShellType(envShell) };
        } else {
          let configShell: string | undefined;
          try {
            const config = loadConfig();
            configShell = config.tools?.shell;
          } catch {
            // Ignore config load errors
          }

          if (configShell) {
            state.cachedShell = { shell: configShell, type: getShellType(configShell) };
          } else if (process.platform === 'win32') {
            let detected = 'cmd.exe';
            let type: 'bash' | 'cmd' | 'powershell' = 'cmd';
            try {
              execSync('where bash.exe', { stdio: 'ignore' });
              detected = 'bash.exe';
              type = 'bash';
            } catch {
              const fallbacks = [
                'C:\\Program Files\\Git\\bin\\bash.exe',
                'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
                path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
                path.join(process.env.SYSTEMDRIVE || 'C:', 'tools', 'git', 'bin', 'bash.exe'),
              ];
              for (const fp of fallbacks) {
                if (fs.existsSync(fp)) {
                  detected = fp;
                  type = 'bash';
                  break;
                }
              }
            }
            state.cachedShell = { shell: detected, type };
          } else {
            state.cachedShell = { shell: '/bin/bash', type: 'bash' };
          }
        }
      }

      const active = state.cachedShell!;
      return { shell: active.shell, args: getShellArgs(active.type, command) };
    }

    const { shell, args: shellArgs } = detectShell();

    const child = spawn(shell, shellArgs, {
      cwd: workdir,
      env: sanitizeEnv(),
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