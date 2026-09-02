import {
  detectFalseCompletion,
  falseCompletionWarning,
  detectFalseCompletionOnDisk,
  isScopeOverstatedSummary,
  scopeOverstatementWarning,
  isUnsubstantiatedProgressReport,
  unsubstantiatedProgressWarning,
  countAchievementItems,
  ClaimLedger,
  detectUngroundedClaim,
  ungroundedClaimWarning,
  isGreenStateClaim,
  greenStateWarning,
  isUngroundedProjectClaim,
  ungroundedProjectClaimWarning,
  isNegativeExistenceClaim,
  negativeExistenceWarning,
  isReviewTask,
  isIdeationOrProposalTask,
  isCasualOrInformationalTask,
  isReviewDeliverable,
  isReviewWithoutSourceInspection,
  reviewWithoutSourceInspectionWarning,
  claimedTestCountWithoutRun,
  claimedTestCountWithoutRunWarning,
  detectUngroundedWorksClaim,
  ungroundedWorksWarning,
  isUncitedArchClaim,
  uncitedArchClaimWarning,
  validateCitations,
  citationValidationWarning,
  collectCitationClaims,
  buildJudgePrompt,
  parseJudgeResponse,
  judgeClaimWarning,
  validateProseReferences,
  proseRefWarning,
} from './completion-guard.js';
import {
  ReadStallDetector,
  isGreenBuildTestClaim,
  fabricatedTestCountCorrection,
  DivergenceDetector,
} from './loop-guards.js';
import { getSessionTodos } from '../tools/builtin/todo.js';
import { parseTextToolCalls } from '../formatting.js';
import type { ToolContext, ChatMessage } from '../types.js';
import { messageText } from '../types.js';
import type { LocalRouter } from '../router/index.js';
import type { DaedalusConfig } from '../config/index.js';
import { dim } from '../ui/theme.js';

export interface TurnGuardContext {
  cleanContent: string;
  fullContent: string;
  userTask: string;
  messages: ChatMessage[];
  toolContext: ToolContext;
  router: LocalRouter;
  config: DaedalusConfig;
  claimLedger: ClaimLedger;
  readStall: ReadStallDetector;
  divergence: DivergenceDetector;
  readLines: (file: string, fromLine: number, toLine: number) => string[] | null;
  fileExists: (file: string) => boolean;
  verifyBreakerTrippedThisTurn: boolean;
  verifyBreakerTrippedLastTurn: boolean;
  currentComplexity?: string;
  taskComplexity?: string;
  totalCompletionTokens: number;
  turnUsageOut?: number;
  escalationCount: number;
}

export type GuardResult =
  | { status: 'continue'; addedTokens?: number; updateVerifyBreaker?: boolean }
  | { status: 'halt'; content: string; maxTurnsCause: string; updateVerifyBreaker?: boolean }
  | { status: 'pass'; updateVerifyBreaker?: boolean };

export async function checkTurnCompletionGuards(ctx: TurnGuardContext): Promise<GuardResult> {
  const {
    cleanContent,
    fullContent,
    userTask,
    messages,
    toolContext,
    router,
    config,
    claimLedger,
    readStall,
    divergence,
    readLines,
    fileExists,
    verifyBreakerTrippedThisTurn,
    verifyBreakerTrippedLastTurn,
    currentComplexity,
    taskComplexity,
    totalCompletionTokens,
    turnUsageOut,
    escalationCount,
  } = ctx;

  const hasRecentGuardWarning = messages.slice(-6).some(
    (m) =>
      typeof m.content === 'string' &&
      (m.content.startsWith('[SYSTEM WARNING]') || m.content.startsWith('[FILE-MISSING]') || m.content.startsWith('[CHECK]'))
  );
  const isIdeation = isIdeationOrProposalTask(userTask);
  const isCasual = isCasualOrInformationalTask(userTask);
  const isReviewContent = !isIdeation && !isCasual && isReviewDeliverable(cleanContent);

  if (!hasRecentGuardWarning && !isReviewContent && divergence.register(cleanContent)) {
    const repeats = divergence.consecutiveRepeats;
    if (repeats >= 2) {
      console.log(dim(`\n  [STOP] Runaway loop: same output re-emitted ${repeats} times with no progress. Closing turn.`));
      return {
        status: 'halt',
        content: `${cleanContent}\n\n[SELF-CORRECT] I repeated the same output ${repeats} times without making progress. I am stopping this turn rather than looping.`,
        maxTurnsCause: 'repeated identical output without progress (repetition guard tripped) — the agent emitted the same response multiple times',
      };
    }
    console.log(dim(`\n  [CHECK] Detected near-duplicate of prior output — not making progress.`));
    toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
    messages.push({ role: 'assistant', content: cleanContent });
    messages.push({
      role: 'user',
      content: `[SYSTEM WARNING] This response is nearly identical to output you already produced this turn. You are looping on repeated text instead of making progress. Do NOT re-state completed work. Either (1) take a concrete next action (read the failing test, fix the code, verify), or (2) if you are blocked, report the blocker concisely and stop.`,
    } as ChatMessage);
    return { status: 'continue' };
  }

  const ungrounded = (!isCasual) ? detectUngroundedClaim(cleanContent, claimLedger, fileExists) : null;
  if (ungrounded) {
    const key = `claim:${ungrounded}`;
    if (!toolContext.firedCompletionGuards?.has(key)) {
      (toolContext.firedCompletionGuards ??= new Set<string>()).add(key);
      console.log(dim(`\n  [CHECK] Claim about ${ungrounded} is ungrounded (no inspection this session).`));
      toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
      messages.push({ role: 'assistant', content: cleanContent });
      messages.push({
        role: 'user',
        content: ungroundedClaimWarning(ungrounded),
      } as ChatMessage);
      return { status: 'continue' };
    }
  }

  const projClaim = (!isIdeation && !isCasual) ? isUngroundedProjectClaim(cleanContent, claimLedger) : null;
  if (projClaim) {
    const key = `proj:${projClaim}`;
    if (!toolContext.firedCompletionGuards?.has(key)) {
      (toolContext.firedCompletionGuards ??= new Set<string>()).add(key);
      console.log(dim(`\n  [CHECK] Project claim about "${projClaim}" is ungrounded (never observed this session).`));
      toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
      messages.push({ role: 'assistant', content: cleanContent });
      messages.push({
        role: 'user',
        content: ungroundedProjectClaimWarning(projClaim),
      } as ChatMessage);
      return { status: 'continue' };
    }
  }

  const negClaim = (!isIdeation && !isCasual) ? isNegativeExistenceClaim(cleanContent, claimLedger) : null;
  if (negClaim) {
    const key = `neg:${negClaim}`;
    if (!toolContext.firedCompletionGuards?.has(key)) {
      (toolContext.firedCompletionGuards ??= new Set<string>()).add(key);
      console.log(dim(`\n  [CHECK] Claim that "${negClaim}" is missing is ungrounded (no search/list run this session).`));
      toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
      messages.push({ role: 'assistant', content: cleanContent });
      messages.push({
        role: 'user',
        content: negativeExistenceWarning(negClaim),
      } as ChatMessage);
      return { status: 'continue' };
    }
  }

  const narratedToolCalls = parseTextToolCalls(fullContent);
  if (narratedToolCalls.length >= 1) {
    console.log(dim(`\n  [RETRY] Model planned tools but emitted no valid JSON. Re-issuing the request.`));
    messages.push({
      role: 'user',
      content: `[SYSTEM WARNING] You emitted a <tool_call> block but it was not valid JSON. Please output the proper JSON array of tool calls now.`,
    } as ChatMessage);
    return { status: 'continue', addedTokens: turnUsageOut ?? 0 };
  }

  if (currentComplexity && process.env.DAEDALUS_DEBUG === 'true') {
    console.log(dim(`  [ROUTE] Task summary: start ${taskComplexity ?? 'n/a'} → end ${currentComplexity} | ${totalCompletionTokens + (turnUsageOut ?? 0)} output tokens | ${escalationCount} escalation(s)`));
  }

  const closingTodos = (!isCasual) ? getSessionTodos(toolContext.sessionId) : [];
  if (closingTodos.length > 0 && detectFalseCompletion(cleanContent, closingTodos)) {
    const remaining = closingTodos.filter((t) => t.status !== 'completed').length;
    console.log(dim(`\n  [CHECK] Verifying completion claim — ${remaining} todo(s) still open.`));
    toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
    messages.push({ role: 'assistant', content: cleanContent });
    messages.push({
      role: 'user',
      content: falseCompletionWarning(remaining),
    } as ChatMessage);
    return { status: 'continue' };
  }

  const falselyClaimed = (!isIdeation && !isCasual) ? detectFalseCompletionOnDisk(cleanContent, toolContext) : null;
  if (falselyClaimed) {
    console.log(dim(`\n  [CHECK] Verifying completion claim — no successful patch to ${falselyClaimed} this session (only reverts).`));
    toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
    messages.push({ role: 'assistant', content: cleanContent });
    messages.push({
      role: 'user',
      content: `[SYSTEM WARNING] You claimed a fix/completion involving ${falselyClaimed}, but this session has NO successful patch to that file — only patches the syntax guard reverted. Reconcile with disk reality: either (1) actually apply and verify the change (run build/test and confirm it on disk), or (2) report the blocker honestly instead of claiming it is done. Do NOT report completion for changes that were not written.`,
    } as ChatMessage);
    return { status: 'continue' };
  }

  const scopeTodos = (!isCasual) ? getSessionTodos(toolContext.sessionId) : [];
  if (scopeTodos.length > 0 && isScopeOverstatedSummary(cleanContent, scopeTodos)) {
    const remaining = scopeTodos.filter((t) => t.status !== 'completed').length;
    console.log(dim(`\n  [CHECK] Verifying completion claim — summary enumerates tasks as done but ${remaining} todo(s) still open.`));
    toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
    messages.push({ role: 'assistant', content: cleanContent });
    messages.push({
      role: 'user',
      content: scopeOverstatementWarning(remaining),
    } as ChatMessage);
    return { status: 'continue' };
  }

  if (!isIdeation && !isCasual && isUnsubstantiatedProgressReport(cleanContent)) {
    const key = 'unsubstantiated-progress';
    if (!toolContext.firedCompletionGuards?.has(key)) {
      (toolContext.firedCompletionGuards ??= new Set<string>()).add(key);
      const itemCount = countAchievementItems(cleanContent);
      console.log(dim(`\n  [CHECK] Verifying completion claim — ${itemCount} deliverables enumerated as done without a reconciling task list or per-item verification.`));
      toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
      messages.push({ role: 'assistant', content: cleanContent });
      messages.push({
        role: 'user',
        content: unsubstantiatedProgressWarning(itemCount),
      } as ChatMessage);
      return { status: 'continue' };
    }
  }

  if (!isIdeation && !isCasual && isReviewTask(userTask) && isReviewDeliverable(cleanContent) && claimLedger.totalObservations === 0) {
    console.log(dim(`\n  [STOP] Review produced with zero file inspections this session — halting.`));
    return {
      status: 'halt',
      content: `${cleanContent}\n\n[SELF-CORRECT] I described the project's architecture/features but have not inspected a single file this session. I am stopping rather than fabricating a review. I should read the code before reviewing.`,
      maxTurnsCause: 'produced a review deliverable with zero file inspections this session (review-without-inspection guard)',
    };
  }

  if (!isIdeation && !isCasual && isReviewTask(userTask) && isReviewWithoutSourceInspection(cleanContent, claimLedger)) {
    const srcCount = claimLedger.sourceFileObservations;
    console.log(dim(`\n  [CHECK] Review deliverable produced after reading only ${srcCount} source file(s) — insufficient inspection.`));
    toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
    messages.push({ role: 'assistant', content: cleanContent });
    messages.push({
      role: 'user',
      content: reviewWithoutSourceInspectionWarning(srcCount),
    } as ChatMessage);
    return { status: 'continue' };
  }

  if (!isIdeation && !isCasual && (isReviewTask(userTask) || isReviewDeliverable(cleanContent))) {
    const archTerm = isUncitedArchClaim(cleanContent);
    if (archTerm) {
      if ((toolContext.archGuardHits ?? 0) >= 3) {
        toolContext.maxTurnsCause = 'repeated uncited architectural claims despite 3 citation warnings (audit guard)';
      } else {
        toolContext.archGuardHits = (toolContext.archGuardHits ?? 0) + 1;
        console.log(dim(`\n  [CHECK] Review makes uncited structural claim "${archTerm}" (no file:line).`));
        toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
        messages.push({ role: 'assistant', content: cleanContent });
        messages.push({
          role: 'user',
          content: uncitedArchClaimWarning(archTerm),
        } as ChatMessage);
        return { status: 'continue' };
      }
    }

    const citationFails = validateCitations(cleanContent, { readLines });
    if (citationFails.length > 0) {
      const key = 'citation-validation';
      if (!toolContext.firedCompletionGuards?.has(key)) {
        (toolContext.firedCompletionGuards ??= new Set<string>()).add(key);
        console.log(dim(`\n  [CHECK] Review cites ${citationFails.length} source location(s) that do not check out against the codebase.`));
        toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
        messages.push({ role: 'assistant', content: cleanContent });
        messages.push({
          role: 'user',
          content: citationValidationWarning(citationFails),
        } as ChatMessage);
        return { status: 'continue' };
      }
    }

    const proseFails = validateProseReferences(cleanContent, { readLines, fileExists });
    if (proseFails.length > 0) {
      const key = 'prose-ref-validation';
      if (!toolContext.firedCompletionGuards?.has(key)) {
        (toolContext.firedCompletionGuards ??= new Set<string>()).add(key);
        console.log(dim(`\n  [CHECK] Review references ${proseFails.length} file(s) whose existence does not check out against the codebase.`));
        toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
        messages.push({ role: 'assistant', content: cleanContent });
        messages.push({
          role: 'user',
          content: proseRefWarning(proseFails),
        } as ChatMessage);
        return { status: 'continue' };
      }
    }

    if ((toolContext.judgeGuardHits ?? 0) < 3) {
      const claims = collectCitationClaims(cleanContent, { readLines }, 8);
      if (claims.length > 0) {
        try {
          const judgePrompt = buildJudgePrompt(claims);
          const jr = await router.chat.completions.create({
            model: config.modelOverride || 'auto',
            messages: [{ role: 'user', content: judgePrompt }],
            temperature: 0,
            max_tokens: 1024,
          });
          const judgeRaw = messageText(jr.choices?.[0]?.message?.content ?? '');
          const verdicts = parseJudgeResponse(judgeRaw, claims);
          const unsupported = verdicts.filter((v) => !v.supported);
          if (unsupported.length > 0) {
            toolContext.judgeGuardHits = (toolContext.judgeGuardHits ?? 0) + 1;
            console.log(dim(`\n  [CHECK] Semantic judge found ${unsupported.length} claim(s) not supported by cited code.`));
            toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
            messages.push({ role: 'assistant', content: cleanContent });
            messages.push({
              role: 'user',
              content: judgeClaimWarning(unsupported),
            } as ChatMessage);
            return { status: 'continue' };
          }
        } catch (judgeErr) {
          if (process.env.DAEDALUS_DEBUG === 'true') {
            console.log(dim(`  [judge] Layer-2 verification skipped (${String(judgeErr)}).`));
          }
        }
      }
    }
  }

  const noRunClaimed = (!isCasual && !isIdeation)
    ? claimedTestCountWithoutRun(cleanContent, toolContext.lastVerifyPassCount, userTask, messages)
    : null;
  if (noRunClaimed) {
    console.log(dim(`\n  [CHECK] Test-count claim ("${noRunClaimed} passing") made with no real npm test run this session.`));
    toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
    messages.push({ role: 'assistant', content: cleanContent });
    messages.push({
      role: 'user',
      content: claimedTestCountWithoutRunWarning(noRunClaimed),
    } as ChatMessage);
    return { status: 'continue' };
  }

  if (!isIdeation && !isCasual && detectUngroundedWorksClaim(cleanContent, claimLedger)) {
    const worksKey = 'works-claim';
    if (!toolContext.firedCompletionGuards?.has(worksKey)) {
      (toolContext.firedCompletionGuards ??= new Set<string>()).add(worksKey);
      console.log(dim(`\n  [CHECK] "Works/verified" claim made with no live runtime probe (curl/HTTP/integration test) this session.`));
      toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
      messages.push({ role: 'assistant', content: cleanContent });
      messages.push({
        role: 'user',
        content: ungroundedWorksWarning(),
      } as ChatMessage);
      return { status: 'continue' };
    }
  }

  if (!isIdeation && !isCasual && toolContext.lastRuntimeFailure && (detectUngroundedWorksClaim(cleanContent, claimLedger) || isGreenBuildTestClaim(cleanContent))) {
    const rfKey = 'runtime-failure';
    if (!toolContext.firedCompletionGuards?.has(rfKey)) {
      (toolContext.firedCompletionGuards ??= new Set<string>()).add(rfKey);
      const rf = toolContext.lastRuntimeFailure;
      console.log(dim(`\n  [CHECK] Completion claim conflicts with a FAILED run this session — \`${rf.command}\` exited non-zero.`));
      toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
      messages.push({ role: 'assistant', content: cleanContent });
      messages.push({
        role: 'user',
        content:
          `[SYSTEM WARNING] You reported the project works / the CLI ran / build+tests pass, but a terminal run you executed THIS session FAILED: ` +
          `\`${rf.command}\` exited non-zero with: ${rf.error}. A failed run cannot be reported as a success. ` +
          `Either (1) actually re-run the command and confirm a clean exit (code 0) before claiming it works, ` +
          `or (2) report the blocker honestly (paste the error). Do NOT claim green/working from a run that errored.`,
      } as ChatMessage);
      return { status: 'continue' };
    }
  }

  if (readStall.stalled) {
    console.log(dim(`\n  [DONE] Idle re-read stall: same file read ${readStall.readCount} times consecutively with no edit. Closing turn.`));
    return {
      status: 'halt',
      content: `${cleanContent}\n\n[SELF-CORRECT] I re-read the same file ${readStall.readCount} times without making changes — the change is likely already present on disk. Report the actual on-disk state to the user rather than continuing to read.`,
      maxTurnsCause: `stuck re-reading the same file without making changes (idle re-read guard, ${readStall.readCount} reads)`,
      updateVerifyBreaker: true,
    };
  }

  if (isGreenBuildTestClaim(cleanContent) && (verifyBreakerTrippedThisTurn || verifyBreakerTrippedLastTurn)) {
    console.log(dim(`\n  [CHECK] Verifying completion claim — build/test command tripped the circuit breaker; no fresh successful run observed.`));
    toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
    toolContext.verifyBreakerTrippedLastTurn = true;
    messages.push({ role: 'assistant', content: cleanContent });
    messages.push({
      role: 'user',
      content: `[SYSTEM WARNING] You reported the build/tests pass, but the verify command tripped the circuit breaker this session (no progress) and no fresh successful run was observed. Do NOT claim green without re-running the command and seeing a real pass. Either (1) run \`npm run build && npm run test\` again and confirm real output, or (2) report the blocker honestly (e.g. the command hung / was blocked).`,
    } as ChatMessage);
    return { status: 'continue', updateVerifyBreaker: true };
  }

  const testCorrection = fabricatedTestCountCorrection(cleanContent, toolContext.lastVerifyPassCount);
  if (testCorrection) {
    console.log(dim(`\n  [CHECK] Verifying test-count claim — summary count disagrees with last real test run.`));
    toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
    messages.push({ role: 'assistant', content: cleanContent });
    messages.push({
      role: 'user',
      content: testCorrection,
    } as ChatMessage);
    return { status: 'continue', updateVerifyBreaker: true };
  }

  if (isGreenStateClaim(cleanContent) && toolContext.lastVerifyPassed === false) {
    console.log(dim(`\n  [CHECK] Verifying green-state claim — last real verify run this session FAILED.`));
    toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
    messages.push({ role: 'assistant', content: cleanContent });
    messages.push({
      role: 'user',
      content: greenStateWarning(),
    } as ChatMessage);
    return { status: 'continue', updateVerifyBreaker: true };
  }

  return { status: 'pass', updateVerifyBreaker: true };
}
