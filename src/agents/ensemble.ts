import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import { execSync } from 'child_process';
import { LocalRouter } from '../router/index.js';
import { DaedalusConfig } from '../config/index.js';
import { ToolContext, ChatMessage } from '../types.js';
import { getAgentRole, filterToolsForRole } from './roles.js';
import { BUILTIN_TOOLS } from '../tools/definitions.js';
import { executeToolCalls } from '../tools/executor.js';
import { detectProjectStack } from '../config/stack.js';
import { Orchestrator } from './orchestrator.js';

interface CandidateResult {
  diff: string;
  score: number;
  critique: string;
  model: string;
  temp: number;
  compiles: boolean;
  testsPass: boolean;
}

async function executeAgentRole(
  roleName: string,
  modelName: string,
  goal: string,
  context: string,
  router: LocalRouter,
  toolContext: ToolContext,
  temperatureOverride?: number
): Promise<string> {
  const role = getAgentRole(roleName);
  const tools = filterToolsForRole(BUILTIN_TOOLS, roleName);
  const messages: ChatMessage[] = [
    { role: 'system', content: role.systemPrompt },
    { role: 'user', content: `${context}\n\nTask: ${goal}` },
  ];

  let turns = 0;
  const maxTurns = role.maxTurns ?? 10;

  while (turns < maxTurns) {
    const completion = await router.chat.completions.create({
      model: modelName,
      messages,
      temperature: temperatureOverride ?? role.temperature ?? 0.1,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
    });

    const message = completion.choices[0].message;
    messages.push(message);

    if (message.tool_calls && message.tool_calls.length > 0) {
      const results = await executeToolCalls(
        message.tool_calls.map((tc: any) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
        toolContext
      );

      for (const result of results) {
        messages.push({
          role: 'tool',
          content: result.content,
          tool_call_id: result.toolCallId,
        });
      }
      turns++;
      continue;
    }

    return message.content || 'Agent completed without response';
  }

  return 'Agent reached max turns';
}

function getGitChangesDiff(cwd: string): string {
  try {
    try {
      execSync('git add -N .', { cwd, stdio: 'ignore' });
    } catch { /* ignored */ }
    return execSync('git diff', { cwd, encoding: 'utf8' });
  } catch (err: any) {
    return `Error getting git diff: ${err.message}`;
  }
}

export async function runEnsembleWorkflow(
  goal: string,
  context: ToolContext,
  config: DaedalusConfig,
  router: LocalRouter
): Promise<void> {
  const ensembleConfig = config.agents.ensemble;
  const maxLoops = ensembleConfig.maxLoops ?? 2;
  const draftModel = ensembleConfig.draftModel ?? 'auto';
  const criticModel = ensembleConfig.criticModel ?? 'auto';
  const candidatesCount = ensembleConfig.candidatesCount ?? 2;

  console.log(pc.cyan(`\n[ENSEMBLE] Starting ensemble drafting for goal: "${goal}"`));
  console.log(pc.cyan(`[ENSEMBLE] Pipeline: Coder (${draftModel}) -> Reviewer (${criticModel}) with ${candidatesCount} candidates`));

  let critiques = '';
  const cwd = context.projectRoot || process.cwd();
  const enabledModels = router.getEnabledModels();

  function getCandidateParams(index: number): { model: string; temp: number } {
    if (draftModel && draftModel !== 'auto') {
      const temps = [0.2, 0.7, 0.9, 0.4, 0.8];
      return { model: draftModel, temp: temps[index % temps.length] };
    }
    if (enabledModels.length > 0) {
      const modelEntry = enabledModels[index % enabledModels.length];
      const temps = [0.2, 0.7, 0.9, 0.4, 0.8];
      const tempIndex = Math.floor(index / enabledModels.length);
      return { model: modelEntry.name, temp: temps[tempIndex % temps.length] };
    }
    return { model: 'auto', temp: 0.2 };
  }

  let baselineCreated = false;

  try {
    try {
      execSync('git add -A', { cwd, stdio: 'ignore' });
      execSync('git commit -m "daedalus-ensemble-baseline" --allow-empty', { cwd, stdio: 'ignore' });
      baselineCreated = true;
    } catch (err: any) {
      console.warn(pc.yellow(`[WARN] Failed to establish git baseline: ${err.message}`));
    }

    for (let loop = 1; loop <= maxLoops; loop++) {
      console.log(pc.bold(pc.yellow(`\n--- Loop ${loop} of ${maxLoops} ---`)));

      const coderGoal = critiques
        ? `Here is the original goal:\n${goal}\n\nThe reviewer rejected your previous draft with the following critiques:\n${critiques}\n\nPlease update the files to fix all these issues and address the goal.`
        : goal;

      const filesList = context.activeFiles.size > 0
        ? 'Files in context: ' + Array.from(context.activeFiles.values()).join(', ')
        : 'No files in context';

      const candidates: CandidateResult[] = [];

      for (let i = 0; i < candidatesCount; i++) {
        const { model, temp } = getCandidateParams(i);
        console.log(pc.blue(`[ENSEMBLE] Spawning candidate ${i + 1}/${candidatesCount} using Coder (${model}) at temp ${temp}...`));

        await executeAgentRole('coder', model, coderGoal, filesList, router, context, temp);

        const diff = getGitChangesDiff(cwd);

        try {
          execSync('git reset --hard HEAD', { cwd, stdio: 'ignore' });
          execSync('git clean -fd', { cwd, stdio: 'ignore' });
        } catch { /* ignored */ }

        if (!diff.trim()) {
          console.log(pc.yellow(`[ENSEMBLE] Candidate ${i + 1} made no changes.`));
          continue;
        }

        candidates.push({
          diff,
          score: 0,
          critique: '',
          model,
          temp,
          compiles: false,
          testsPass: false,
        });
      }

      if (candidates.length === 0) {
        console.log(pc.yellow('[ENSEMBLE] No changes made by any candidate in this iteration.'));
        break;
      }

      for (const [idx, cand] of candidates.entries()) {
        console.log(pc.blue(`[ENSEMBLE] Evaluating candidate ${idx + 1}/${candidates.length}...`));

        try {
          execSync('git apply', { input: cand.diff, cwd, stdio: 'ignore' });
        } catch {
          try {
            execSync('git apply --whitespace=fix', { input: cand.diff, cwd, stdio: 'ignore' });
          } catch {
            continue;
          }
        }

        let compiles = true;
        if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
          try {
            execSync('npx tsc --noEmit', { cwd, stdio: 'ignore' });
          } catch {
            compiles = false;
          }
        }
        cand.compiles = compiles;

        let testsPass = true;
        try {
          execSync('npm test -- --run', { cwd, stdio: 'ignore', timeout: 15000 });
        } catch {
          testsPass = false;
        }
        cand.testsPass = testsPass;

        const projectStack = detectProjectStack(context.projectRoot || process.cwd());
        const frameworkRules = Orchestrator.getFrameworkGuidance(projectStack, context.projectRoot);

        const criticGoal = `You are evaluating a candidate code draft to solve the following goal:

GOAL:
${goal}

PROJECT CONTEXT:
${projectStack || '(none detected)'}
${frameworkRules || '(none)'}

PROPOSED CHANGES (GIT DIFF):
${cand.diff}

Analyze the changes for correctness, security, style, and missing tests.
First, write a brief critique of the changes.
Then, output a score on a new line in the exact format: "SCORE: X" where X is an integer from 1 to 10 (10 being perfect, fully correct, and complete).
If the changes are perfect and ready to merge, also include the word "APPROVED" in your response.`;

        console.log(pc.blue(`[ENSEMBLE] Running critic review...`));
        const reviewResult = await executeAgentRole('reviewer', criticModel, criticGoal, '', router, context);
        cand.critique = reviewResult;

        const scoreMatch = reviewResult.match(/SCORE:\s*(\d+)/i);
        const criticScore = scoreMatch ? parseInt(scoreMatch[1], 10) : 5;

        // Multiplicative scoring: compilation is a major multiplier, tests are a bonus
        let totalScore = criticScore * (compiles ? 1.5 : 0.5) * (testsPass ? 1.2 : 0.8);
        totalScore = Number(totalScore.toFixed(1)); // clean output
        cand.score = totalScore;

        console.log(pc.gray(`Candidate ${idx + 1} (${cand.model}): Compiles=${compiles}, TestsPass=${testsPass}, Score=${totalScore} (Critic: ${criticScore})`));

        try {
          execSync('git reset --hard HEAD', { cwd, stdio: 'ignore' });
          execSync('git clean -fd', { cwd, stdio: 'ignore' });
        } catch { /* ignored */ }
      }

      const validCandidates = candidates.filter(c => c.score > 0);
      if (validCandidates.length === 0) {
        console.log(pc.red('[ENSEMBLE] All candidates failed evaluation.'));
        break;
      }

      validCandidates.sort((a, b) => b.score - a.score);
      const bestCandidate = validCandidates[0];

      console.log(pc.green(`[ENSEMBLE] Selected best candidate (Score: ${bestCandidate.score}/20, Model: ${bestCandidate.model})`));

      try {
        execSync('git apply', { input: bestCandidate.diff, cwd, stdio: 'ignore' });
      } catch {
        try {
          execSync('git apply --whitespace=fix', { input: bestCandidate.diff, cwd, stdio: 'ignore' });
        } catch { /* ignored */ }
      }

      console.log(pc.gray(`\nReviewer Feedback for chosen candidate:\n${bestCandidate.critique.trim()}\n`));

      if (bestCandidate.critique.toUpperCase().includes('APPROVED')) {
        console.log(pc.green('[ENSEMBLE] Reviewer APPROVED the changes.'));
        break;
      } else {
        critiques = bestCandidate.critique;
        console.log(pc.red(`[ENSEMBLE] Reviewer rejected the draft in loop ${loop}.`));
      }
    }
  } finally {
    if (baselineCreated) {
      try {
        execSync('git reset --soft HEAD~1', { cwd, stdio: 'ignore' });
      } catch { /* ignored */ }
    }
  }

  console.log(pc.green('\n[ENSEMBLE] Ensemble drafting complete.'));
}
