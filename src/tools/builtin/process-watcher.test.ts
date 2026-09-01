import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ToolContext } from '../../types.js';

vi.mock('child_process', async () => {
  const EventEmitter = (await import('events')).EventEmitter;

  const makeFakeProc = (pid: number) => {
    const proc = new EventEmitter() as any;
    proc.pid = pid;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = null;
    proc.kill = vi.fn(() => {
      setTimeout(() => proc.emit('exit', 0), 5);
    });
    return proc;
  };

  let pidCounter = 1000;
  return {
    spawn: vi.fn(() => makeFakeProc(pidCounter++)),
    execSync: vi.fn(),
  };
});

import { watchProcess, readProcess, killProcess, killAllWatchedProcesses } from './process-watcher.js';

describe('Process watcher tools', () => {
  let context: ToolContext;

  beforeEach(() => {
    context = {
      projectRoot: process.cwd(),
      sessionId: 'test',
    } as ToolContext;
  });

  afterEach(() => {
    killAllWatchedProcesses();
    vi.restoreAllMocks();
  });

  it('watchProcess starts and returns an id', async () => {
    const result = await watchProcess({ command: 'node -e "setTimeout(()=>{},100)"' }, context);
    expect(result.success).toBe(true);
    expect(result.content).toContain('proc_');
  });

  it('readProcess returns error for nonexistent id', async () => {
    const result = await readProcess({ id: 'proc_nonexistent' }, context);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No watched process');
  });

  it('killProcess returns error for nonexistent id', async () => {
    const result = await killProcess({ id: 'proc_nonexistent' }, context);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No watched process');
  });

  it('readProcess returns buffered output from a running process', async () => {
    const startResult = await watchProcess({ command: 'node -e "console.log(\'hello from proc\')"' }, context);
    const idMatch = startResult.content.match(/proc_\d+/);
    expect(idMatch).not.toBeNull();
    const id = idMatch![0];

    const { spawn } = await import('child_process');
    const fakeProc = (spawn as any).mock.results.at(-1).value;
    fakeProc.stdout.emit('data', Buffer.from('hello from proc\n'));

    const readResult = await readProcess({ id }, context);
    expect(readResult.success).toBe(true);
    expect(readResult.content).toContain('hello from proc');
  });

  it('killProcess terminates a running process', async () => {
    const startResult = await watchProcess({ command: 'node -e "setTimeout(()=>{},100)"' }, context);
    const idMatch = startResult.content.match(/proc_\d+/);
    expect(idMatch).not.toBeNull();

    const killResult = await killProcess({ id: idMatch![0] }, context);
    expect(killResult.success).toBe(true);
    expect(killResult.content).toContain('killed');
  });

  it('killAllWatchedProcesses cleans up all processes', async () => {
    await watchProcess({ command: 'node -e "setTimeout(()=>{},100)"' }, context);
    await watchProcess({ command: 'node -e "setTimeout(()=>{},100)"' }, context);
    expect(() => killAllWatchedProcesses()).not.toThrow();
  });

});
