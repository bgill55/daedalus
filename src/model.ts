import pc from 'picocolors';
import { BUILTIN_TOOLS, POWER_TOOLS } from './tools/definitions.js';
import { executeToolCalls } from './tools/executor.js';
import { getSessionTodos } from './tools/builtin/todo.js';
import { detectFalseCompletion, falseCompletionWarning, detectFalseCompletionOnDisk } from './agents/completion-guard.js';
import { mcpRegistry } from './tools/mcp/registry.js';
import { DaedalusSpinner } from './tools/daedalus-spinner.js';
import { calculateSessionTokens, pruneMessages } from './session/tokens.js';
import { log } from './ui/log.js';
import { parseTextToolCalls, stripToolCallMarkup, openAssistantBlock, writeAssistantChunk, closeAssistantBlock, printContextWarning, printContextResult, printContextPrune, printToolStart, printToolResult, printToolContentPreview, turnGatePrompt } from './formatting.js';
import type { ToolContext, ToolCall, ChatMessage } from './types.js';
import { messageText } from './types.js';
import type { LocalRouter } from './router/index.js';
import type { DaedalusConfig } from './config/index.js';
import { classifyTaskStart, stepRouting, floorForTask } from './router/complexity.js';

const TOOL_RESULT_MAX_CHARS = 32_000;
const MAX_TOOL_TURNS = 40;

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
      console.log(pc.dim(`  [ROUTE] Task classified as ${taskComplexity}`));
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
    // Detects a write-tool failure that is a syntax/revert loop OR a circuit-breaker
    // trip. A circuit breaker on a patch/write_file (streak >= 2) is, by definition, a
    // repeated failed-edit loop — almost always invalid syntax the tool reverted.
    // These must NOT escalate to a stronger model (that does not fix a syntax-emitting
    // model); they need a strategy change (read_file + minimal targeted patch).
    const isWriteToolSyntaxLoop = (name: string, errText: string): boolean =>
      ['patch', 'write_file'].includes(name) &&
      /syntax error|revert|invalid (ts|typescript)|unexpected token|expected ['"]|circuit breaker|consecutive times|patch failed \d+ consecutive/i.test(errText);
    const executedToolNames = new Set<string>();
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

    while (true) {
      if (toolTurnsRemaining <= 0) {
        closeAssistantBlock(lastContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier);
        console.log(`\n  ${pc.cyan('[INFO]')} ${pc.dim(`Reached max tool turns (${MAX_TOOL_TURNS}). Pausing to checkpoint.`)}`);
        const executedSummary = executedToolNames.size > 0 ? [...executedToolNames].join(', ') : 'none';
        console.log(`  ${pc.dim(`[SUMMARY] ${totalToolCalls} tool call(s) executed: ${executedSummary}`)}`);
        if (process.stdin.isTTY) {
          const answer = await (toolContext.askLine || askLine)(`  Continue working? [y]es / [n]o: `);
          if (answer.trim().toLowerCase().startsWith('y')) {
            console.log(pc.green('  [OK] Continuing with a fresh turn budget.'));
            toolTurnsRemaining = MAX_TOOL_TURNS;
            consecutiveToolFailures = 0;
            continue;
          }
        }
        console.log(pc.dim('  [INFO] Stopping. Type "continue" to resume.'));
        messages.push({ role: 'assistant', content: lastContent });
        return { content: lastContent, toolCalls: [] };
      }

      if (turnAborted) {
        closeAssistantBlock(lastContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier);
        console.log(pc.dim('\n  [STOP] Stopped'));
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
          if (signal.aborted) break;
          const u = (chunk as { usage?: { completion_tokens?: number } } | undefined)?.usage;
          if (u && typeof u.completion_tokens === 'number') turnUsageOut = u.completion_tokens;
          const choice = chunk.choices[0];
          if (!choice) continue;

          const delta = choice.delta;

          if (delta.content) {
            openBlock();
            fullContent += delta.content;
            writeAssistantChunk(delta.content);

            if (detectRepetition(fullContent)) {
              writeAssistantChunk(pc.red('\n\n[STOP] Repetition loop detected. Aborting stream.'));
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

        if (!blockOpened) spinner.stop();

        if (signal.aborted) {
          closeAssistantBlock((lastContent || fullContent).length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier);
          console.log(pc.dim('\n  [STOP] Stopped'));
          clearAbortController();
          return { content: fullContent, toolCalls: [] };
        }

      } catch (error) {
        if (signal.aborted) {
          spinner.stop();
          closeAssistantBlock((lastContent || fullContent).length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier);
          console.log(pc.dim('\n  [STOP] Stopped'));
          clearAbortController();
          return { content: repetitionAborted ? fullContent : '', toolCalls: [] };
        }
        spinner.stop();
        const firstLine = (error instanceof Error ? error.message : String(error)).split('\n')[0];
        console.log(pc.yellow(`\n  ${pc.bold('[WARN]')} Error calling model: ${firstLine}`));
        console.log(pc.dim(`         (Tip: Run /doctor to diagnose connection or loading issues)`));
        throw error;
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

      if (toolCallArray.length === 0) {
        // Only treat this as a "planned but omitted JSON" failure when the model
        // actually emitted tool-call markup (the structured <tool_call> block) but
        // no parseable JSON. A bare mention of tool names in prose (e.g. an audit
        // report saying "I ran read_file and terminal") must NOT trip this — that
        // is normal narration, and forcing a retry loops on a finished report.
        const narratedToolCalls = parseTextToolCalls(fullContent);
        if (narratedToolCalls.length >= 1) {
          console.log(pc.dim(`\n  [RETRY] Model planned tools but emitted no valid JSON. Re-issuing the request.`));
          totalCompletionTokens += turnUsageOut ?? 0;
          messages.push({
            role: 'user',
            content: `[SYSTEM WARNING] You emitted a <tool_call> block but it was not valid JSON. Please output the proper JSON array of tool calls now.`,
          } as ChatMessage);
          continue;
        }

        closeAssistantBlock(cleanContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier);
        if (currentComplexity && process.env.DAEDALUS_DEBUG === 'true') {
          console.log(pc.dim(`  [ROUTE] Task summary: start ${taskComplexity ?? 'n/a'} → end ${currentComplexity} | ${totalCompletionTokens + (turnUsageOut ?? 0)} output tokens | ${escalationCount} escalation(s)`));
        }

        // Hard guard: do not let the agent end the turn claiming whole-task
        // completion while its todo list still has open items. A false "done"
        // report would mislead an end user who trusts it. Force reconciliation.
        const closingTodos = getSessionTodos(toolContext.sessionId);
        if (closingTodos.length > 0 && detectFalseCompletion(cleanContent, closingTodos)) {
          const remaining = closingTodos.filter((t) => t.status !== 'completed').length;
          console.log(pc.cyan(`\n  [CHECK] Verifying completion claim — ${remaining} todo(s) still open.`));
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
          console.log(pc.cyan(`\n  [CHECK] Verifying completion claim — no successful patch to ${falselyClaimed} this session (only reverts).`));
          messages.push({ role: 'assistant', content: cleanContent });
          messages.push({
            role: 'user',
            content: `[SYSTEM WARNING] You claimed a fix/completion involving ${falselyClaimed}, but this session has NO successful patch to that file — only patches the syntax guard reverted. Reconcile with disk reality: either (1) actually apply and verify the change (run build/test and confirm it on disk), or (2) report the blocker honestly instead of claiming it is done. Do NOT report completion for changes that were not written.`,
          } as ChatMessage);
          continue;
        }

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
          console.log(`\n  ${pc.dim('[DONE]')} Concluding after 4 consecutive identical tool calls (repetitive loop).`);
          return { content: lastContent, toolCalls: [] };
        }

        console.log(`\n  ${pc.dim('[SELF-CORRECT]')} Same tool called repeatedly with identical arguments. Adjusting approach.`);
        messages.push({
          role: 'user',
          content: `[SYSTEM WARNING] You are stuck in a repetitive loop calling the same tools with the same arguments: "${toolCallArray.map(tc => tc.function.name).join(', ')}". Please STOP repeating yourself. If your previous tool calls did not give you the desired outcome, try a different approach (e.g., read a different file, search with a different query, run a build/test command, or summarize the blocker/findings to the user).`,
        } as ChatMessage);
      }

      const dangerousTools = process.env.DAEDALUS_AUTO_APPROVE === 'true' ? [] : ['terminal', 'write_file'];
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
            log.prompt(`\n  ⮕ ${pc.bold(tc.function.name)} ${pc.dim(preview)}\n`);
            const line = await (toolContext.askLine || askLine)(pc.blue(`  Allow? [y]es / [n]o / [a]ll for this task: `));
            const char = line.trim().toLowerCase().slice(0, 1);
            if (char === 'a') {
              turnApproved = true;
              toolContext.autoApproveTools = true;
            }
            if (char === 'n') {
              console.log(`  ${pc.red('[FAIL]')} ${tc.function.name} ${pc.red(' — rejected')}`);
              rejectedCalls.push(tc);
              continue;
            }
          }
          approvedCallIndices.add(i);
        }
      }

      const approvedCalls = toolCallArray.filter((_, i) => approvedCallIndices.has(i));
      for (const c of approvedCalls) executedToolNames.add(c.function.name);

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
            console.log(pc.green(`\n  [RECOVERED] ${result.name} succeeded after ${priorFailures} prior failure(s).`));
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
            content += `\n\n[SYSTEM WARNING] Your ${result.name} on this file keeps failing validation and the change was reverted to the last-good state. STOP rewriting the whole file — that is what keeps producing invalid syntax. Instead: (1) call read_file on the current file to get its exact content, then (2) call patch with mode='replace' on the SMALLEST unique region that needs to change. Do not emit a full-file rewrite. If you cannot make a clean minimal edit, stop and summarize the blocker to the user.`;
          } else if (repeated >= 2) {
            content += `\n\n[SYSTEM WARNING] You have repeatedly failed to apply this change (${repeated} attempts). STOP attempting the same patch. Read the exact current file content and construct a patch that matches it exactly, or switch strategy (e.g. write_file with full content), or move on and summarize the blocker to the user.`;
          } else {
            content += `\n\n[SYSTEM WARNING] The changes to the file were NOT applied due to the error above. You MUST first resolve this error (e.g. by using "read_file" to get the current content if it was a stale read, or correcting code syntax/types) and successfully apply the file change before moving on to other tasks or files. Do not skip or ignore this file.`;
          }
        }

        messages.push({
          role: 'tool',
          content: truncateToolResult(typeof content === 'string' ? content : JSON.stringify(content)),
          tool_call_id: result.toolCallId || approvedCalls[ri]?.id || '',
        } as ChatMessage);

        printToolResult(result.name, result.success, result.error);
        if (result.success && result.name === 'todo') {
          const todos = getSessionTodos(toolContext.sessionId);
          const done = todos.filter(t => t.status === 'completed').length;
          const active = todos.find(t => t.status === 'in_progress');
          if (todos.length > 0) {
            const activeText = active ? ` | Active: ${active.content.slice(0, 50)}${active.content.length > 50 ? '...' : ''}` : '';
            console.log(pc.cyan(`\n  [TODO] Progress: ${done}/${todos.length} completed${activeText}`));
          }
        }
        if (result.success && result.content) {
          printToolContentPreview(result.content);
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
              console.log(`  ${pc.cyan('[VISION]')} Image injected into context (${Math.round(parsed.base64.length * 0.75 / 1024)}KB)`);
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
      if (failedResults.length > 0) {
        consecutiveToolFailures++;
        shouldPromptGate = false;
        for (const r of failedResults) {
          const firstLine = (r.error || '').split('\n')[0] || 'unknown error';
          const snippet = firstLine.length > 160 ? `${firstLine.slice(0, 160)}...` : firstLine;
          console.log(pc.dim(`\n  [RETRY] ${r.name} didn't apply — ${snippet}`));
          const tailLines = (r.content || '')
            .replace(/\u001B\[\d+(;\d+)*m/g, '')
            .split('\n')
            .filter(l => l.trim());
          if (tailLines.length > 0) {
            const shown = tailLines.length > 12
              ? [...tailLines.slice(0, 3), `  ... ${tailLines.length - 12} more lines`, ...tailLines.slice(-9)]
              : tailLines;
            console.log(pc.dim(shown.map(l => `    ${l}`).join('\n')));
          }
        }
        console.log(pc.dim(`\n  [SELF-CORRECT] Adjusting approach and retrying...`));
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
        closeAssistantBlock(lastContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier);
        return { content: `${lastContent}\n\n[PAUSED] Patch circuit breaker tripped — too many reverted patches this session. Pausing to avoid a loop. Report the blocker to the user.`, toolCalls: [] };
      }

      const routerConfig = typeof router.getConfig === 'function' ? router.getConfig() : undefined;
      const syntaxLoopThisTurn = failedResults.some(r =>
        isWriteToolSyntaxLoop(r.name, `${r.error ?? ''}\n${r.content ?? ''}`)
      );
      const canEscalate = !config.modelOverride
        && routerConfig?.autoEscalate !== false
        && escalationCount < 3
        && !escalatedThisStreak
        && !syntaxLoopThisTurn;
      if (canEscalate && (consecutiveToolFailures >= 2 || worstRepeatedFailures >= 2)) {
        const currentName = pinnedModel || router.lastRoutedModelName || '';
        const nextModel = currentName && typeof router.getNextModel === 'function' ? router.getNextModel(currentName) : undefined;
        if (nextModel) {
          escalatedThisStreak = true;
          escalationCount++;
          pinnedModel = nextModel.name;
          console.log(pc.dim(`\n  [ROUTE] Stepping up to a more capable model ${nextModel.name} after repeated tool failures on ${currentName}.`));
          messages.push({
            role: 'user',
            content: '[SYSTEM NOTICE] A stronger model is now handling this task after repeated tool failures. Re-examine the recent errors and the exact current state of the files before retrying. Do not repeat the same failing calls.',
          } as ChatMessage);
        }
      }

      if (consecutiveToolFailures >= 5 || worstRepeatedFailures >= 5) {
        closeAssistantBlock(lastContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier);
        console.log(pc.dim('\n  [DONE] Concluding after repeated tool failures — see summary above.'));
        messages.push({ role: 'assistant', content: lastContent });
        return { content: lastContent, toolCalls: [] };
      }

      if (toolTurnsRemaining > 1 && process.env.DAEDALUS_AUTO_APPROVE !== 'true' && shouldPromptGate) {
        const ask = toolContext.askLine || askLine;
        const answer = await ask(turnGatePrompt());
        const norm = answer.trim().toLowerCase();

        if (norm === 'n' || norm === 'no') {
          closeAssistantBlock(lastContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut, router.lastRoutedTier);
          console.log(pc.yellow('\n  [INFO] Stopped agent turn loop.'));
          messages.push({ role: 'assistant', content: lastContent });
          return { content: lastContent, toolCalls: [] };
        } else if (norm === 'e' || norm === 'edit') {
          const feedback = await ask(`  Enter feedback for agent: `);
          if (feedback.trim()) {
            messages.push({
              role: 'user',
              content: `[User Feedback] ${feedback.trim()}`,
            } as ChatMessage);
            console.log(pc.green(`  [OK] Feedback appended. Continuing.`));
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
      const response = await router.chat.completions.create({
        model: config.modelOverride || 'auto',
        messages,
        temperature: 0.1,
      });

      const reply = messageText(response.choices[0]?.message?.content ?? '');
      messages.push({ role: 'assistant', content: reply });
      openAssistantBlock();
      writeAssistantChunk(reply);
      const elapsed = Date.now() - _turnStartTime;
      closeAssistantBlock(reply.length, elapsed, undefined, router.lastRoutedModel);
      return reply;
    } catch (error) {
      const firstLine = ((error instanceof Error ? error.message : String(error)) || '').split('\n')[0];
      console.log(pc.yellow(`\n  ${pc.bold('[WARN]')} Fallback error: ${firstLine}`));
      console.log(pc.dim(`         (Tip: Run /doctor to diagnose connection or loading issues)`));
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
