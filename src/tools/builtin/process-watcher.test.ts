import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { watchProcess, readProcess, killProcess, killAllWatchedProcesses } from './process-watcher.js';
import type { ToolContext } from '../../types.js';

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
    const result = await watchProcess({ command: process.execPath + ' -e "setTimeout(() => {}, 10000)"' }, context);
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

  it('readProcess returns output from running process', async () => {
    const startResult = await watchProcess({ command: process.execPath + ' -e "console.log(\'hello from proc\'); setTimeout(()=>{},5000)"' }, context);
    const idMatch = startResult.content.match(/proc_\d+/);
    expect(idMatch).not.toBeNull();

    await new Promise(r => setTimeout(r, 300));

    const readResult = await readProcess({ id: idMatch![0] }, context);
    expect(readResult.success).toBe(true);
    expect(readResult.content).toContain('hello from proc');
  });

  it('killProcess terminates a running process', async () => {
    const startResult = await watchProcess({ command: process.execPath + ' -e "setTimeout(() => {}, 60000)"' }, context);
    const idMatch = startResult.content.match(/proc_\d+/);
    expect(idMatch).not.toBeNull();

    const killResult = await killProcess({ id: idMatch![0] }, context);
    expect(killResult.success).toBe(true);
    expect(killResult.content).toContain('killed');
  });

  it('killAllWatchedProcesses cleans up all processes', async () => {
    await watchProcess({ command: process.execPath + ' -e "setTimeout(() => {}, 60000)"' }, context);
    await watchProcess({ command: process.execPath + ' -e "setTimeout(() => {}, 60000)"' }, context);

    expect(() => killAllWatchedProcesses()).not.toThrow();
  });

});
