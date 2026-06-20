import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

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
});
