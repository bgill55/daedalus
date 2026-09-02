import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  initMarathonRun,
  loadMarathonRun,
  updateMilestoneStatus,
  advanceToNextMilestone,
  renderRoadmapMarkdown,
} from './state.js';
import { MarathonMilestone } from './types.js';

function createSampleMilestones(): MarathonMilestone[] {
  return [
    {
      id: 'm-1',
      title: 'Database Setup',
      description: 'Setup SQLite models and migrations',
      targetFiles: ['src/db.ts'],
      acceptanceCriteria: ['Table exists', 'Migration passes'],
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
    },
    {
      id: 'm-2',
      title: 'REST API',
      description: 'Implement API routes',
      targetFiles: ['src/api.ts'],
      acceptanceCriteria: ['GET /items returns 200'],
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
    },
  ];
}

describe('Marathon State Management', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-marathon-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Cleanup best effort
    }
  });

  it('initializes and saves a new marathon run', () => {
    const run = initMarathonRun(tmpDir, 'Build RSS Reader CLI', 'main', createSampleMilestones());
    expect(run.macroGoal).toBe('Build RSS Reader CLI');
    expect(run.milestones.length).toBe(2);
    expect(run.status).toBe('planning');

    const loaded = loadMarathonRun(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(run.id);
  });

  it('updates milestone status and records timestamps', () => {
    const run = initMarathonRun(tmpDir, 'Test Task', 'main', createSampleMilestones());
    updateMilestoneStatus(run, 'm-1', 'in_progress');
    expect(run.milestones[0].status).toBe('in_progress');
    expect(run.milestones[0].startedAt).toBeDefined();

    updateMilestoneStatus(run, 'm-1', 'passed', { gitTag: 'daedalus-checkpoint/m-1' });
    expect(run.milestones[0].status).toBe('passed');
    expect(run.milestones[0].gitTag).toBe('daedalus-checkpoint/m-1');
    expect(run.milestones[0].completedAt).toBeDefined();
  });

  it('advances to next milestone and completes run on last milestone', () => {
    const run = initMarathonRun(tmpDir, 'Test Task', 'main', createSampleMilestones());
    expect(run.activeMilestoneIndex).toBe(0);

    const advanced = advanceToNextMilestone(run);
    expect(advanced).toBe(true);
    expect(run.activeMilestoneIndex).toBe(1);

    const finished = advanceToNextMilestone(run);
    expect(finished).toBe(false);
    expect(run.status).toBe('completed');
    expect(run.completedAt).toBeDefined();
  });

  it('renders and writes roadmap markdown file', () => {
    const run = initMarathonRun(tmpDir, 'Build RSS Reader CLI', 'main', createSampleMilestones());
    const md = renderRoadmapMarkdown(run);
    expect(md).toContain('# Marathon Roadmap: Build RSS Reader CLI');
    expect(md).toContain('### [ ] M-1: Database Setup');
    expect(md).toContain('### [ ] M-2: REST API');

    const roadmapFile = path.join(tmpDir, 'MARATHON_ROADMAP.md');
    expect(fs.existsSync(roadmapFile)).toBe(true);
  });
});