import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { marathonCommand } from './marathon.js';
import { initMarathonRun } from '../marathon/state.js';
import { CommandContext } from './types.js';

describe('/marathon slash command', () => {
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-marathon-cmd-test-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  });

  function createMockContext(): CommandContext {
    return {
      router: {} as any,
      messages: [],
      toolContext: {
        sessionId: 'test-session',
        projectRoot: tmpDir,
        projectHash: 'hash-test',
        activeFiles: new Map(),
        agentRole: 'orchestrator',
        abortSignal: new AbortController().signal,
      },
      sessionManager: {} as any,
      config: {} as any,
    } as unknown as CommandContext;
  }

  it('reports no active run when status called on empty repo', async () => {
    const ctx = createMockContext();
    await marathonCommand.execute('status', ctx);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No active marathon run found'));
  });

  it('prints visual roadmap when status is called on an active run', async () => {
    const ctx = createMockContext();
    initMarathonRun(tmpDir, 'Build Tetris Game', 'main', [
      {
        id: 'm-1',
        title: 'Board Canvas',
        description: 'Render matrix',
        targetFiles: ['canvas.ts'],
        acceptanceCriteria: ['Canvas renders'],
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
      },
    ]);

    await marathonCommand.execute('status', ctx);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('MARATHON ROADMAP STATUS'));
  });

  it('handles abort subcommand gracefully', async () => {
    const ctx = createMockContext();
    initMarathonRun(tmpDir, 'Build Tetris Game', 'main', []);

    await marathonCommand.execute('abort', ctx);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('has been aborted'));
  });

  it('handles rollback subcommand', async () => {
    const ctx = createMockContext();
    initMarathonRun(tmpDir, 'Build Tetris Game', 'main', [
      {
        id: 'm-1',
        title: 'Initial',
        description: 'First milestone',
        targetFiles: [],
        acceptanceCriteria: ['Pass'],
        status: 'in_progress',
        attempts: 1,
        maxAttempts: 3,
      },
    ]);

    await marathonCommand.execute('rollback', ctx);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[OK]'));
  });
});