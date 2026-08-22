import os from 'node:os';
import path from 'node:path';

export interface SystemDiagnostics {
  platform: string;
  osName: string;
  arch: string;
  shell: string;
  cpus: number;
  totalMemoryGB: number;
  freeMemoryGB: number;
  pathSeparator: string;
}

export function detectShell(platform: string): string {
  if (platform === 'win32') {
    return process.env.PSModulePath || process.env.PWSH ? 'powershell' : 'cmd';
  }
  const envShell = process.env.SHELL;
  if (envShell) {
    const base = path.basename(envShell);
    return base.endsWith('.exe') ? base.slice(0, -4) : base;
  }
  return platform === 'darwin' ? 'zsh' : 'bash';
}

export function resolveOsName(platform: string, release: string): string {
  if (platform === 'win32') {
    return `Windows (${release})`;
  }
  if (platform === 'darwin') {
    return `macOS (${release})`;
  }
  if (platform === 'linux') {
    return `Linux (${release})`;
  }
  return `${platform} (${release})`;
}

export function getSystemDiagnostics(): SystemDiagnostics {
  const platform = os.platform();
  const release = os.release();
  const arch = os.arch();
  const cpus = os.cpus()?.length || 1;
  const totalMemoryGB = Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 10) / 10;
  const freeMemoryGB = Math.round((os.freemem() / (1024 * 1024 * 1024)) * 10) / 10;
  const shell = detectShell(platform);
  const osName = resolveOsName(platform, release);

  return {
    platform,
    osName,
    arch,
    shell,
    cpus,
    totalMemoryGB,
    freeMemoryGB,
    pathSeparator: path.sep,
  };
}

export function getSystemPromptHeader(): string {
  const diag = getSystemDiagnostics();
  const cwd = process.cwd();
  return `[System Diagnostics] OS: ${diag.osName} (${diag.platform}, ${diag.arch}) | Shell: ${diag.shell} | Path Sep: '${diag.pathSeparator}' | CPUs: ${diag.cpus} | RAM: ${diag.totalMemoryGB} GB (${diag.freeMemoryGB} GB free) | Working Directory: ${cwd}`;
}
