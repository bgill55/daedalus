import { describe, it, expect, vi } from 'vitest';
import {
  buildEvaluatorPrompt,
  parseEvaluationJson,
  evaluateMilestone,
} from './evaluator.js';
import { MarathonMilestone } from './types.js';

describe('Air-Gapped Evaluator (Apollo Out-of-Band)', () => {
  const sampleMilestone: MarathonMilestone = {
    id: 'm-1',
    title: 'Authentication Module',
    description: 'JWT login and register endpoints',
    targetFiles: ['src/auth.ts'],
    acceptanceCriteria: ['Valid JWT returned on login', 'Password hashed with bcrypt'],
    status: 'verifying',
    attempts: 1,
    maxAttempts: 3,
  };

  it('builds comprehensive evaluation prompt with criteria and diff', () => {
    const prompt = buildEvaluatorPrompt(sampleMilestone, '+ const jwt = true;', 'All tests passed', true);
    expect(prompt).toContain('Authentication Module');
    expect(prompt).toContain('Valid JWT returned on login');
    expect(prompt).toContain('+ const jwt = true;');
    expect(prompt).toContain('Success: true');
  });

  it('parses valid evaluation JSON output', () => {
    const raw = JSON.stringify({
      passed: true,
      score: 95,
      summary: 'Auth endpoints correctly implemented.',
      regressions: [],
      criteriaResults: [
        { criterion: 'Valid JWT returned on login', satisfied: true },
        { criterion: 'Password hashed with bcrypt', satisfied: true },
      ],
      repairRecommendations: [],
    });

    const report = parseEvaluationJson(raw, sampleMilestone.acceptanceCriteria);
    expect(report.passed).toBe(true);
    expect(report.score).toBe(95);
    expect(report.criteriaResults.length).toBe(2);
    expect(report.evaluatedAt).toBeDefined();
  });

  it('strips markdown code fencing from JSON output', () => {
    const fenced = '```json\n{"passed": true, "score": 88, "summary": "Looks good"}\n```';
    const report = parseEvaluationJson(fenced, sampleMilestone.acceptanceCriteria);
    expect(report.passed).toBe(true);
    expect(report.score).toBe(88);
  });

  it('safely handles malformed evaluator output with fallback', () => {
    const broken = 'NOT JSON AT ALL!';
    const report = parseEvaluationJson(broken, sampleMilestone.acceptanceCriteria);
    expect(report.passed).toBe(false);
    expect(report.score).toBe(0);
    expect(report.repairRecommendations.length).toBeGreaterThan(0);
  });

  it('runs evaluateMilestone and overrides false positive if test fails', async () => {
    const mockRouter = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    passed: true,
                    score: 90,
                    summary: 'Claimed passed',
                  }),
                },
              },
            ],
          }),
        },
      },
    } as any;

    // We pass verifyCommand that fails (exit 1)
    const milestoneWithFailingCmd: MarathonMilestone = {
      ...sampleMilestone,
      verifyCommand: 'node -e "process.exit(1)"',
    };

    const report = await evaluateMilestone(
      milestoneWithFailingCmd,
      {
        router: mockRouter,
        projectRoot: process.cwd(),
      }
    );

    // Hard gate must force passed to false because verifyCommand exited 1
    expect(report.passed).toBe(false);
    expect(report.summary).toContain('Verification command failed');
  });
});