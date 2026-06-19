import pc from 'picocolors';
import { execSync } from 'child_process';
import { LocalRouter } from '../router/index.js';
import { DaedalusConfig } from '../config/index.js';
import { ToolContext, ChatMessage, ToolCall } from '../types.js';
import { getAgentRole, filterToolsForRole } from './roles.js';
import { BUILTIN_TOOLS } from '../tools/definitions.js';
import { executeToolCalls } from '../tools/executor.js';

/** Execute an agent role targeting a specific model */
async function executeAgentRole(
  roleName: string,
  modelName: string,
  goal: string,
  context: string,
  router: LocalRouter,
  toolContext: ToolContext
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
      messages: messages as any,
      temperature: role.temperature ?? 0.1,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
    });

    const message = completion.choices[0].message;
    messages.push(message as any);

    if ((message as any).tool_calls && (message as any).tool_calls.length > 0) {
      const results = await executeToolCalls(
        (message as any).tool_calls.map((tc: any) => ({
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
        } as any);
      }
      turns++;
      continue;
    }

    return (message as any).content || 'Agent completed without response';
  }

  return 'Agent reached max turns';
}

/** Get current unstaged changes (including intent-to-add files) */
function getGitChangesDiff(cwd: string): string {
  try {
    try {
      execSync('git add -N .', { cwd, stdio: 'ignore' });
    } catch { /* ignore */ }
    return execSync('git diff', { cwd, encoding: 'utf8' });
  } catch (err: any) {
    return `Error getting git diff: ${err.message}`;
  }
}

/** Run the Multi-Model Ensemble Drafting workflow */
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

  console.log(pc.cyan(`\n[ENSEMBLE] Starting ensemble drafting for goal: "${goal}"`));
  console.log(pc.cyan(`[ENSEMBLE] Pipeline: Coder (${draftModel}) -> Reviewer (${criticModel})`));

  let critiques = '';
  const cwd = process.cwd();

  for (let loop = 1; loop <= maxLoops; loop++) {
    console.log(pc.bold(pc.yellow(`\n--- Loop ${loop} of ${maxLoops} ---`)));

    // 1. Draft Phase
    console.log(pc.blue(`[ENSEMBLE] Coder drafting changes...`));
    const coderGoal = critiques
      ? `Here is the original goal:\n${goal}\n\nThe reviewer rejected your previous draft with the following critiques:\n${critiques}\n\nPlease update the files to fix all these issues and address the goal.`
      : goal;

    const filesList = context.activeFiles.size > 0
      ? 'Files in context: ' + Array.from(context.activeFiles.values()).join(', ')
      : 'No files in context';

    await executeAgentRole('coder', draftModel, coderGoal, filesList, router, context);

    // 2. Get proposed changes
    const diff = getGitChangesDiff(cwd);
    if (!diff.trim()) {
      console.log(pc.yellow('[ENSEMBLE] No changes made by the coder in this iteration.'));
      break;
    }

    // 3. Critique Phase
    console.log(pc.blue(`[ENSEMBLE] Reviewer critiquing changes...`));
    const criticGoal = `You are reviewing the changes proposed to solve the following goal:

GOAL:
${goal}

PROPOSED CHANGES (GIT DIFF):
${diff}

Please perform a rigorous review. Analyze the changes for correctness, security, style, and missing tests.
If there are issues, write a numbered list of critiques/comments detailing exactly what needs to be fixed.
If the changes are correct and complete, respond with "APPROVED".
Do not include any extra text if approved.`;

    const reviewResult = await executeAgentRole('reviewer', criticModel, criticGoal, '', router, context);

    console.log(pc.gray(`\nReviewer Feedback:\n${reviewResult.trim()}\n`));

    if (reviewResult.toUpperCase().includes('APPROVED')) {
      console.log(pc.green('[ENSEMBLE] Reviewer APPROVED the changes.'));
      break;
    } else {
      critiques = reviewResult;
      console.log(pc.red(`[ENSEMBLE] Reviewer rejected the draft in loop ${loop}.`));
    }
  }

  console.log(pc.green('\n[ENSEMBLE] Ensemble drafting complete.'));
}
