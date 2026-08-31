import pc from 'picocolors';
import { BUILTIN_TOOLS, POWER_TOOLS } from './tools/definitions.js';
import { executeToolCalls } from './tools/executor.js';
import { getSessionTodos } from './tools/builtin/todo.js';
import { detectFalseCompletion, falseCompletionWarning, detectFalseCompletionOnDisk, isScopeOverstatedSummary, scopeOverstatementWarning, isUnsubstantiatedProgressReport, unsubstantiatedProgressWarning, countAchievementItems, ClaimLedger, detectUngroundedClaim, ungroundedClaimWarning, isGreenStateClaim, greenStateWarning, isUngroundedProjectClaim, ungroundedProjectClaimWarning, isNegativeExistenceClaim, negativeExistenceWarning, isReviewTask, isReviewDeliverable, reviewWithoutInspectionWarning, isReviewWithoutSourceInspection, reviewWithoutSourceInspectionWarning, claimedTestCountWithoutRun, claimedTestCountWithoutRunWarning, detectUngroundedWorksClaim, ungroundedWorksWarning, isUncitedArchClaim, uncitedArchClaimWarning, RUNTIME_EXERCISE_RE } from './agents/completion-guard.js';
import { ReadStallDetector, isGreenBuildTestClaim, fabricatedTestCountCorrection, DivergenceDetector, isStaleReadFailure } from './agents/loop-guards.js';
import { mcpRegistry } from './tools/mcp/registry.js';
import { DaedalusSpinner } from './tools/daedalus-spinner.js';
import { calculateSessionTokens, pruneMessages } from './session/tokens.js';
import { log } from './ui/log.js';
import { parseTextToolCalls, stripToolCallMarkup, openAssistantBlock, writeAssistantChunk, closeAssistantBlock, printContextWarning, printContextResult, printContextPrune, printToolStart, printToolResult, printToolContentPreview, turnGatePrompt } from './formatting.js';
import type { ToolContext, ToolCall, ChatMessage } from './types.js';
import { messageText } from './types.js';
import type { LocalRouter } from './router/index.js';
import { dim, info, ok, warn, err } from './ui/theme.js';

// Render the current session todo progress (completed/total + active task). Used
// after a successful `todo` tool result AND immediately on resume from a max-turn
// checkpoint pause, so the user gets an instant "where we are" signal instead of a
// blank gap while the model thinks. Mirrors the inline block historically printed
// after todo results.
function printTodoProgress(sessionId: string): void {
  const todos = getSessionTodos(sessionId);
  if (todos.length === 0) return;
  const done = todos.filter(t => t.status === 'completed').length;
  const active = todos.find(t => t.status === 'in_progress');
  const activeText = active ? ` | Active: ${active.content.slice(0, 50)}${active.content.length > 50 ? '...' : ''}` : '';
  console.log(info(`\n  [TODO] Progress: ${done}/${todos.length} completed${activeText}`));
}
import type { DaedalusConfig } from './config/index.js';
import { maskSecrets } from './security/secret-detector.js';
import { classifyTaskStart, stepRouting, floorForTask } from './router/complexity.js';
import { globalSessionStats } from './session/analytics.js';

const TOOL_RESULT_MAX_CHARS = 32_000;
const MAX_TOOL_TURNS = 40;
// Deterministic, non-retryable read failures: the path genuinely does not exist.
// A re-read is guaranteed to fail, so the agent loop must treat it as a hard
// "file missing" signal rather than a transient error to retry.
const FILE_NOT_FOUND_RE = /file not found|does not exist|enoent|no such file/i;

let _turnStartTime = 0;

function countToolMentions(text: string): number {
  const lower = text.toLowerCase();
  const mentioned = new Set<string>();
  for (const def of [...BUILTIN_TOOLS, ...POWER_TOOLS]) {
    const name = def.function.name;
    if (lower.includes(name) || lower.includes(name.replace(/_/g, ''))) mentioned.add(name);
  }
  return mentioned.size;
}

export function getTurnStartTime(): number {
  return _turnStartTime;
}

export let currentAbortController: AbortController | null = null;
let turnAborted = false;

// Max idle time waiting for the next streamed chunk before treating the upstream
// connection as hung and retrying the turn non-streaming. Prevents a stalled SSE
// stream (no error, no [DONE]) from blocking the agentic loop forever.
const STREAM_READ_TIMEOUT_MS = 90_000;

export function abortTurn(): void {
  turnAborted = true;
  if (currentAbortController) {
    currentAbortController.abort();
  }
}

export function resetTurnAborted(): void {
  turnAborted = false;
  currentAbortController = null;
}

export function isTurnAborted(): boolean {
  return turnAborted;
}

function truncateToolResult(content: string): string {
  if (content.length <= TOOL_RESULT_MAX_CHARS) return content;
  const kept = content.slice(0, TOOL_RESULT_MAX_CHARS);
  const dropped = content.length - TOOL_RESULT_MAX_CHARS;
  return `${kept}\n... [truncated ${dropped} chars — use read_file with offset/limit to see more]`;
}

function failureSignature(name: string, rawArgs: string): string {
  try {
    const parsed = JSON.parse(rawArgs || '{}') as Record<string, unknown>;
    const key = typeof parsed.path === 'string' ? parsed.path
      : typeof parsed.file === 'string' ? parsed.file
      : typeof parsed.command === 'string' ? parsed.command
      : typeof parsed.package === 'string' ? parsed.package
      : '';
    return key ? `${name}:${key}` : name;
  } catch {
    return name;
  }
}

export function detectRepetition(text: string): boolean {
  if (text.length < 150) return false;
  const tail = text.slice(-1200);

  // Check 1: Paragraph / line repetition loop (e.g. repeated closing sentences or </think> blocks)
  const paragraphs = tail.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length >= 25);
  const pCounts: Record<string, number> = {};
  for (const p of paragraphs) {
    pCounts[p] = (pCounts[p] || 0) + 1;
    if (pCounts[p] >= 3) return true;
  }

  // Check 2: Long substring repetition loop across the tail window.
  // Uses a 60-char minimum (was 30). A 30-char span is too tight: normal report
  // boilerplate — e.g. a Markdown table column repeating "Healthy - actively
  // maintained" once per row — trips it and aborts legitimate work (a real audit
  // that lists dependencies). A 60-char exact repeat is almost never natural prose;
  // it signals a genuine loop (the model re-emitting a long verbatim span).
  const len = 60;
  const counts: Record<string, number> = {};
  for (let i = 0; i <= tail.length - len; i++) {
    const sub = tail.substring(i, i + len);
    counts[sub] = (counts[sub] || 0) + 1;
  }
  for (const sub of Object.keys(counts)) {
    if (!/[a-zA-Z]{3,}/.test(sub)) continue;
    let occurrences = 0;
    let pos = tail.indexOf(sub);
    while (pos !== -1) {
      occurrences++;
      pos = tail.indexOf(sub, pos + len);
    }
    if (occurrences >= 3) {
      return true;
    }
  }
  return false;
}

export interface ModelDeps {
  messages: ChatMessage[];
  config: DaedalusConfig;
  router: LocalRouter;
  toolContext: ToolContext;
  buildFileContext: () => string;
  askLine: (prompt: string) => Promise<string>;
  refreshSystemPrompt?: () => void;
}

function ensureAbortController(): AbortController {
  const c = new AbortController();
  if (turnAborted) {
    c.abort();
  } else {
    currentAbortController = c;
  }
  return c;
}

function clearAbortController(): void {
  currentAbortController = null;
}

// Streaming response handler with tool call support — iterative, not recursive
export function createModelFunctions(deps: ModelDeps) {
  const { messages, config, router, toolContext, buildFileContext, askLine, refreshSystemPrompt } = deps;

  // Capture the original user task (first user message in the conversation) so the
  // inspection-before-review gate can tell whether this session is a "review the project"
  // request. Used by the hard guard that halts a multi-section review produced with zero
  // file observations this session.
  const userTask =
    messageText(messages.find((m) => m.role === 'user')?.content ?? '') ?? '';

  async function callModelWithTools(
    userContent: string,
    imageBase64?: string,
  ): Promise<{ content: string; toolCalls: ToolCall[] }> {
    refreshSystemPrompt?.();
    let repetitionAborted = false;
    if (userContent) {
      if (imageBase64) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: userContent },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
          ],
        });
      } else {
        messages.push({ role: 'user', content: userContent });
      }
    }

    // Auto-pruning check based on config context limit
    const maxT = config?.context?.maxTokens ?? 128000;
    const summarizeAt = config?.context?.summarizeAt ?? 0.8;
    const threshold = Math.floor(maxT * summarizeAt);

    const complexityEnabled = config?.router?.complexityRouting !== false && !config.modelOverride;
    const taskComplexity = complexityEnabled ? classifyTaskStart(userContent || '') : undefined;
    // Floor: build-fix / refactor / multi-file tasks must not be demoted to a
    // weak "standard" model (see complexity.ts KEEP_ON_INTELLIGENCE_KEYWORDS).
    const complexityFloor = complexityEnabled ? floorForTask(userContent || '') : undefined;
    if (taskComplexity && process.env.DAEDALUS_DEBUG === 'true') {
      console.log(dim(`  [ROUTE] Task classified as ${taskComplexity}`));
    }

    const fileCtx = buildFileContext();
    const tokens = calculateSessionTokens(messages, fileCtx);
    if (tokens.total > threshold) {
      printContextWarning(Math.round(summarizeAt * 100));
      const target = Math.floor(maxT * 0.6);

      // Step 1: Try LLM-based summarization before hard pruning
      const { summarizeMessages } = await import('./session/summarize.js');
      const summarizeFn = async (sysPrompt: string, userContent: string): Promise<string> => {
        try {
          const resp = await router.chat.completions.create({
            model: 'intelligence',
            messages: [
              { role: 'system', content: sysPrompt },
              { role: 'user', content: userContent },
            ],
            temperature: 0.3,
            max_tokens: 600,
          });
          return messageText(resp.choices[0]?.message?.content ?? '');
        } catch {
          return '';
        }
      };

      const summaryResult = await summarizeMessages(messages, target, summarizeFn);
      if (summaryResult.summarizedTurns > 0) {
        printContextResult(summaryResult.summarizedTurns, Math.round(summaryResult.savedTokens / 1000));
      }

      // Step 2: If still over budget, hard prune the rest
      const tokensAfterSummary = calculateSessionTokens(messages, fileCtx);
      if (tokensAfterSummary.total > target) {
        const pruneResult = pruneMessages(messages, fileCtx, target);
        if (pruneResult.prunedTurns > 0 || pruneResult.truncatedTools > 0) {
          printContextPrune(pruneResult.prunedTurns, pruneResult.truncatedTools, Math.round(pruneResult.savedTokens / 1000));
        }
      }
    }

    const allTools = [...BUILTIN_TOOLS, ...POWER_TOOLS, ...mcpRegistry.getToolDefinitions()];

    _turnStartTime = Date.now();

    let lastContent = '';
    let toolTurnsRemaining = MAX_TOOL_TURNS;
    let consecutiveToolFailures = 0;
    const failureCounts = new Map<string, number>();
    // Detects a WRITE-TOOL failure that is a syntax/revert loop. A circuit breaker on a
    // patch/write_file (streak >= 2) is, by definition, a repeated failed-edit loop — almost
    // always invalid syntax the tool reverted. These must NOT escalate to a stronger model
    // (that does not fix a syntax-emitting model); they need a strategy change (read_file +
    // minimal targeted patch). NOTE: scoped to write tools ONLY — a terminal circuit breaker
    // (e.g. "npm run failed 2 consecutive times") is a build/test failure, not a syntax loop,
    // and must NOT be classified as one or the agent will re-issue `npm test` against the
    // breaker instead of reading the compiler error and fixing the code.
    const isWriteToolSyntaxLoop = (name: string, errText: string): boolean =>
      ['patch', 'write_file'].includes(name) &&
      /syntax error|revert|invalid (ts|typescript)|unexpected token|expected\b|patch failed \d+ consecutive/i.test(errText);
    const executedToolNames = new Set<string>();
    // Layer B: idle re-read breaker. A turn that reads the same file many times with no
    // intervening write is usually "the fix was already present" spinning on re-reads.
    // Short-circuit it before it burns minutes of wall-clock + model budget.
    const readStall = new ReadStallDetector(15);
    // Divergence detector: if the agent emits output near-identical to a prior block this
    // turn (the "re-state the review after a failure" spin), force it to make concrete
    // progress or report the blocker honestly instead of looping on repeated text.
    const divergence = new DivergenceDetector();
    // Claim-grounding ledger: records every file the agent actually inspected this
    // session (read/searched/terminal-touched). Used to flag factual claims about
    // files it never looked at (bare overclaims like "X is unused / already
    // implemented / has no errors"). Session-scoped: persisted on toolContext so a
    // file read in one turn credits a claim made in a later turn (the audit-then-
    // report pattern). Recreating it per turn would wipe prior reads and make the
    // guard falsely flag grounded claims as "ungrounded (no inspection this session)".
    const claimLedger = toolContext.claimLedger ?? new ClaimLedger();
    toolContext.claimLedger = claimLedger;
    // Layer C: verification-claim guard. Set true if a build/test/lint verify command
    // trips the terminal circuit breaker this turn; cleared by a real successful run.
    let verifyBreakerTrippedThisTurn = false;
    let verifyBreakerTrippedLastTurn = toolContext.verifyBreakerTrippedLastTurn ?? false;
    const CIRCUIT_BREAKER_RE = /\[CIRCUIT BREAKER\][^\n]*unchanged with no progress/i;
    const signatureHistory: string[] = [];
    let pinnedModel: string | undefined;
    let escalationCount = 0;
    let escalatedThisStreak = false;
    let currentComplexity = taskComplexity;
    let totalCompletionTokens = 0;
    let hasDowngraded = false;
    let trivialTurnStreak = 0;
    let turnUsageOut: number | undefined;
    openAssistantBlock();
    const overallStart = Date.now();
    let totalToolCalls = 0;
    // Hoisted so the max-tool-turns checkpoint can diagnose WHY turns were exhausted
    // (scan the last turn's failures for circuit-breaker / auth / timeout patterns).
    let lastFailedResults: { error?: string | null; content?: string | null }[] = [];

    // Diagnose WHY the budget was exhausted so the outcome can be recorded as useful
    // knowledge (not a bare "Agent reached max turns" stub). Patterns, in priority:
    // circuit-breaker loop, API/auth/timeout stalls, model-escalation churn, verify
    // loop, repeated tool failures, or a natural checkpoint on a large task.
    const computeMaxTurnsCause = (): string => {
      const diagText = (r: { error?: string | null; content?: string | null }) =>
        `${r.error ?? ''}\n${r.content ?? ''}`;
      const breakerHit = lastFailedResults.find(r => /\[CIRCUIT BREAKER\]/i.test(diagText(r)));
      const authHit = lastFailedResults.find(r =>
        /401|403|invalid api key|unauthorized|ECONNREFUSED|ETIMEDOUT|timed out|timeout/i.test(diagText(r)));
      if (breakerHit) {
        return `circuit breaker on a repeated failed command (loop/retry guard) — ${String(breakerHit.error ?? '').split('\n')[0].slice(0, 120)}`;
      }
      if (authHit) {
        return `API/auth or timeout stalls — ${String(authHit.error ?? '').split('\n')[0].slice(0, 120)}`;
      }
      if (escalatedThisStreak) {
        return 'repeated tool failures triggered model-escalation churn (context re-primed mid-task)';
      }
      if (verifyBreakerTrippedThisTurn) {
        return 'verification command tripped the terminal circuit breaker (no real build/test run this turn)';
      }
      if (consecutiveToolFailures >= 3) {
        return `repeated tool failures (${consecutiveToolFailures} consecutive) without progress`;
      }
      return 'natural checkpoint — budget exhausted on a large or legitimate multi-step task (user continued or stopped)';
    };

    while (true) {
      if (toolTurnsRemaining <= 0) {
        closeAssistantBlock(lastContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier, { showCost: config.ui?.showCost, selfCorrections: toolContext.selfCorrectionCount });
        console.log(`\n  ${info('[INFO]')} ${dim(`Reached max tool turns (${MAX_TOOL_TURNS}). Pausing to checkpoint.`)}`);
        toolContext.maxTurnsCause = computeMaxTurnsCause();
        const executedSummary = executedToolNames.size > 0 ? [...executedToolNames].join(', ') : 'none';
        console.log(`  ${dim(`[SUMMARY] ${totalToolCalls} tool call(s) executed: ${executedSummary}`)}`);
        if (process.stdin.isTTY) {
          const answer = await (toolContext.askLine || askLine)(`  Continue working? [y]es / [n]o: `);
          if (answer.trim().toLowerCase().startsWith('y')) {
            console.log(ok('  [OK] Continuing with a fresh turn budget.'));
            // Surface immediate progress so the resume isn't a silent blank gap
            // while the model thinks (especially on slow models). Shows exactly
            // where the work resumes.
            printTodoProgress(toolContext.sessionId);
            toolTurnsRemaining = MAX_TOOL_TURNS;
            consecutiveToolFailures = 0;
            continue;
          }
        }
        console.log(dim('  [INFO] Stopping. Type "continue" to resume.'));
        messages.push({ role: 'assistant', content: lastContent });
        return { content: lastContent, toolCalls: [] };
      }

      if (turnAborted) {
        closeAssistantBlock(lastContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier, { showCost: config.ui?.showCost, selfCorrections: toolContext.selfCorrectionCount });
        console.log(dim('\n  [STOP] Stopped'));
        return { content: lastContent, toolCalls: [] };
      }
      turnUsageOut = undefined;
      const thinkingStyle = DaedalusSpinner.getThinkingStyle(config.ui?.spinner);
      const spinner = new DaedalusSpinner({
        text: 'Daedalus thinking',
        frames: thinkingStyle.frames,
        color: thinkingStyle.color,
        minDurationMs: 450,
      });
      spinner.start();

      let fullContent = '';
      const toolCallMap: Map<number, ToolCall> = new Map();
      let blockOpened = false;

      const openBlock = () => {
        if (!blockOpened) {
          blockOpened = true;
          spinner.stop();
        }
      };

      const signal = ensureAbortController().signal;
      let streamTimedOut = false;
      let streamReadTimer: ReturnType<typeof setTimeout> | null = null;
      const resetStreamReadTimer = () => {
        if (streamReadTimer) clearTimeout(streamReadTimer);
        streamReadTimer = setTimeout(() => {
          streamTimedOut = true;
          currentAbortController?.abort();
        }, STREAM_READ_TIMEOUT_MS);
      };
      resetStreamReadTimer();

      try {
        const stream = await router.chatStream({
          model: pinnedModel || config.modelOverride || 'auto',
          complexity: pinnedModel ? undefined : currentComplexity,
          messages,
          temperature: 0.1,
          tools: allTools,
          tool_choice: 'auto',
          stream: true,
          max_tokens: 4096,
          signal,
        });

        for await (const chunk of stream) {
          resetStreamReadTimer();
          if (signal.aborted) break;
          const u = (chunk as { usage?: { completion_tokens?: number } } | undefined)?.usage;
          if (u && typeof u.completion_tokens === 'number') turnUsageOut = u.completion_tokens;
          const choice = chunk.choices[0];
          if (!choice) continue;

          const delta = choice.delta;

          if (delta.content) {
            fullContent += delta.content;

            if (detectRepetition(fullContent)) {
              openBlock();
              writeAssistantChunk(err('\n\n[STOP] Repetition loop detected. Aborting stream.'));
              repetitionAborted = true;
              currentAbortController?.abort();
              break;
            }
          }

          if (delta.tool_calls) {
            openBlock();
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0;
              if (!toolCallMap.has(index)) {
                toolCallMap.set(index, {
                  id: tc.id ?? `call_${Date.now()}_${index}`,
                  type: 'function',
                  function: { name: '', arguments: '' },
                });
              }
              const call = toolCallMap.get(index)!;
              if (tc.function?.name) call.function.name = tc.function.name;
              if (tc.function?.arguments) call.function.arguments += tc.function.arguments;
            }
          }

          if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop' || choice.finish_reason === 'length') {
            break;
          }
        }

        if (streamReadTimer) clearTimeout(streamReadTimer);

        if (!blockOpened) spinner.stop();

        if (signal.aborted) {
          openBlock();
          closeAssistantBlock((lastContent || fullContent).length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier, { showCost: config.ui?.showCost, selfCorrections: toolContext.selfCorrectionCount });
          console.log(dim('\n  [STOP] Stopped'));
          clearAbortController();
          return { content: fullContent, toolCalls: [] };
        }

      } catch (error) {
        if (streamReadTimer) clearTimeout(streamReadTimer);
        // A stream-read timeout is retryable (treat like a dropped stream), not a user stop.
        if (signal.aborted && !streamTimedOut) {
          spinner.stop();
          closeAssistantBlock((lastContent || fullContent).length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier);
          console.log(dim('\n  [STOP] Stopped'));
          clearAbortController();
          return { content: repetitionAborted ? fullContent : '', toolCalls: [] };
        }
        if (streamTimedOut) {
          console.log(warn(`\n  ${pc.bold('[WARN]')} Stream read timed out after ${STREAM_READ_TIMEOUT_MS}ms — retrying non-streaming`));
        }
        spinner.stop();
        const firstLine = (error instanceof Error ? error.message : String(error)).split('\n')[0];
        console.log(warn(`\n  ${pc.bold('[WARN]')} Error calling model: ${firstLine}`));
        console.log(dim(`         (Tip: Run /doctor to diagnose connection or loading issues)`));
        // Streaming call failed (e.g. upstream connection dropped mid-stream). Rather than
        // degrade to the one-shot text-only fallback (which cannot execute tools and stalls
        // agentic work), retry this turn ONCE with a non-streaming, tool-enabled call so the
        // agentic loop stays alive. Provider-neutral: works for any OpenAI-compatible endpoint.
        try {
          console.log(dim('         Retrying turn non-streaming with tools enabled...'));
          const retrySignal = new AbortController();
          const retry = await router.chat.completions.create({
            model: pinnedModel || config.modelOverride || 'auto',
            complexity: pinnedModel ? undefined : currentComplexity,
            messages,
            temperature: 0.1,
            tools: allTools,
            tool_choice: 'auto',
            max_tokens: 4096,
            signal: retrySignal.signal,
          });
          const msg = retry.choices?.[0]?.message;
          const retryContent = messageText(msg?.content ?? '');
          let retryCalls: ToolCall[] = [];
          if (msg?.tool_calls && msg.tool_calls.length > 0) {
            retryCalls = msg.tool_calls.map((tc: { id?: string; function?: { name?: string; arguments?: string } }, i: number) => ({
              id: tc.id ?? `retry_${Date.now()}_${i}`,
              type: 'function',
              function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '' },
            }));
          } else {
            const parsed = parseTextToolCalls(retryContent);
            if (parsed.length > 0) retryCalls = parsed;
          }
          if (retryCalls.length > 0) {
            messages.push({ role: 'assistant', content: retryContent || `[tool calls: ${retryCalls.map(c => c.function.name).join(', ')}]` });
            const results = await executeToolCalls(retryCalls, toolContext);
            for (let i = 0; i < retryCalls.length; i++) {
              const rc = retryCalls[i];
              const res = results[i];
              const resText = typeof res === 'string' ? res : JSON.stringify(res ?? {});
              messages.push({ role: 'tool', tool_call_id: rc.id, content: resText });
            }
            totalToolCalls += retryCalls.length;
            continue;
          }
          // No tool calls on retry: fall through to the normal text handling below.
          fullContent = retryContent;
          lastContent = stripToolCallMarkup(retryContent);
        } catch (retryErr) {
          const retryLine = (retryErr instanceof Error ? retryErr.message : String(retryErr)).split('\n')[0];
          console.log(warn(`\n  ${pc.bold('[WARN]')} Non-streaming retry also failed: ${retryLine}`));
          throw error;
        }
      }

      clearAbortController();

      if (turnUsageOut === undefined || turnUsageOut < Math.ceil(fullContent.length / 4)) {
        turnUsageOut = Math.ceil(fullContent.length / 4);
      }

      let toolCallArray = Array.from(toolCallMap.values()).filter(tc => tc.function.name);
      if (toolCallArray.length === 0) {
        const parsedCalls = parseTextToolCalls(fullContent);
        if (parsedCalls.length > 0) {
          toolCallArray = parsedCalls;
        }
      }
      const cleanContent = stripToolCallMarkup(fullContent);
      lastContent = cleanContent;

      // Divergence guard: if this assistant block is near-identical to one already emitted
      // this turn (and it produced no new tool calls — i.e. it's just re-stating work), force
      // the agent to either change the repo or report the blocker honestly. The FIRST repeat
      // is a soft warning; a SECOND consecutive repeat is a runaway loop — halt the turn.
      // NOTE: We exempt rewrites following guard warnings/file-missing errors and substantive
      // review deliverables (audits/assessments), because the model is delivering the requested
      // analysis and not trapped in an infinite modification loop.
      const hasRecentGuardWarning = messages.slice(-6).some((m) =>
        typeof m.content === 'string' &&
        (m.content.startsWith('[SYSTEM WARNING]') || m.content.startsWith('[FILE-MISSING]') || m.content.startsWith('[CHECK]'))
      );
      const isReviewContent = isReviewDeliverable(cleanContent);
      if (!hasRecentGuardWarning && !isReviewContent && toolCallArray.length === 0 && divergence.register(cleanContent)) {
        const repeats = divergence.consecutiveRepeats;
        if (repeats >= 2) {
          openBlock();
          closeAssistantBlock(cleanContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier, { showCost: config.ui?.showCost, selfCorrections: toolContext.selfCorrectionCount });
          console.log(dim(`\n  [STOP] Runaway loop: same output re-emitted ${repeats} times with no progress. Closing turn.`));
          toolContext.maxTurnsCause = 'repeated identical output without progress (repetition guard tripped) — the agent emitted the same response multiple times';
          return { content: `${cleanContent}\n\n[SELF-CORRECT] I repeated the same output ${repeats} times without making progress. I am stopping this turn rather than looping.`, toolCalls: [] };
        }
        console.log(dim(`\n  [CHECK] Detected near-duplicate of prior output — not making progress.`));
        toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
        messages.push({ role: 'assistant', content: cleanContent });
        messages.push({
          role: 'user',
          content: `[SYSTEM WARNING] This response is nearly identical to output you already produced this turn. You are looping on repeated text instead of making progress. Do NOT re-state completed work. Either (1) take a concrete next action (read the failing test, fix the code, verify), or (2) if you are blocked, report the blocker concisely and stop.`,
        } as ChatMessage);
        continue;
      }

      // Claim-grounding guard: flag a factual claim about a repo artifact the agent never
      // inspected this session (no read/search/terminal on that file). Catches bare
      // overclaims like "path/url are unused" or "rate limiting is already implemented"
      // that have no tool evidence behind them. Forces the agent to verify before asserting.
      if (toolCallArray.length === 0) {
        const ungrounded = detectUngroundedClaim(cleanContent, claimLedger);
        if (ungrounded) {
          const key = `claim:${ungrounded}`;
          if (toolContext.firedCompletionGuards?.has(key)) continue;
          (toolContext.firedCompletionGuards ??= new Set<string>()).add(key);
          console.log(dim(`\n  [CHECK] Claim about ${ungrounded} is ungrounded (no inspection this session).`));
          toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
          messages.push({ role: 'assistant', content: cleanContent });
          messages.push({
            role: 'user',
            content: ungroundedClaimWarning(ungrounded),
          } as ChatMessage);
          continue;
        }
      }

      // Project-level claim guard (broadens #138): flag a claim that the project HAS a
      // feature/dependency the agent never observed in tool output this session (no file
      // read/search/terminal mentioning it). Catches the "review a codebase you never opened"
      // failure where the agent invents helmet / circuit-breaker / favorites / glassmorphism
      // etc. — none of which name a file, so the file-paired guard above cannot catch them.
      if (toolCallArray.length === 0) {
        const projClaim = isUngroundedProjectClaim(cleanContent, claimLedger);
        if (projClaim) {
          const key = `proj:${projClaim}`;
          if (toolContext.firedCompletionGuards?.has(key)) continue;
          (toolContext.firedCompletionGuards ??= new Set<string>()).add(key);
          console.log(dim(`\n  [CHECK] Project claim about "${projClaim}" is ungrounded (never observed this session).`));
          toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
          messages.push({ role: 'assistant', content: cleanContent });
          messages.push({
            role: 'user',
            content: ungroundedProjectClaimWarning(projClaim),
          } as ChatMessage);
          continue;
        }
        // Negative-existence guard: the agent asserts a config/dependency/file is
        // MISSING/ABSENT without ever running a search/list/grep this session. Asserting
        // absence requires the same grounding as asserting presence.
        const negClaim = isNegativeExistenceClaim(cleanContent, claimLedger);
        if (negClaim) {
          const key = `neg:${negClaim}`;
          if (toolContext.firedCompletionGuards?.has(key)) continue;
          (toolContext.firedCompletionGuards ??= new Set<string>()).add(key);
          console.log(dim(`\n  [CHECK] Claim that "${negClaim}" is missing is ungrounded (no search/list run this session).`));
          toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
          messages.push({ role: 'assistant', content: cleanContent });
          messages.push({
            role: 'user',
            content: negativeExistenceWarning(negClaim),
          } as ChatMessage);
          continue;
        }
      }

      if (toolCallArray.length === 0) {
        // Only treat this as a "planned but omitted JSON" failure when the model
        // actually emitted tool-call markup (the structured <tool_call> block) but
        // no parseable JSON. A bare mention of tool names in prose (e.g. an audit
        // report saying "I ran read_file and terminal") must NOT trip this — that
        // is normal narration, and forcing a retry loops on a finished report.
        const narratedToolCalls = parseTextToolCalls(fullContent);
        if (narratedToolCalls.length >= 1) {
          console.log(dim(`\n  [RETRY] Model planned tools but emitted no valid JSON. Re-issuing the request.`));
          totalCompletionTokens += turnUsageOut ?? 0;
          messages.push({
            role: 'user',
            content: `[SYSTEM WARNING] You emitted a <tool_call> block but it was not valid JSON. Please output the proper JSON array of tool calls now.`,
          } as ChatMessage);
          continue;
        }

        if (currentComplexity && process.env.DAEDALUS_DEBUG === 'true') {
          console.log(dim(`  [ROUTE] Task summary: start ${taskComplexity ?? 'n/a'} → end ${currentComplexity} | ${totalCompletionTokens + (turnUsageOut ?? 0)} output tokens | ${escalationCount} escalation(s)`));
        }

        // Hard guard: do not let the agent end the turn claiming whole-task
        // completion while its todo list still has open items. A false "done"
        // report would mislead an end user who trusts it. Force reconciliation.
        const closingTodos = getSessionTodos(toolContext.sessionId);
        if (closingTodos.length > 0 && detectFalseCompletion(cleanContent, closingTodos)) {
          const remaining = closingTodos.filter((t) => t.status !== 'completed').length;
          console.log(dim(`\n  [CHECK] Verifying completion claim — ${remaining} todo(s) still open.`));
          toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
          messages.push({ role: 'assistant', content: cleanContent });
          messages.push({
            role: 'user',
            content: falseCompletionWarning(remaining),
          } as ChatMessage);
          continue;
        }

        // Hard guard (on-disk): do not let the agent claim a fix/completion for a file it
        // only ever reverted patches against this session and never successfully wrote.
        // Catches the false "All issues resolved" report where the edit was attempted but
        // reverted by the syntax guard and never actually landed on disk.
        const falselyClaimed = detectFalseCompletionOnDisk(cleanContent, toolContext);
        if (falselyClaimed) {
          console.log(dim(`\n  [CHECK] Verifying completion claim — no successful patch to ${falselyClaimed} this session (only reverts).`));
          toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
          messages.push({ role: 'assistant', content: cleanContent });
          messages.push({
            role: 'user',
            content: `[SYSTEM WARNING] You claimed a fix/completion involving ${falselyClaimed}, but this session has NO successful patch to that file — only patches the syntax guard reverted. Reconcile with disk reality: either (1) actually apply and verify the change (run build/test and confirm it on disk), or (2) report the blocker honestly instead of claiming it is done. Do NOT report completion for changes that were not written.`,
          } as ChatMessage);
          continue;
        }

        // Hard guard (scope): do not let a closing summary present a deliverable checklist
        // ("Task 1 ... Task 3 ...") as complete while the todo list still has open items. That
        // is a scope over-statement (e.g. relabeling a partial feature as fully shipped). Force
        // the summary to be scoped to what actually landed or honestly mark the partial items.
        const scopeTodos = getSessionTodos(toolContext.sessionId);
        if (scopeTodos.length > 0 && isScopeOverstatedSummary(cleanContent, scopeTodos)) {
          const remaining = scopeTodos.filter((t) => t.status !== 'completed').length;
          console.log(dim(`\n  [CHECK] Verifying completion claim — summary enumerates tasks as done but ${remaining} todo(s) still open.`));
          toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
          messages.push({ role: 'assistant', content: cleanContent });
          messages.push({
            role: 'user',
            content: scopeOverstatementWarning(remaining),
          } as ChatMessage);
          continue;
        }

        // Hard guard (unsubstantiated progress): do not let a turn end with a deliverable
        // checklist of completed work (✅ lists / numbered / bulleted achievement lists) that
        // has no task tracker reconciling it AND no on-disk verification per claim. This is the
        // "Current State Analysis: ✅ X / ✅ Y / Key Improvements Made: 1... 2... 3..." shape that
        // slips past the todo-gated guards whenever the agent didn't use the todo tool. Force the
        // agent to reconcile each claimed item with disk reality before concluding.
        if (isUnsubstantiatedProgressReport(cleanContent)) {
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
            continue;
          }
        }

        // Inspection-before-review gate: when the session is a "review the project" request
        // and the agent produces a multi-section review deliverable with ZERO file observations
        // this session, it is reviewing a codebase it never opened. Halt the turn and force a
        // real inspection instead of letting a fabricated review loop. (Catches the runaway
        // "fabricated review from a single passing typecheck" failure at the first deliverable.)
        if (isReviewTask(userTask) && isReviewDeliverable(cleanContent) && claimLedger.totalObservations === 0) {
          openBlock();
          closeAssistantBlock(cleanContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier, { showCost: config.ui?.showCost, selfCorrections: toolContext.selfCorrectionCount });
          toolContext.maxTurnsCause = 'produced a review deliverable with zero file inspections this session (review-without-inspection guard)';
          console.log(dim(`\n  [STOP] Review produced with zero file inspections this session — halting.`));
          return { content: `${cleanContent}\n\n[SELF-CORRECT] I described the project's architecture/features but have not inspected a single file this session. I am stopping rather than fabricating a review. I should read the code before reviewing.`, toolCalls: [] };
        }

        // Fix 1: Upgraded review gate — reading only walkthrough.md / README.md does NOT
        // satisfy the inspection requirement. Require at least MIN_SOURCE_READS real source
        // files (.ts/.js/.py/etc.) before a multi-section review deliverable is allowed.
        if (isReviewTask(userTask) && isReviewWithoutSourceInspection(cleanContent, claimLedger)) {
          const srcCount = claimLedger.sourceFileObservations;
          console.log(dim(`\n  [CHECK] Review deliverable produced after reading only ${srcCount} source file(s) — insufficient inspection.`));
          toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
          messages.push({ role: 'assistant', content: cleanContent });
          messages.push({
            role: 'user',
            content: reviewWithoutSourceInspectionWarning(srcCount),
          } as ChatMessage);
          continue;
        }

        // Audit-hallucination hardening: a review deliverable that makes structural claims
        // (architecture / type-safety / entry point / "no any leakage" / "patch tool used
        // for all modifications" / etc.) but cites NO source location must be challenged.
        // Vague, uncited praise is exactly what a self-audit fabricates; force a file:line or
        // an explicit "this is a high-level impression" framing. Gated to reviews only.
        if (isReviewTask(userTask)) {
          const archTerm = isUncitedArchClaim(cleanContent);
          if (archTerm) {
            const key = `arch:${archTerm}`;
            if (toolContext.firedCompletionGuards?.has(key)) continue;
            (toolContext.firedCompletionGuards ??= new Set<string>()).add(key);
            console.log(dim(`\n  [CHECK] Review makes uncited structural claim "${archTerm}" (no file:line).`));
            toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
            messages.push({ role: 'assistant', content: cleanContent });
            messages.push({
              role: 'user',
              content: uncitedArchClaimWarning(archTerm),
            } as ChatMessage);
            continue;
          }
        }

        // Fix 3: Test-count claim without any real npm test run this session. Fires when the
        // agent asserts a specific passing count (e.g. "9 tests passing") but lastVerifyPassCount
        // is undefined (no real test run was observed). Prevents walkthrough-sourced count invention.
        const noRunClaimed = claimedTestCountWithoutRun(cleanContent, toolContext.lastVerifyPassCount);
        if (noRunClaimed) {
          console.log(dim(`\n  [CHECK] Test-count claim ("${noRunClaimed} passing") made with no real npm test run this session.`));
          toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
          messages.push({ role: 'assistant', content: cleanContent });
          messages.push({
            role: 'user',
            content: claimedTestCountWithoutRunWarning(noRunClaimed),
          } as ChatMessage);
          continue;
        }

        // Runtime-exercise guard: block a "feature is wired in / working / verified" claim
        // when no live integration probe (curl/HTTP/integration test) was recorded this
        // session. A green typecheck/unit-test suite does NOT prove a newly-wired integration
        // functions — the graded run built an endpoint, reported "wired in" after tests passed,
        // and it was actually broken until the user exercised it. Forces real verification.
        if (detectUngroundedWorksClaim(cleanContent, claimLedger)) {
          // Debounce: the same "works/verified without a probe" claim must not be
          // re-flagged every turn — that trains the user/model to ignore the guard.
          // Fire once per session (recorded in firedCompletionGuards), then stop; the
          // divergence/repetition guard closes any remaining loop.
          const worksKey = 'works-claim';
          if (toolContext.firedCompletionGuards?.has(worksKey)) {
            continue;
          }
          (toolContext.firedCompletionGuards ??= new Set<string>()).add(worksKey);
          console.log(dim(`\n  [CHECK] "Works/verified" claim made with no live runtime probe (curl/HTTP/integration test) this session.`));
          toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
          messages.push({ role: 'assistant', content: cleanContent });
          messages.push({
            role: 'user',
            content: ungroundedWorksWarning(),
          } as ChatMessage);
          continue;
        }

        // Layer A2: runtime-failure-aware completion block. The agent's OWN terminal run of the
        // built artifact (node dist/cli.js, npm run start, a runtime probe) exited non-zero with a
        // hard error this session, yet it still claims the project "works" / "CLI executed" /
        // "verified" / "build+tests pass". A failed run cannot be reported as success. Block once
        // per session and force a real re-run or an honest blocker report. This is the gap that
        // let the greenfield run declare "Project Complete ✅" from a crashed CLI.
        if (toolContext.lastRuntimeFailure && (detectUngroundedWorksClaim(cleanContent, claimLedger) || isGreenBuildTestClaim(cleanContent))) {
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
            continue;
          }
        }

        // Layer B: idle re-read breaker. If the turn spent its budget re-reading the same
        // file (the "fix was already present" spin) with no edit, force it to report the
        // blocker honestly instead of looping. Close the turn with a concise note.
        if (readStall.stalled) {
          openBlock();
          closeAssistantBlock(cleanContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier, { showCost: config.ui?.showCost, selfCorrections: toolContext.selfCorrectionCount });
          console.log(dim(`\n  [DONE] Idle re-read stall: same file read ${readStall.readCount} times consecutively with no edit. Closing turn.`));
          toolContext.verifyBreakerTrippedLastTurn = verifyBreakerTrippedThisTurn || verifyBreakerTrippedLastTurn;
          toolContext.maxTurnsCause = `stuck re-reading the same file without making changes (idle re-read guard, ${readStall.readCount} reads)`;
          return { content: `${cleanContent}\n\n[SELF-CORRECT] I re-read the same file ${readStall.readCount} times without making changes — the change is likely already present on disk. Report the actual on-disk state to the user rather than continuing to read.`, toolCalls: [] };
        }

        // Layer C: verification-claim guard. Block a green build/test claim when the verify
        // command tripped the circuit breaker this turn (or last turn) and no fresh
        // successful run cleared it — forces a real re-run or an honest blocker report.
        if (isGreenBuildTestClaim(cleanContent) && (verifyBreakerTrippedThisTurn || verifyBreakerTrippedLastTurn)) {
          console.log(dim(`\n  [CHECK] Verifying completion claim — build/test command tripped the circuit breaker; no fresh successful run observed.`));
          toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
          toolContext.verifyBreakerTrippedLastTurn = true;
          messages.push({ role: 'assistant', content: cleanContent });
          messages.push({
            role: 'user',
            content: `[SYSTEM WARNING] You reported the build/tests pass, but the verify command tripped the circuit breaker this session (no progress) and no fresh successful run was observed. Do NOT claim green without re-running the command and seeing a real pass. Either (1) run \`npm run build && npm run test\` again and confirm real output, or (2) report the blocker honestly (e.g. the command hung / was blocked).`,
          } as ChatMessage);
          continue;
        }
        toolContext.verifyBreakerTrippedLastTurn = verifyBreakerTrippedThisTurn || verifyBreakerTrippedLastTurn;

        // Layer D: fabricated test-count guard. If the assistant's final summary asserts a
        // specific passing-test count that disagrees with the last REAL `npm test` output,
        // reject it and force the true number. Prevents inventing "21 tests passing" when the
        // run actually reported 9.
        const testCorrection = fabricatedTestCountCorrection(cleanContent, toolContext.lastVerifyPassCount);
        if (testCorrection) {
          console.log(dim(`\n  [CHECK] Verifying test-count claim — summary count disagrees with last real test run.`));
          toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
          messages.push({ role: 'assistant', content: cleanContent });
          messages.push({
            role: 'user',
            content: testCorrection,
          } as ChatMessage);
          continue;
        }

        // Layer D2: green-state / clean-state claim vs last real verify run. Catches the
        // subset-omission overclaim: a true passing count ("9 validation tests passing")
        // slips past the count-fabrication guard, but the overall `npm test` was RED. If the
        // agent asserts tests/build pass or a clean state while the most recent actual verify
        // run this session FAILED, force a re-run or an honest report of what actually failed.
        if (isGreenStateClaim(cleanContent) && toolContext.lastVerifyPassed === false) {
          console.log(dim(`\n  [CHECK] Verifying green-state claim — last real verify run this session FAILED.`));
          toolContext.selfCorrectionCount = (toolContext.selfCorrectionCount ?? 0) + 1;
          messages.push({ role: 'assistant', content: cleanContent });
          messages.push({
            role: 'user',
            content: greenStateWarning(),
          } as ChatMessage);
          continue;
        }

        openBlock();
        writeAssistantChunk(cleanContent);
        closeAssistantBlock(cleanContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier, { showCost: config.ui?.showCost, selfCorrections: toolContext.selfCorrectionCount });
        messages.push({ role: 'assistant', content: cleanContent });
        return { content: cleanContent, toolCalls: [] };
      }

      messages.push({
        role: 'assistant',
        content: cleanContent || '',
        tool_calls: toolCallArray,
      });

      // Repetitive tool-calling loop detection
      const currentSignature = toolCallArray.map(tc => `${tc.function.name}:${tc.function.arguments}`).join('|');
      let consecutiveCount = 0;
      for (let j = signatureHistory.length - 1; j >= 0; j--) {
        if (signatureHistory[j] === currentSignature) {
          consecutiveCount++;
        } else {
          break;
        }
      }
      signatureHistory.push(currentSignature);

      if (consecutiveCount >= 2) {
        if (consecutiveCount >= 3) {
          closeAssistantBlock(lastContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier);
          console.log(`\n  ${dim('[DONE]')} Concluding after 4 consecutive identical tool calls (repetitive loop).`);
          return { content: lastContent, toolCalls: [] };
        }

        console.log(`\n  ${dim('[SELF-CORRECT]')} Same tool called repeatedly with identical arguments. Adjusting approach.`);
        messages.push({
          role: 'user',
          content: `[SYSTEM WARNING] You are stuck in a repetitive loop calling the same tools with the same arguments: "${toolCallArray.map(tc => tc.function.name).join(', ')}". Please STOP repeating yourself. If your previous tool calls did not give you the desired outcome, try a different approach (e.g., read a different file, search with a different query, run a build/test command, or summarize the blocker/findings to the user).`,
        } as ChatMessage);
      }

      // No tool-execution approval gate in fully headless/autonomous mode:
      // DAEDALUS_AUTO_APPROVE env OR safety.autoApprovePlans config (the headless flag).
      const autonomous = process.env.DAEDALUS_AUTO_APPROVE === 'true' || config.safety?.autoApprovePlans === true;
      const dangerousTools = autonomous ? [] : ['terminal', 'write_file'];
      let turnApproved = false;
      const approvedCallIndices = new Set<number>();
      const rejectedCalls: ToolCall[] = [];

      // Skip approval if task-level auto-approve is active
      if (toolContext.autoApproveTools) {
        for (let i = 0; i < toolCallArray.length; i++) approvedCallIndices.add(i);
      } else {
        for (let i = 0; i < toolCallArray.length; i++) {
          const tc = toolCallArray[i];
          if (dangerousTools.includes(tc.function.name) && !turnApproved) {
            const args = tc.function.arguments;
            const preview = args.length > 120 ? args.slice(0, 120) + '...' : args;
            log.prompt(`\n  ⮕ ${pc.bold(tc.function.name)} ${dim(preview)}\n`);
            const line = await (toolContext.askLine || askLine)(pc.blue(`  Allow? [y]es / [n]o / [a]ll for this task: `));
            const char = line.trim().toLowerCase().slice(0, 1);
            if (char === 'a') {
              turnApproved = true;
              toolContext.autoApproveTools = true;
            }
            if (char === 'n') {
              console.log(`  ${err('[FAIL]')} ${tc.function.name} ${err(' — rejected')}`);
              rejectedCalls.push(tc);
              continue;
            }
          }
          approvedCallIndices.add(i);
        }
      }

      const approvedCalls = toolCallArray.filter((_, i) => approvedCallIndices.has(i));
      for (const c of approvedCalls) executedToolNames.add(c.function.name);
      globalSessionStats.recordToolCall(approvedCalls.length);

      const toolNames = approvedCalls.map(c => c.function.name);
      printToolStart(approvedCalls.length, toolNames);

      let results;
      try {
        results = await executeToolCalls(approvedCalls, toolContext);
      } catch (err) {
        toolContext.pauseSpinner = () => {};
        toolContext.resumeSpinner = () => {};
        results = approvedCalls.map(tc => ({
          toolCallId: tc.id, name: tc.function.name, success: false, content: '', error: err instanceof Error ? err.message : String(err),
        }));
      }

      for (let ri = 0; ri < results.length; ri++) {
        const result = results[ri];
        let content = result.content;
        const sig = failureSignature(result.name, approvedCalls[ri]?.function?.arguments ?? '');
        const priorFailures = failureCounts.get(sig) ?? 0;
        if (result.success) {
          failureCounts.set(sig, 0);
          if (priorFailures > 0) {
            console.log(ok(`\n  [RECOVERED] ${result.name} succeeded after ${priorFailures} prior failure(s).`));
          }
        } else {
          failureCounts.set(sig, priorFailures + 1);
        }
        if (!result.success && result.error) {
          content = `${content}\n\n[Tool Error] ${result.error}`;
        }
        const failedWriteTools = ['patch', 'write_file'];
        if (!result.success && failedWriteTools.includes(result.name)) {
          const repeated = failureCounts.get(sig) ?? 0;
          const errText = `${result.error ?? ''}\n${result.content ?? ''}`;
          const isSyntaxLoop = isWriteToolSyntaxLoop(result.name, errText);
          if (isSyntaxLoop) {
            if (errText.includes('Localized root cause')) {
              // The revert message names the EXACT unbalanced delimiter and its line
              // (e.g. a stray quote/backtick/bracket). This is almost never whitespace
              // or the diff/side-by-side tool. Tell the agent to fix the one character
              // so it stops re-proposing the same edit or a cosmetic reindent.
              content += `\n\n[SYSTEM WARNING] Your ${result.name} failed validation: the message above names the EXACT unbalanced delimiter and its line. Fix that single character (likely a stray quote, backtick, or bracket) — this is almost never whitespace or the diff/side-by-side tool. Do NOT re-propose the same edit or a cosmetic reindent. Correct the one offending character and retry.`;
            } else if (result.name === 'write_file') {
              content += `\n\n[SYSTEM WARNING] Your write_file failed validation and was not applied. Fix the syntax/type error in the file content you provided and re-issue write_file with valid code. (If this is a TypeScript project, ensure source files are saved with .ts/.tsx extensions, not .js.)`;
            } else {
              content += `\n\n[SYSTEM WARNING] Your patch on this file keeps failing validation and the change was reverted to the last-good state. STOP rewriting the whole file — that is what keeps producing invalid syntax. Instead: (1) call read_file on the current file to get its exact content, then (2) call patch with mode='replace' on the SMALLEST unique region that needs to change. Do not emit a full-file rewrite. If you cannot make a clean minimal edit, stop and summarize the blocker to the user.`;
            }
          } else if (repeated >= 2) {
            if (result.name === 'write_file') {
              content += `\n\n[SYSTEM WARNING] You have repeatedly failed to create or write this file (${repeated} attempts). Verify the file path, module type (.ts vs .js), and fix syntax/type errors before retrying, or move on and summarize the blocker to the user.`;
            } else {
              content += `\n\n[SYSTEM WARNING] You have repeatedly failed to apply this change (${repeated} attempts). STOP attempting the same patch. Read the exact current file content and construct a patch that matches it exactly, or switch strategy (e.g. write_file with full content), or move on and summarize the blocker to the user.`;
            }
          } else {
            content += `\n\n[SYSTEM WARNING] The changes to the file were NOT applied due to the error above. You MUST first resolve this error (e.g. by using "read_file" to get the current content if it was a stale read, or correcting code syntax/types) and successfully apply the file change before moving on to other tasks or files. Do not skip or ignore this file.`;
          }
          // Stale-read auto-recovery: if the write failed because the file changed since the
          // last read (old-string-not-found), automatically read the current content and inject
          // it so the next attempt patches against fresh bytes instead of blind-retrying. This
          // turns a multi-turn thrash ("STALE READ → SELF-CORRECT → STALE READ") into one
          // automatic re-read.
          const stale = isStaleReadFailure(result.name, errText);
          if (stale.stale && stale.path) {
            try {
              const readBack = await executeToolCalls(
                [{ id: `auto_read_${Date.now()}`, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: stale.path }) } }],
                toolContext,
              );
              const fresh = readBack[0]?.content ?? '';
              messages.push({
                role: 'user',
                content: `[AUTO-READ after stale read] Current contents of ${stale.path} (re-read automatically because your edit targeted out-of-date bytes):\n\n${typeof fresh === 'string' ? fresh : JSON.stringify(fresh)}`,
              } as ChatMessage);
              console.log(dim(`\n  [SELF-CORRECT] Stale read detected on ${stale.path} — auto-re-read current content for the next attempt.`));
            } catch {
              // If the auto-read itself fails, the warning above already tells the agent to read manually.
            }
          }
        }

        const toolContentRaw = typeof content === 'string' ? content : JSON.stringify(content);
        messages.push({
          role: 'tool',
          content: truncateToolResult(maskSecrets(toolContentRaw)),
          tool_call_id: result.toolCallId || approvedCalls[ri]?.id || '',
        } as ChatMessage);

        printToolResult(result.name, result.success, result.error);
        // Layer B: feed the read-stall detector. A read_file with no error is a "read";
        // a successful patch/write_file is a "write" (breaks the stall assumption).
        if (result.success && result.name === 'read_file') {
          let readPath: string | undefined;
          try { readPath = JSON.parse(approvedCalls[ri]?.function?.arguments ?? '{}').path as string | undefined; } catch { /* ignore */ }
          if (!readStall.registerRead(readPath)) { /* not stalled yet */ }
        }
        if (result.success && (result.name === 'patch' || result.name === 'write_file')) {
          readStall.registerWrite();
        }
        // Claim-grounding: record every file the agent actually inspected this session so a
        // later factual claim about that file is grounded. read_file = observed; search_files
        // = observed (hit or not); terminal = any path mentioned in the command.
        if (result.name === 'read_file') {
          try {
            const p = (JSON.parse(approvedCalls[ri]?.function?.arguments ?? '{}').path) as string | undefined;
            if (p) claimLedger.record({ kind: 'read', base: p, hit: result.success });
          } catch { /* ignore */ }
        }
        if (result.name === 'search_files') {
          try {
            const p = (JSON.parse(approvedCalls[ri]?.function?.arguments ?? '{}').path) as string | undefined;
            const hit = typeof result.content === 'string' && !/\(no matches\)|0 matches/i.test(result.content);
            if (p) claimLedger.record({ kind: 'search', base: p, hit });
          } catch { /* ignore */ }
        }
        if (result.name === 'terminal') {
          const cmd = approvedCalls[ri]?.function?.arguments ?? '';
          const m = cmd.match(/(?:[A-Za-z]:)?[\\/][\w.\-//\\]+\.(?:ts|tsx|js|mjs|cjs|jsx|py|go|rs|java|cs|rb|php|json|md|css|html)|\b[\w.\-]+\.(?:ts|tsx|js|mjs|cjs|jsx|py|go|rs|java|cs|rb|php|json|md|css|html)/i);
          if (m) claimLedger.record({ kind: 'terminal', base: m[0], hit: result.success });
          // Runtime-exercise signal: a live integration probe (curl/HTTP/fetch/integration test)
          // grounds a later "feature works / is wired in / verified" claim. Static checks (tsc/
          // vitest) do NOT set this — see detectUngroundedWorksClaim.
          if (RUNTIME_EXERCISE_RE.test(`${cmd}\n${result.content ?? ''}`)) {
            claimLedger.markRuntimeExercised();
          }
        }
        // Project-feature grounding: feed raw tool output into the ledger so a later claim
        // that the project HAS a feature/dependency is grounded when the term actually
        // appeared in something the agent read/ran this session.
        if (result.content) {
          claimLedger.recordText(result.content);
          claimLedger.recordText(`${approvedCalls[ri]?.function?.arguments ?? ''}`);
        }
        // Layer C: detect a terminal circuit-breaker on a build/test/lint verify command.
        if (result.name === 'terminal' && CIRCUIT_BREAKER_RE.test(`${result.error ?? ''}\n${result.content ?? ''}`)) {
          verifyBreakerTrippedThisTurn = true;
        }
        // A real successful build/test/lint run this turn clears the breaker flag — proof.
        if (result.name === 'terminal' && result.success && /\b(npm run (build|test|lint)|pnpm (run )?(build|test|lint)|yarn (build|test|lint)|tsc(\s+--noEmit)?|vitest|jest)\b/i.test(`${result.content ?? ''}`) && /(pass|passed|clean|green|✅|0 errors|succeed)/i.test(`${result.content ?? ''}`)) {
          verifyBreakerTrippedThisTurn = false;
          verifyBreakerTrippedLastTurn = false;
        }
        if (result.success && result.name === 'todo') {
          printTodoProgress(toolContext.sessionId);
        }
        if (result.success && result.content) {
          printToolContentPreview(maskSecrets(typeof result.content === 'string' ? result.content : JSON.stringify(result.content)));
        }
        if (result.success && (result.name === 'screenshot_page' || result.name === 'read_file')) {
          try {
            const parsed = JSON.parse(result.content);
            if (parsed.type === 'vision' && parsed.base64) {
              const mime = parsed.mimeType || 'image/png';
              const textDescription = parsed.url
                ? `[Screenshot of ${parsed.url}${parsed.selector ? ` > ${parsed.selector}` : ''}]`
                : `[Image file: ${parsed.path || 'unknown'}]`;
              messages.push({
                role: 'user',
                content: [
                  { type: 'text', text: textDescription },
                  { type: 'image_url', image_url: { url: `data:${mime};base64,${parsed.base64}` } },
                ],
              } as ChatMessage);
              console.log(`  ${info('[VISION]')} Image injected into context (${Math.round(parsed.base64.length * 0.75 / 1024)}KB)`);
            }
          } catch { /* ignored */ }
        }
      }

      for (const tc of rejectedCalls) {
        messages.push({
          role: 'tool',
          content: 'Error: Tool execution rejected by user.',
          tool_call_id: tc.id,
        } as ChatMessage);
      }

      // Single-agent turn checkpoint gate
      // Only prompt gate if a dangerous tool was executed, and task auto-approve is not active
      const hadDangerousTool = toolCallArray.some(c => dangerousTools.includes(c.function.name));
      let shouldPromptGate = hadDangerousTool && !toolContext.autoApproveTools;

      const failedResults = results.filter(r => !r.success);
      lastFailedResults = failedResults;
      if (failedResults.length > 0) {
        consecutiveToolFailures++;
        shouldPromptGate = false;
        let hadFileMissing = false;
        let hadCommandExit = false; // a command ran and exited non-zero with real output (e.g. `npm test` failed)
        for (const r of failedResults) {
          const firstLine = (r.error || '').split('\n')[0] || 'unknown error';
          const snippet = firstLine.length > 160 ? `${firstLine.slice(0, 160)}...` : firstLine;
          // A read of a non-existent file is deterministic, not transient: re-reading
          // the same path is guaranteed to fail again. Surface it decisively so the
          // model creates the file or reports the blocker instead of looping.
          const isFileMissing = FILE_NOT_FOUND_RE.test(`${r.error ?? ''}\n${r.content ?? ''}`);
          // A command that ran and exited non-zero (real output below) is a RESULT, not a
          // transient tool error — e.g. `npm test` failing. Framing it as a self-correction
          // is misleading; the agent should analyze the output, not "retry the approach".
          const isCommandExit = /exit code:/i.test(r.error ?? '') && (r.content ?? '').trim().length > 0;
          if (isCommandExit) hadCommandExit = true;
          if (isFileMissing) {
            hadFileMissing = true;
            console.log(warn(`\n  [FILE-MISSING] ${snippet}`));
            console.log(dim('    This path does not exist. Do not re-read it — create it, pick a different path, or report the blocker to the user.'));
          } else {
            console.log(dim(`\n  [RETRY] ${r.name} didn't apply — ${snippet}`));
            const tailLines = (r.content || '')
              .replace(/\u001B\[\d+(;\d+)*m/g, '')
              .split('\n')
              .filter(l => l.trim());
            if (tailLines.length > 0) {
              const shown = tailLines.length > 12
                ? [...tailLines.slice(0, 3), `  ... ${tailLines.length - 12} more lines`, ...tailLines.slice(-9)]
                : tailLines;
              console.log(dim(shown.map(l => `    ${l}`).join('\n')));
            }
          }
        }
        if (hadFileMissing) {
          // Decisive nudge: stop the re-read loop, force a different strategy.
          messages.push({
            role: 'user',
            content: '[SYSTEM WARNING] A requested file does not exist. Stop re-reading the same missing path. Either create it, choose a correct path (verify with search_files/list_files), or stop and report the blocker to the user.',
          } as ChatMessage);
        } else if (hadCommandExit) {
          // A command ran and failed (e.g. tests/build red). This is a real result to
          // analyze, not a self-correction loop — don't imply we are retrying the approach.
          console.log(dim(`\n  [RESULT] Command exited non-zero — output shown above. Analyze the failure; do not treat it as a transient tool error.`));
        } else {
          console.log(dim(`\n  [SELF-CORRECT] Adjusting approach and retrying...`));
        }
      } else {
        consecutiveToolFailures = 0;
        escalatedThisStreak = false;
      }

      let worstRepeatedFailures = 0;
      let worstSignature = '';
      for (const [sig, count] of failureCounts) {
        if (count > worstRepeatedFailures) {
          worstRepeatedFailures = count;
          worstSignature = sig;
        }
      }

      if (consecutiveToolFailures >= 3 || worstRepeatedFailures >= 3) {
        const detail = worstRepeatedFailures >= 3 && worstSignature
          ? `Tool '${worstSignature}' has failed ${worstRepeatedFailures} times. `
          : '';
        messages.push({
          role: 'user',
          content: `[SYSTEM WARNING] ${detail}You MUST change your approach: stop re-running the same failing command; read the error message, use a different tool or strategy, or stop and summarize the blocker to the user.`,
        } as ChatMessage);
      }

      // Hard stop: a patch circuit breaker fired this turn. The agent exhausted its
      // patch-attempt budget and must not keep retrying or escalating models — force the
      // turn to close so it reports the blocker to the user instead of looping.
      if (failedResults.some(r => `${r.error ?? ''}\n${r.content ?? ''}`.includes('[PAUSED]'))) {
        closeAssistantBlock(lastContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier, { showCost: config.ui?.showCost, selfCorrections: toolContext.selfCorrectionCount });
        return { content: `${lastContent}\n\n[PAUSED] Patch circuit breaker tripped — too many reverted patches this session. Pausing to avoid a loop. Report the blocker to the user.`, toolCalls: [] };
      }

      const routerConfig = typeof router.getConfig === 'function' ? router.getConfig() : undefined;
      const syntaxLoopThisTurn = failedResults.some(r =>
        isWriteToolSyntaxLoop(r.name, `${r.error ?? ''}\n${r.content ?? ''}`)
      );
      // A terminal circuit breaker (e.g. "command 'cd' failed 2 consecutive times") is a
      // tool/loop guard, not a model-capability failure -- escalating to a bigger model does
      // not fix it (the same command would just trip the breaker again) and churns context.
      // Exclude breaker trips from escalation so the agent recovers in-place instead of
      // bouncing through gpt-oss -> llama-4 -> deepseek on a transient blip.
      const breakerTrippedThisTurn = failedResults.some(r =>
        /\[CIRCUIT BREAKER\]/i.test(`${r.error ?? ''}\n${r.content ?? ''}`)
      );
      const canEscalate = !config.modelOverride
        && routerConfig?.autoEscalate !== false
        && escalationCount < 3
        && !escalatedThisStreak
        && !syntaxLoopThisTurn
        && !breakerTrippedThisTurn;
      // Raise the per-turn trigger from 2 to 3 consecutive/repeated failures. A 2-failure
      // blip (e.g. a single timeout + retry) should not yank the model; 3 is the documented
      // breaker threshold and aligns with the >=5 hard-stop below.
      if (canEscalate && (consecutiveToolFailures >= 3 || worstRepeatedFailures >= 3)) {
        const currentName = pinnedModel || router.lastRoutedModelName || '';
        const nextModel = currentName && typeof router.getNextModel === 'function' ? router.getNextModel(currentName) : undefined;
        if (nextModel) {
          escalatedThisStreak = true;
          toolContext.escalatedStreak = true;
          escalationCount++;
          pinnedModel = nextModel.name;
          console.log(dim(`\n  [ROUTE] Stepping up to a more capable model ${nextModel.name} after repeated tool failures on ${currentName}.`));
          messages.push({
            role: 'user',
            content: '[SYSTEM NOTICE] A stronger model is now handling this task after repeated tool failures. Re-examine the recent errors and the exact current state of the files before retrying. Do not repeat the same failing calls.',
          } as ChatMessage);
        }
      }

      if (consecutiveToolFailures >= 5 || worstRepeatedFailures >= 5) {
        closeAssistantBlock(lastContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier, { showCost: config.ui?.showCost, selfCorrections: toolContext.selfCorrectionCount });
        console.log(dim('\n  [DONE] Concluding after repeated tool failures — see summary above.'));
        toolContext.maxTurnsCause = computeMaxTurnsCause();
        messages.push({ role: 'assistant', content: lastContent });
        return { content: lastContent, toolCalls: [] };
      }

      if (toolTurnsRemaining > 1 && process.env.DAEDALUS_AUTO_APPROVE !== 'true' && shouldPromptGate) {
        const ask = toolContext.askLine || askLine;
        const answer = await ask(turnGatePrompt());
        const norm = answer.trim().toLowerCase();

        if (norm === 'n' || norm === 'no') {
          closeAssistantBlock(lastContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier, { showCost: config.ui?.showCost, selfCorrections: toolContext.selfCorrectionCount });
          console.log(warn('\n  [INFO] Stopped agent turn loop.'));
          messages.push({ role: 'assistant', content: lastContent });
          return { content: lastContent, toolCalls: [] };
        } else if (norm === 'e' || norm === 'edit') {
          const feedback = await ask(`  Enter feedback for agent: `);
          if (feedback.trim()) {
            messages.push({
              role: 'user',
              content: `[User Feedback] ${feedback.trim()}`,
            } as ChatMessage);
            console.log(ok(`  [OK] Feedback appended. Continuing.`));
          }
        }
      }

      if (currentComplexity) {
        const writesThisTurn = results.filter(r => r.success && ['patch', 'write_file'].includes(r.name)).length;
        const failedThisTurn = results.filter(r => !r.success).length;
        const nextState = stepRouting(
          { current: currentComplexity, totalCompletionTokens, trivialTurnStreak, hasDowngraded, floor: complexityFloor },
          {
            completionTokensThisTurn: turnUsageOut ?? 0,
            writesThisTurn,
            toolCallsThisTurn: toolCallArray.length,
            failedToolsThisTurn: failedThisTurn,
            toolMentionsThisTurn: countToolMentions(fullContent),
          },
        );
        if (nextState.current !== currentComplexity) {
          console.log(pc.magenta(`  [ROUTE] Reclassified ${currentComplexity} → ${nextState.current} (${nextState.totalCompletionTokens} output tokens, ${totalToolCalls + toolCallArray.length} tool calls)`));
          currentComplexity = nextState.current;
        }
        totalCompletionTokens = nextState.totalCompletionTokens;
        trivialTurnStreak = nextState.trivialTurnStreak;
        hasDowngraded = nextState.hasDowngraded === true;
      }

      totalToolCalls += toolCallArray.length;
      toolTurnsRemaining--;
    }
  }

  async function callModelWithFallback(userContent: string, imageBase64?: string): Promise<string> {
    if (imageBase64) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userContent },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
        ],
      });
    } else {
      messages.push({ role: 'user', content: userContent });
    }

    console.log(pc.gray('  [THINK] Thinking (fallback mode)...'));

    try {
      // Send tools so a compliant endpoint returns OpenAI tool_calls; non-compliant
      // endpoints that emit tool calls as text are recovered via parseTextToolCalls below.
      const fbTools = [...BUILTIN_TOOLS, ...POWER_TOOLS, ...mcpRegistry.getToolDefinitions()];
      const response = await router.chat.completions.create({
        model: config.modelOverride || 'auto',
        messages,
        temperature: 0.1,
        tools: fbTools,
        tool_choice: 'auto',
        max_tokens: 4096,
      });

      const msg = response.choices[0]?.message;
      const reply = messageText(msg?.content ?? '');
      let parsed: ToolCall[] = [];
      if (msg?.tool_calls && msg.tool_calls.length > 0) {
        parsed = msg.tool_calls.map((tc: { id?: string; function?: { name?: string; arguments?: string } }, i: number) => ({
          id: tc.id ?? `fb_${Date.now()}_${i}`,
          type: 'function',
          function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '' },
        }));
      } else {
        parsed = parseTextToolCalls(reply);
      }

      if (parsed.length > 0) {
        messages.push({ role: 'assistant', content: reply || `[tool calls: ${parsed.map(c => c.function.name).join(', ')}]` });
        const results = await executeToolCalls(parsed, toolContext);
        for (let i = 0; i < parsed.length; i++) {
          const rc = parsed[i];
          const res = results[i];
          const resText = typeof res === 'string' ? res : JSON.stringify(res ?? {});
          messages.push({ role: 'tool', tool_call_id: rc.id, content: resText });
        }
        // Surface the tool outcome so the caller's loop can continue if needed.
        return `[fallback executed ${parsed.length} tool call(s)]\n${reply}`;
      }

      messages.push({ role: 'assistant', content: reply });
      openAssistantBlock();
      writeAssistantChunk(reply);
      const elapsed = Date.now() - _turnStartTime;
      closeAssistantBlock(reply.length, elapsed, undefined, router.lastRoutedModel);
      return reply;
    } catch (error) {
      const firstLine = ((error instanceof Error ? error.message : String(error)) || '').split('\n')[0];
      console.log(warn(`\n  ${pc.bold('[WARN]')} Fallback error: ${firstLine}`));
      console.log(dim(`         (Tip: Run /doctor to diagnose connection or loading issues)`));
      throw error;
    }
  }

  return { callModelWithTools, callModelWithFallback };
}

export function maxPatchFailureStreak(streak: Map<string, number> | undefined): number {
  if (!streak || streak.size === 0) return 0;
  let max = 0;
  for (const value of streak.values()) {
    if (value > max) max = value;
  }
  return max;
}

export type PatchOutcomeSignal = 'success' | 'failure' | 'none';

export function evaluatePatchOutcome(
  before: { patches: number; maxStreak: number },
  after: { patches: number; maxStreak: number },
): PatchOutcomeSignal {
  if (after.patches > before.patches) return 'success';
  if (after.maxStreak > before.maxStreak) return 'failure';
  return 'none';
}
