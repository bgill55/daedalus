import { describe, it, expect, vi } from 'vitest';
import { createMarathonStackedPR } from './pr.js';
import type { MarathonRun } from './types.js';

describe('Marathon Stacked PR Creator', () => {
  const sampleRun: MarathonRun = {
    id: 'test-marathon-123',
    macroGoal: 'Add high-performance caching layer',
    baseBranch: 'main',
    marathonBranch: 'marathon/add-high-performance-caching-layer',
    status: 'completed',
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T01:00:00.000Z',
    activeMilestoneIndex: 1,
    roadmapPath: 'D:/Daedalus/MARATHON_ROADMAP.md',
    metrics: { totalIterations: 2, totalRollbacks: 0, totalEvaluations: 2 },
    milestones: [
      {
        id: 'm-1',
        title: 'Cache Interface',
        description: 'Create Redis and In-Memory cache adapters',
        targetFiles: ['src/cache.ts'],
        acceptanceCriteria: ['Adapter implements Cache interface'],
        status: 'passed',
        gitTag: 'daedalus-checkpoint/m-1',
        gitCommit: 'abc1234',
        attempts: 1,
        maxAttempts: 3,
        evalReport: {
          passed: true,
          score: 100,
          summary: 'Interface conforms to spec',
          regressions: [],
          criteriaResults: [{ criterion: 'Adapter implements Cache interface', satisfied: true }],
          repairRecommendations: [],
          evaluatedAt: '2026-09-03T00:30:00.000Z',
        },
      },
    ],
  };

  it('handles missing github remote gracefully', async () => {
    const res = await createMarathonStackedPR({
      projectRoot: 'C:/NonExistentPath/NoGitRepo',
      run: sampleRun,
    });
    expect(res.success).toBe(false);
    expect(res.message).toContain('No GitHub remote repository detected');
  });
});
