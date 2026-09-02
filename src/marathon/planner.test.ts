import { describe, it, expect, vi } from 'vitest';
import {
  buildMacroPlanningPrompt,
  parseMilestonesJson,
  planMarathonRoadmap,
} from './planner.js';

describe('Metis Macro-Planner (Milestone DAG Synthesis)', () => {
  it('builds clear macro planning prompt', () => {
    const prompt = buildMacroPlanningPrompt('Build a Snake Game in Terminal');
    expect(prompt).toContain('Metis');
    expect(prompt).toContain('Build a Snake Game in Terminal');
    expect(prompt).toContain('Atomic & Focused');
  });

  it('parses valid milestone JSON', () => {
    const raw = JSON.stringify([
      {
        id: 'm-1',
        title: 'Core Grid and Engine',
        description: 'Initialize game grid and movement vectors',
        targetFiles: ['src/grid.ts'],
        acceptanceCriteria: ['Grid initializes with correct dimensions'],
        verifyCommand: 'npm test',
      },
      {
        id: 'm-2',
        title: 'Input Handler and Loop',
        description: 'Process arrow key inputs and tick loop',
        targetFiles: ['src/loop.ts'],
        acceptanceCriteria: ['Arrow keys update heading'],
      },
    ]);

    const milestones = parseMilestonesJson(raw);
    expect(milestones.length).toBe(2);
    expect(milestones[0].id).toBe('m-1');
    expect(milestones[0].status).toBe('pending');
    expect(milestones[0].attempts).toBe(0);
    expect(milestones[0].maxAttempts).toBe(3);
    expect(milestones[1].id).toBe('m-2');
  });

  it('cleans markdown wrappers when parsing JSON', () => {
    const fenced = '```json\n[{"id": "m-1", "title": "Setup", "acceptanceCriteria": ["Done"]}]\n```';
    const milestones = parseMilestonesJson(fenced);
    expect(milestones.length).toBe(1);
    expect(milestones[0].title).toBe('Setup');
  });

  it('calls router and falls back gracefully on error', async () => {
    const mockRouter = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('Network error')),
        },
      },
    } as any;

    const milestones = await planMarathonRoadmap('Build CLI app', {
      router: mockRouter,
    });

    expect(milestones.length).toBe(1);
    expect(milestones[0].id).toBe('m-1');
    expect(milestones[0].title).toBe('Initial Implementation');
  });
});