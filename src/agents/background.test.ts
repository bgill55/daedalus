import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  spawnBackgroundAgent,
  killBackgroundAgent,
  backgroundJobs,
  pendingNotifications
} from './background.js';
import * as delegationModule from '../tools/builtin/delegation.js';
import type { ToolContext } from '../types.js';

describe('Background Agent Execution', () => {
  const mockContext: ToolContext = {
    sessionId: 'test-session',
    projectRoot: process.cwd(),
    projectHash: 'testhash',
    activeFiles: new Map(),
    agentRole: 'coder',
    abortSignal: new AbortController().signal,
    autoApplyEdits: 'all',
    patchHistory: [],
  } as ToolContext;

  beforeEach(() => {
    backgroundJobs.clear();
    pendingNotifications.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delegationModule.setRouterClient(null as any);
  });

  it('spawns a background agent and runs successfully', async () => {
    const mockRouterClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Task completed successfully', role: 'assistant', tool_calls: [] } }],
          }),
        },
      },
    };
    delegationModule.setRouterClient(mockRouterClient as any);

    const id = spawnBackgroundAgent(
      'coder',
      'write a test',
      'active files: none',
      mockContext
    );

    expect(id).toBeTypeOf('number');
    const job = backgroundJobs.get(id);
    expect(job).toBeDefined();
    expect(job?.status).toBe('running');

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(job?.status).toBe('completed');
    expect(job?.result).toBe('Task completed successfully');
    expect(pendingNotifications.length).toBe(1);
    expect(pendingNotifications[0]).toContain('completed successfully');
  });

  it('spawns a background agent and handles failure', async () => {
    delegationModule.setRouterClient(null as any);

    const id = spawnBackgroundAgent(
      'coder',
      'write a test',
      'active files: none',
      mockContext
    );

    const job = backgroundJobs.get(id);
    expect(job).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(job?.status).toBe('failed');
    expect(job?.error).toContain('Router client not initialized');
    expect(pendingNotifications.length).toBe(1);
    expect(pendingNotifications[0]).toContain('failed');
  });

  it('spawns a background agent and handles custom exceptions', async () => {
    vi.spyOn(delegationModule, 'manage').mockRejectedValue(new Error('Internal delegation crash'));

    const id = spawnBackgroundAgent(
      'coder',
      'write a test',
      'active files: none',
      mockContext
    );

    const job = backgroundJobs.get(id);
    expect(job).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(job?.status).toBe('failed');
    expect(job?.error).toContain('Internal delegation crash');
    expect(pendingNotifications.length).toBe(1);
    expect(pendingNotifications[0]).toContain('failed with exception');
  });

  it('can kill a running background agent', async () => {
    let resolvePromise: (value: any) => void = () => {};
    const delayPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    const mockRouterClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async () => {
            await delayPromise;
            return {
              choices: [{ message: { content: 'done', role: 'assistant', tool_calls: [] } }],
            };
          }),
        },
      },
    };
    delegationModule.setRouterClient(mockRouterClient as any);

    const id = spawnBackgroundAgent(
      'coder',
      'write a test',
      'active files: none',
      mockContext
    );

    const job = backgroundJobs.get(id);
    expect(job).toBeDefined();
    expect(job?.status).toBe('running');

    const killed = killBackgroundAgent(id);
    expect(killed).toBe(true);
    expect(job?.status).toBe('killed');
    expect(job?.error).toBe('Killed by user');

    resolvePromise(null);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(job?.status).toBe('killed');
    expect(pendingNotifications).toContain(`[NOTIF] Background task #${id} (coder) was cancelled by user.`);
  });

  it('returns false when killing a non-running or non-existent agent', () => {
    const killedNonExistent = killBackgroundAgent(999);
    expect(killedNonExistent).toBe(false);

    const job = {
      id: 1,
      role: 'coder',
      goal: 'test',
      status: 'completed' as const,
      startedAt: Date.now(),
      abortController: new AbortController(),
    };
    backgroundJobs.set(1, job);

    const killedCompleted = killBackgroundAgent(1);
    expect(killedCompleted).toBe(false);
  });
});
