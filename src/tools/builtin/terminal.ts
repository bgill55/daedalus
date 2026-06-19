// Terminal execution tool

import { spawn, execSync } from 'child_process';
import { ToolContext, ToolResult } from '../../types.js';

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

let cachedShell: { shell: string; isBash: boolean } | null = null;

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
        if (!cachedShell) {
          const bashPaths = ['bash.exe', 'C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'];
          let detected = 'cmd.exe';
          let isBash = false;
          for (const bp of bashPaths) {
            try {
              execSync(`where "${bp}"`, { stdio: 'ignore' });
              detected = bp;
              isBash = true;
              break;
            } catch {}
          }
          cachedShell = { shell: detected, isBash };
        }
        return { shell: cachedShell.shell, args: cachedShell.isBash ? ['-c', command] : ['/c', command] };
      }
      return { shell: '/bin/bash', args: ['-c', command] };
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