import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import fs from 'fs';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
  },
}));

vi.mock('../../config/index.js', () => ({
  loadConfig: vi.fn(),
}));

import { spawn, execSync } from 'child_process';
import { execute, resetCachedShell } from './terminal.js';
import { loadConfig } from '../../config/index.js';
import type { ToolContext } from '../../types.js';

const originalPlatform = process.platform;
const originalEnvShell = process.env.SHELL;
const originalEnvDaedalusShell = process.env.DAEDALUS_SHELL;

function makeMockProcess() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as any;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = { write: vi.fn(), end: vi.fn(), writable: true };
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

function makeContext(): ToolContext {
  return { projectRoot: '/tmp/test', name: '' } as unknown as ToolContext;
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  vi.clearAllMocks();
  resetCachedShell();
  (loadConfig as any).mockReturnValue({
    tools: {}
  });
  delete process.env.DAEDALUS_SHELL;
  delete process.env.SHELL;
  delete process.env.DAEDALUS_ALLOW_INSTALL;
  delete process.env.DAEDALUS_AUTO_APPROVE;
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  if (originalEnvShell !== undefined) {
    process.env.SHELL = originalEnvShell;
  } else {
    delete process.env.SHELL;
  }
  if (originalEnvDaedalusShell !== undefined) {
    process.env.DAEDALUS_SHELL = originalEnvDaedalusShell;
  } else {
    delete process.env.DAEDALUS_SHELL;
  }
  delete process.env.DAEDALUS_ALLOW_INSTALL;
  delete process.env.DAEDALUS_AUTO_APPROVE;
  (execSync as any).mockReset();
  (fs as any).existsSync.mockReset();
});

describe('terminal execute', () => {
  it('executes command successfully', async () => {
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'echo hello' }, makeContext());

    mockProc.stdout.emit('data', Buffer.from('hello\n'));
    mockProc.emit('close', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.content).toBe('hello\n');
    expect(spawn).toHaveBeenCalledWith('/bin/bash', ['-c', 'echo hello'], expect.any(Object));
  });

  it('spawns the child with stdin ignored and (on Windows) a detached process group', async () => {
    // Regression guard for the intermittent 0xC0000142 / STATUS_CONTROL_C_EXIT
    // terminal crashes: the child must not inherit the parent's stdin pipe (so a
    // closed piped task can't deliver EOF/Ctrl-C) and, on Windows, must run in its
    // own process group so a console signal aimed at the parent doesn't kill the
    // spawned npm -> tsc tree.
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'npm run build' }, makeContext());
    mockProc.emit('close', 0);
    await resultPromise;

    const opts = (spawn as any).mock.calls[0][2];
    expect(opts.stdio[0]).toBe('ignore');
    expect(opts.stdio[1]).toBe('pipe');
    expect(opts.stdio[2]).toBe('pipe');
    expect(opts.detached).toBe(process.platform === 'win32');
    expect(opts.shell).toBe(false);
  });

  it('reports failure on non-zero exit', async () => {
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'false' }, makeContext());

    mockProc.stderr.emit('data', Buffer.from('error\n'));
    mockProc.emit('close', 1);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('Exit code: 1');
    expect(result.content).toContain('[stderr]');
    expect(result.content).toContain('error');
  });

  it('handles command timeout', async () => {
    vi.useFakeTimers();
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'sleep', timeout: 1 }, makeContext());
    vi.advanceTimersByTime(1000);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });

  it('handles abort signal', async () => {
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);
    const ac = new AbortController();

    const resultPromise = execute({ command: 'long-running' }, { ...makeContext(), abortSignal: ac.signal });

    ac.abort();

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('aborted');
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('handles spawn failure', async () => {
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'nonexistent' }, makeContext());
    mockProc.emit('error', new Error('ENOENT'));

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to start');
  });

  it('uses cmd.exe on Windows when no bash found', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    (execSync as any).mockImplementation(() => { throw new Error('not found'); });
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'dir' }, makeContext());
    mockProc.emit('close', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(spawn).toHaveBeenCalled();
    const shell = (spawn as any).mock.calls[0][0];
    expect(shell).toBe('cmd.exe');
  });

  it('prefers shell specified in DAEDALUS_SHELL environment variable', async () => {
    process.env.DAEDALUS_SHELL = 'powershell.exe';
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'Get-Process' }, makeContext());
    mockProc.emit('close', 0);
    await resultPromise;

    expect(spawn).toHaveBeenCalledWith('powershell.exe', ['-NoProfile', '-Command', 'Get-Process'], expect.any(Object));
  });

  it('prefers shell specified in SHELL environment variable', async () => {
    process.env.SHELL = '/bin/zsh';
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'echo hello' }, makeContext());
    mockProc.emit('close', 0);
    await resultPromise;

    expect(spawn).toHaveBeenCalledWith('/bin/zsh', ['-c', 'echo hello'], expect.any(Object));
  });

  it('prefers shell specified in tools.shell configuration option', async () => {
    (loadConfig as any).mockReturnValue({
      tools: {
        shell: 'pwsh'
      }
    });
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'Get-ChildItem' }, makeContext());
    mockProc.emit('close', 0);
    await resultPromise;

    expect(spawn).toHaveBeenCalledWith('pwsh', ['-NoProfile', '-Command', 'Get-ChildItem'], expect.any(Object));
  });

  it('uses Docker sandbox when configured', async () => {
    (loadConfig as any).mockReturnValue({
      tools: {
        sandbox: 'docker',
        sandboxImage: 'custom-node:18',
      }
    });
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'echo hello' }, makeContext());
    mockProc.emit('close', 0);
    await resultPromise;

    expect(spawn).toHaveBeenCalledWith(
      'docker',
      [
        'run',
        '-i',
        '--rm',
        '-v',
        '/tmp/test:/workspace',
        '-w',
        '/workspace',
        'custom-node:18',
        'sh',
        '-c',
        'echo hello',
      ],
      expect.any(Object)
    );
  });

  it('uses WSL sandbox when configured on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    (loadConfig as any).mockReturnValue({
      tools: {
        sandbox: 'wsl',
        wslDistribution: 'Ubuntu',
      }
    });
    (execSync as any).mockReturnValue('/mnt/tmp/test');

    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'echo hello' }, makeContext());
    mockProc.emit('close', 0);
    await resultPromise;

    expect(spawn).toHaveBeenCalledWith(
      'wsl',
      ['-d', 'Ubuntu', '--cd', '/mnt/tmp/test', '--', 'sh', '-c', 'echo hello'],
      expect.any(Object)
    );
  });

  it('warns when npx references a non-dependency package', async () => {
    process.env.DAEDALUS_ALLOW_INSTALL = 'true';
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'npx eslint .' }, makeContext());
    mockProc.emit('close', 0);
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.content).toContain("[WARN] 'eslint' is not a declared dependency");
    expect(result.content).toContain("npm install --save-dev eslint");
  });

  it('does not warn when npx references a declared dependency', async () => {
    process.env.DAEDALUS_ALLOW_INSTALL = 'true';
    const mockFs = (await import('fs')).default as any;
    mockFs.existsSync.mockImplementation((p: string) => String(p).endsWith('package.json'));
    mockFs.readFileSync = () => JSON.stringify({ dependencies: { eslint: '^9.0.0' } });
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'npx eslint .' }, makeContext());
    mockProc.emit('close', 0);
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.content).not.toContain("[WARN] 'eslint' is not a declared dependency");
  });

  it('appends a checkpoint note for install commands in a git repo', async () => {
    process.env.DAEDALUS_ALLOW_INSTALL = 'true';
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    const realFs = await vi.importActual<typeof import('fs')>('fs');
    const realCp = await vi.importActual<typeof import('child_process')>('child_process');
    const tmpDir = realFs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-terminal-checkpoint-'));
    try {
      realCp.execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
      realCp.execSync('git config user.email test@daedalus.local', { cwd: tmpDir, stdio: 'ignore' });
      realCp.execSync('git config user.name "Daedalus Test"', { cwd: tmpDir, stdio: 'ignore' });
      realCp.execSync('git config core.autocrlf false', { cwd: tmpDir, stdio: 'ignore' });
      realFs.writeFileSync(path.join(tmpDir, 'a.txt'), 'v1\n');
      realCp.execSync('git add .', { cwd: tmpDir, stdio: 'ignore' });
      realCp.execSync('git commit -m init', { cwd: tmpDir, stdio: 'ignore' });
      realFs.writeFileSync(path.join(tmpDir, 'a.txt'), 'v2\n');

      (execSync as any).mockImplementation((cmd: string, opts?: any) => {
        if (cmd.startsWith('git ')) return realCp.execSync(cmd, opts);
        throw new Error('mocked execSync');
      });

      const mockProc = makeMockProcess();
      (spawn as any).mockReturnValue(mockProc);

      const ctx = { ...makeContext(), projectRoot: tmpDir };
      const resultPromise = execute({ command: 'npm install lodash', workdir: tmpDir }, ctx);
      mockProc.emit('close', 0);
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.content).toContain('[CHECKPOINT] Git snapshot created before install:');
      expect(result.content).toContain('roll back with: git checkout');
    } finally {
      delete process.env.DAEDALUS_ALLOW_INSTALL;
      realFs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
