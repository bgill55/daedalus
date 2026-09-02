import { execSync } from 'child_process';
import { LocalRouter } from '../router/index.js';
import { ChatMessage, messageText } from '../types.js';
import { MarathonMilestone, MarathonEvaluationReport } from './types.js';

export interface EvaluatorOptions {
  router: LocalRouter;
  modelOverride?: string;
  projectRoot: string;
}

export function getMilestoneDiff(cwd: string, baseTagOrCommit?: string): string {
  try {
    const target = baseTagOrCommit ? `${baseTagOrCommit}..HEAD` : 'HEAD~1';
    return execSync(`git diff ${target}`, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4,
    });
  } catch {
    try {
      return execSync('git diff HEAD', {
        cwd,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 4,
      });
    } catch {
      return '';
    }
  }
}

export function runMilestoneVerification(cwd: string, customCommand?: string): { success: boolean; output: string } {
  const cmd = customCommand || 'npm test';
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
    });
    return { success: true, output };
  } catch (err: unknown) {
    const out = (err as { stdout?: string; stderr?: string });
    const output = [out?.stdout, out?.stderr].filter(Boolean).join('\n') || String(err);
    return { success: false, output };
  }
}

export function buildEvaluatorPrompt(
  milestone: MarathonMilestone,
  diff: string,
  testOutput: string,
  testSuccess: boolean
): string {
  return `You are Apollo, the independent, air-gapped evaluation judge for the Daedalus Marathon Engine.
Your role is to rigorously audit the code changes for this milestone WITHOUT bias.
You have isolated context: you must judge only the actual code diff and test output.

## Milestone: ${milestone.title} (${milestone.id})
${milestone.description}

## Required Acceptance Criteria:
${milestone.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Verification Command Output (Success: ${testSuccess}):
\`\`\`
${testOutput.slice(0, 4000) || '(No test output)'}
\`\`\`

## Git Diff (Actual Changes Produced):
\`\`\`diff
${diff.slice(0, 12000) || '(Empty diff)'}
\`\`\`

## Instructions:
1. Check each acceptance criterion against the actual diff and test output.
2. Check for fake/tautological tests or mocked-out critical functionality.
3. Check for obvious regressions.
4. Output your verdict in pure, valid JSON with no conversational wrapper:
{
  "passed": boolean,
  "score": number (0-100),
  "summary": "concise explanation of findings",
  "regressions": ["any regressions found"],
  "criteriaResults": [
    { "criterion": "criterion text", "satisfied": boolean, "note": "optional note" }
  ],
  "repairRecommendations": ["actionable recommendations if failed"]
}`;
}

export function parseEvaluationJson(raw: string, fallbackCriteria: string[] = []): MarathonEvaluationReport {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      passed: Boolean(parsed.passed),
      score: typeof parsed.score === 'number' ? parsed.score : (parsed.passed ? 100 : 0),
      summary: parsed.summary || (parsed.passed ? 'Milestone passed verification.' : 'Milestone failed criteria.'),
      regressions: Array.isArray(parsed.regressions) ? parsed.regressions : [],
      criteriaResults: Array.isArray(parsed.criteriaResults) ? parsed.criteriaResults : fallbackCriteria.map(c => ({ criterion: c, satisfied: Boolean(parsed.passed) })),
      repairRecommendations: Array.isArray(parsed.repairRecommendations) ? parsed.repairRecommendations : [],
      evaluatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      passed: false,
      score: 0,
      summary: 'Evaluator response failed to parse as valid JSON.',
      regressions: [],
      criteriaResults: fallbackCriteria.map(c => ({ criterion: c, satisfied: false, note: 'Evaluation parse failure' })),
      repairRecommendations: ['Re-run evaluation with cleaner prompt'],
      evaluatedAt: new Date().toISOString(),
    };
  }
}

export async function evaluateMilestone(
  milestone: MarathonMilestone,
  opts: EvaluatorOptions,
  baseTagOrCommit?: string
): Promise<MarathonEvaluationReport> {
  const diff = getMilestoneDiff(opts.projectRoot, baseTagOrCommit);
  const verify = runMilestoneVerification(opts.projectRoot, milestone.verifyCommand);

  const prompt = buildEvaluatorPrompt(milestone, diff, verify.output, verify.success);
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are Apollo, the air-gapped auditor. Output pure JSON only.' },
    { role: 'user', content: prompt },
  ];

  try {
    const res = await opts.router.chat.completions.create({
      model: opts.modelOverride || 'intelligence',
      messages,
      temperature: 0.1,
      max_tokens: 1500,
    });

    const text = messageText(res.choices?.[0]?.message?.content ?? '');
    const report = parseEvaluationJson(text, milestone.acceptanceCriteria);

    // Hard gate: If the verification test command failed, the report cannot pass
    if (!verify.success && report.passed) {
      report.passed = false;
      report.score = Math.min(report.score, 50);
      report.summary = `Verification command failed despite model verdict: ${report.summary}`;
      report.repairRecommendations.unshift('Fix failing verification command output');
    }

    return report;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      passed: false,
      score: 0,
      summary: `Air-gapped evaluation error: ${msg}`,
      regressions: [],
      criteriaResults: milestone.acceptanceCriteria.map(c => ({ criterion: c, satisfied: false })),
      repairRecommendations: ['Investigate model routing error during evaluation'],
      evaluatedAt: new Date().toISOString(),
    };
  }
}