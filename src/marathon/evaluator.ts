import fs from 'node:fs';
import path from 'node:path';
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
  // Ensure untracked files appear in git diff
  try {
    execSync('git add -N .', { cwd, stdio: 'ignore', windowsHide: true });
  } catch {
    // Ignore if not in git repo
  }

  if (baseTagOrCommit) {
    try {
      const diff = execSync(`git diff ${baseTagOrCommit}`, {
        cwd,
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 1024 * 1024 * 4,
      });
      if (diff && diff.trim().length > 0) return diff;
    } catch {
      // Fallback below
    }
  }

  try {
    const workingDiff = execSync('git diff HEAD', {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024 * 4,
    });
    if (workingDiff && workingDiff.trim().length > 0) return workingDiff;
  } catch {
    // Fallback below
  }

  try {
    return execSync('git diff HEAD~1..HEAD', {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024 * 4,
    });
  } catch {
    return '';
  }
}

export function inferTestForTarget(cwd: string, targetFile: string): string | null {
  const baseName = path.basename(targetFile, path.extname(targetFile));
  const dir = path.dirname(targetFile);
  const parentDir = path.dirname(dir);

  const candidates = [
    targetFile.replace(/\.[^.]+$/, '.test.ts'),
    path.join(dir, `${baseName}.test.ts`),
    path.join(parentDir, `${baseName}.test.ts`),
    path.join(dir, 'styles.test.ts'),
    path.join(parentDir, 'styles.test.ts'),
  ];

  for (const cand of candidates) {
    const full = path.resolve(cwd, cand);
    if (fs.existsSync(full) && !fs.statSync(full).isDirectory()) {
      return cand.replace(/\\/g, '/');
    }
  }
  return null;
}

export function runMilestoneVerification(cwd: string, customCommand?: string, targetFiles: string[] = []): { success: boolean; output: string } {
  let cmd = customCommand;
  if (!cmd || cmd === 'npm test') {
    const directTestTarget = targetFiles.find(f => /\.test\.[jt]sx?$/.test(f));
    let inferredTestTarget: string | null = null;
    for (const file of targetFiles) {
      const match = inferTestForTarget(cwd, file);
      if (match) {
        inferredTestTarget = match;
        break;
      }
    }
    const testTarget = directTestTarget || inferredTestTarget;

    if (testTarget && fs.existsSync(path.resolve(cwd, testTarget))) {
      cmd = `npx vitest run ${testTarget}`;
    } else if (targetFiles.length > 0 && targetFiles.every(f => /\.(html|css|json|md|svg|png|webmanifest)$/.test(f))) {
      cmd = 'npx tsc --noEmit';
    } else {
      cmd = 'npm test';
    }
  }

  try {
    const output = execSync(cmd, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180000,
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
2. For styling or responsive UI milestones in headless environments without browser screenshot harnesses, passing unit/integration tests that assert CSS rules, @media queries, and DOM layout properties satisfy layout verification criteria.
3. Check for fake/tautological tests, empty files, or placeholder stubs (e.g. 0-byte css/js, empty functions, incomplete UI). Any milestone containing empty stubs or missing implementations must receive score <= 40 and passed: false.
4. Check for obvious regressions introduced directly by this milestone's diff. Note: Unrelated failures in existing host test suites (such as terminal.test.ts or model.test.ts) are not regressions of new subsystem features.
5. If recommending repairs on large existing files (>200 lines), explicitly advise using 'patch' to append or edit specific blocks rather than rewriting the whole file.
6. Output your verdict in pure, valid JSON with no conversational wrapper:
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

export function findMissingOrStubFiles(cwd: string, targetFiles: string[] = []): { missing: string[]; stubs: string[] } {
  const missing: string[] = [];
  const stubs: string[] = [];
  for (const rel of targetFiles) {
    const full = path.resolve(cwd, rel);
    if (!fs.existsSync(full)) {
      missing.push(rel);
      continue;
    }
    try {
      const stat = fs.statSync(full);
      if (stat.size === 0) {
        stubs.push(rel);
        continue;
      }
      const content = fs.readFileSync(full, 'utf8').trim();
      if (content.length === 0) {
        stubs.push(rel);
        continue;
      }
      if (/^\/\*[\s\S]*?\*\/$/i.test(content) || /^<!--[\s\S]*?-->$/i.test(content) || /^\/\/\s*(todo|placeholder|empty)/i.test(content)) {
        stubs.push(rel);
      }
    } catch {
      missing.push(rel);
    }
  }
  return { missing, stubs };
}

function cleanJson(str: string): string {
  let cleaned = str.trim();
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
  cleaned = cleaned.replace(/([{,\[]\s*)'([^']*)'\s*:/g, '$1"$2":');
  cleaned = cleaned.replace(/:\s*'([^']*)'\s*([,}\]])/g, ':"$1"$2');
  cleaned = cleaned.replace(/\[\s*'([^']*)'\s*([,\]])/g, '["$1"$2');
  cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z0-9_-]+)\s*:/g, '$1"$2":');
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
  return cleaned;
}

export function parseEvaluationJson(raw: string, fallbackCriteria: string[] = []): MarathonEvaluationReport {
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  const jsonBlock = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonBlock) {
    cleaned = jsonBlock[1].trim();
  } else {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1).trim();
    }
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    try {
      parsed = JSON.parse(cleanJson(cleaned));
    } catch {
      // If full parse failed, extract boolean passed and score using regex heuristics
      const passedMatch = /"passed"\s*:\s*(true|false)/i.exec(cleaned);
      const scoreMatch = /"score"\s*:\s*(\d+)/i.exec(cleaned);
      const summaryMatch = /"summary"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i.exec(cleaned);

      if (passedMatch) {
        const passed = passedMatch[1].toLowerCase() === 'true';
        const score = scoreMatch ? parseInt(scoreMatch[1], 10) : (passed ? 90 : 20);
        const summary = summaryMatch ? summaryMatch[1] : (passed ? 'Milestone passed verification.' : 'Milestone failed criteria.');
        return {
          passed,
          score,
          summary,
          regressions: [],
          criteriaResults: fallbackCriteria.map(c => ({ criterion: c, satisfied: passed })),
          repairRecommendations: passed ? [] : ['Review acceptance criteria'],
          evaluatedAt: new Date().toISOString(),
        };
      }
    }
  }

  if (parsed && typeof parsed === 'object') {
    return {
      passed: Boolean(parsed.passed),
      score: typeof parsed.score === 'number' ? parsed.score : (parsed.passed ? 100 : 0),
      summary: parsed.summary || (parsed.passed ? 'Milestone passed verification.' : 'Milestone failed criteria.'),
      regressions: Array.isArray(parsed.regressions) ? parsed.regressions : [],
      criteriaResults: Array.isArray(parsed.criteriaResults) ? parsed.criteriaResults : fallbackCriteria.map(c => ({ criterion: c, satisfied: Boolean(parsed.passed) })),
      repairRecommendations: Array.isArray(parsed.repairRecommendations) ? parsed.repairRecommendations : [],
      evaluatedAt: new Date().toISOString(),
    };
  }

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

export async function evaluateMilestone(
  milestone: MarathonMilestone,
  opts: EvaluatorOptions,
  baseTagOrCommit?: string
): Promise<MarathonEvaluationReport> {
  // Pre-evaluation Gate 1: Check for missing target files or empty placeholder stubs
  const { missing, stubs } = findMissingOrStubFiles(opts.projectRoot, milestone.targetFiles);
  if (missing.length > 0 || stubs.length > 0) {
    const issues = [
      ...missing.map(f => `Missing file: ${f}`),
      ...stubs.map(f => `Empty stub: ${f}`),
    ];
    return {
      passed: false,
      score: 0,
      summary: `Milestone rejected: ${issues.join('; ')}. All deliverable files must exist and contain working implementations.`,
      regressions: [],
      criteriaResults: milestone.acceptanceCriteria.map(c => ({
        criterion: c,
        satisfied: false,
        note: issues.join('; '),
      })),
      repairRecommendations: [
        `Create and implement all required target files: ${[...missing, ...stubs].join(', ')}.`,
      ],
      evaluatedAt: new Date().toISOString(),
    };
  }

  // Pre-evaluation Gate 2: Run verification test command
  const verify = runMilestoneVerification(opts.projectRoot, milestone.verifyCommand, milestone.targetFiles);
  if (!verify.success) {
    return {
      passed: false,
      score: 0,
      summary: `Verification command failed: ${verify.output.slice(0, 500)}`,
      regressions: [],
      criteriaResults: milestone.acceptanceCriteria.map(c => ({
        criterion: c,
        satisfied: false,
        note: 'Verification command failed',
      })),
      repairRecommendations: ['Fix failing verification command output'],
      evaluatedAt: new Date().toISOString(),
    };
  }

  // Pre-evaluation Gate 3: Check for empty git diff
  const diff = getMilestoneDiff(opts.projectRoot, baseTagOrCommit);
  if (!diff || diff.trim().length === 0) {
    return {
      passed: false,
      score: 0,
      summary: 'Milestone rejected: Git diff is completely empty (no code changes were produced).',
      regressions: [],
      criteriaResults: milestone.acceptanceCriteria.map(c => ({
        criterion: c,
        satisfied: false,
        note: 'No changes found in git diff',
      })),
      repairRecommendations: [
        'Directly execute file writes or patches to create the required changes.',
      ],
      evaluatedAt: new Date().toISOString(),
    };
  }

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
      max_tokens: 2500,
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