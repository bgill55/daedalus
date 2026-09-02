import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { MarathonEngine } from './engine.js';
import { ToolContext } from '../types.js';

describe('MarathonEngine', () => {
  let tmpDir: string;
  let toolContext: ToolContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-engine-test-'));
    toolContext = {
      sessionId: 'engine-test-session',
      projectRoot: tmpDir,
      projectHash: 'hash-test',
      activeFiles: new Map(),
      agentRole: 'orchestrator',
      abortSignal: new AbortController().signal,
    };
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  });

  it('initializes a new run and saves roadmap and state', async () => {
    const mockRouter = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify([
                    {
                      id: 'm-1',
                      title: 'Initialize Workspace',
                      description: 'Create basic files',
                      targetFiles: ['index.ts'],
                      acceptanceCriteria: ['File exists'],
                    },
                  ]),
                },
              },
            ],
          }),
        },
      },
    } as any;

    const engine = new MarathonEngine({
      router: mockRouter,
      toolContext,
    });

    const run = await engine.startNewRun('Create Simple Node CLI');
    expect(run.macroGoal).toBe('Create Simple Node CLI');
    expect(run.milestones.length).toBe(1);
    expect(run.status).toBe('running');

    const roadmapPath = path.join(tmpDir, 'MARATHON_ROADMAP.md');
    expect(fs.existsSync(roadmapPath)).toBe(true);

    const active = engine.getActiveRun();
    expect(active?.id).toBe(run.id);
  });

  it('executes rollback on active milestone', async () => {
    const mockRouter = {} as any;
    const engine = new MarathonEngine({
      router: mockRouter,
      toolContext,
    });

    // Directly create state
    await engine.startNewRun('Rollback Test');
    const result = await engine.rollbackActiveMilestone();
    expect(result.success).toBe(true);

    const active = engine.getActiveRun();
    expect(active?.milestones[0].status).toBe('rolled_back');
    expect(active?.metrics.totalRollbacks).toBe(1);
  });
});