import pc from 'picocolors';
import { BUILTIN_TOOLS, POWER_TOOLS } from './tools/definitions.js';
import { executeToolCalls } from './tools/executor.js';
import { getSessionTodos } from './tools/builtin/todo.js';
import { mcpRegistry } from './tools/mcp/registry.js';
import { DaedalusSpinner } from './tools/daedalus-spinner.js';
import { calculateSessionTokens, pruneMessages } from './session/tokens.js';
import { parseTextToolCalls, openAssistantBlock, writeAssistantChunk, closeAssistantBlock, printContextWarning, printContextResult, printContextPrune, printToolStart, printToolResult, printToolContentPreview, turnGatePrompt } from './formatting.js';
import type { ToolContext, ToolCall, ChatMessage } from './types.js';
import type { LocalRouter } from './router/index.js';
import { classifyTaskStart, reclassifyTurn } from './router/complexity.js';

const TOOL_RESULT_MAX_CHARS = 32_000;
const MAX_TOOL_TURNS = 40;

let _turnStartTime = 0;

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

function detectRepetition(text: string): boolean {
  if (text.length < 200) return false;
  const tail = text.slice(-400);
  const len = 32;
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
    if (occurrences >= 4) {
      return true;
    }
  }
  return false;
}

export interface ModelDeps {
  messages: ChatMessage[];
  config: any;
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
    if (taskComplexity) {
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
          return resp.choices[0]?.message?.content || '';
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
    const executedToolNames = new Set<string>();
    const signatureHistory: string[] = [];
    let pinnedModel: string | undefined;
    let escalationCount = 0;
    let escalatedThisStreak = false;
    let currentComplexity = taskComplexity;
    let totalCompletionTokens = 0;
    let trivialTurnStreak = 0;
    let turnUsageOut: number | undefined;
    openAssistantBlock();
    const overallStart = Date.now();
    let totalToolCalls = 0;

    while (true) {
      if (toolTurnsRemaining <= 0) {
        closeAssistantBlock(lastContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut);
        console.log(`\n  ${pc.yellow('[WARN]')} ${pc.yellow(`Reached max tool turns (${MAX_TOOL_TURNS}). Stopping to checkpoint.`)}`);
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
        closeAssistantBlock(lastContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut);
        console.log(pc.dim('\n  [STOP] Stopped'));
        return { content: lastContent, toolCalls: [] };
      }
      turnUsageOut = undefined;
      const spinner = new DaedalusSpinner({ text: 'Daedalus thinking', color: (s) => pc.blue(s) });
      spinner.start();

      let fullContent = '';
      const toolCallMap: Map<number, ToolCall> = new Map();
      let blockOpened = false;
      const turnStart = Date.now();

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
          closeAssistantBlock((lastContent || fullContent).length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut);
          console.log(pc.dim('\n  [STOP] Stopped'));
          clearAbortController();
          return { content: fullContent, toolCalls: [] };
        }

      } catch (error: any) {
        if (signal.aborted) {
          spinner.stop();
          closeAssistantBlock((lastContent || fullContent).length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut);
          console.log(pc.dim('\n  [STOP] Stopped'));
          clearAbortController();
          return { content: repetitionAborted ? fullContent : '', toolCalls: [] };
        }
        spinner.stop();
        const firstLine = (error.message || '').split('\n')[0];
        console.log(pc.yellow(`\n  ${pc.bold('[WARN]')} Error calling model: ${firstLine}`));
        console.log(pc.dim(`         (Tip: Run /doctor to diagnose connection or loading issues)`));
        throw error;
      }

      clearAbortController();

      let toolCallArray = Array.from(toolCallMap.values()).filter(tc => tc.function.name);
      if (toolCallArray.length === 0) {
        const parsedCalls = parseTextToolCalls(fullContent);
        if (parsedCalls.length > 0) {
          toolCallArray = parsedCalls;
        }
      }
      lastContent = fullContent;

      if (toolCallArray.length === 0) {
        closeAssistantBlock(fullContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut);
        messages.push({ role: 'assistant', content: fullContent });
        return { content: fullContent, toolCalls: [] };
      }

      messages.push({
        role: 'assistant',
        content: fullContent || '',
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
          closeAssistantBlock(lastContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut);
          console.log(`\n  ${pc.red('[STOP]')} Terminated repetitive loop after 4 consecutive identical tool calls.`);
          return { content: lastContent, toolCalls: [] };
        }

        console.log(`\n  ${pc.yellow('[WARN]')} Loop detected (repetitive tool calls). Injecting correction.`);
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
            process.stdout.write(`\n  ${pc.yellow('[WARN]')} ${pc.bold(tc.function.name)} ${pc.dim(preview)}\n`);
            const line = await (toolContext.askLine || askLine)(`  ${pc.dim('Allow? [y]es / [n]o / [a]ll for this task: ')}`);
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
      } catch (err: any) {
        toolContext.pauseSpinner = () => {};
        toolContext.resumeSpinner = () => {};
        results = approvedCalls.map(tc => ({
          toolCallId: tc.id, name: tc.function.name, success: false, content: '', error: err.message,
        }));
      }

      for (let ri = 0; ri < results.length; ri++) {
        const result = results[ri];
        let content = result.content;
        const sig = failureSignature(result.name, approvedCalls[ri]?.function?.arguments ?? '');
        if (result.success) {
          failureCounts.set(sig, 0);
        } else {
          failureCounts.set(sig, (failureCounts.get(sig) ?? 0) + 1);
        }
        if (!result.success && result.error) {
          content = `${content}\n\n[Tool Error] ${result.error}`;
        }
        const failedWriteTools = ['patch', 'write_file'];
        if (!result.success && failedWriteTools.includes(result.name)) {
          const repeated = failureCounts.get(sig) ?? 0;
          if (repeated >= 2) {
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
          console.log(pc.yellow(`\n  [AUTO] Tool '${r.name}' failed: ${snippet}`));
        }
        console.log(pc.cyan('\n  Agent will attempt to fix it...'));
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

      const routerConfig = typeof router.getConfig === 'function' ? router.getConfig() : undefined;
      const canEscalate = !config.modelOverride
        && routerConfig?.autoEscalate !== false
        && escalationCount < 3
        && !escalatedThisStreak;
      if (canEscalate && (consecutiveToolFailures >= 2 || worstRepeatedFailures >= 2)) {
        const currentName = pinnedModel || router.lastRoutedModelName || '';
        const nextModel = currentName && typeof router.getNextModel === 'function' ? router.getNextModel(currentName) : undefined;
        if (nextModel) {
          escalatedThisStreak = true;
          escalationCount++;
          pinnedModel = nextModel.name;
          console.log(pc.yellow(`\n  [ESCALATE] Repeated tool failures on ${currentName} — switching to stronger model ${nextModel.name} for the next attempt.`));
          messages.push({
            role: 'user',
            content: '[SYSTEM NOTICE] A stronger model is now handling this task after repeated tool failures. Re-examine the recent errors and the exact current state of the files before retrying. Do not repeat the same failing calls.',
          } as ChatMessage);
        }
      }

      if (consecutiveToolFailures >= 5 || worstRepeatedFailures >= 5) {
        closeAssistantBlock(lastContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut);
        console.log(pc.red('\n  [STOP] Repeated tool failures. Stopping to avoid looping.'));
        messages.push({ role: 'assistant', content: lastContent });
        return { content: lastContent, toolCalls: [] };
      }

      if (toolTurnsRemaining > 1 && process.env.DAEDALUS_AUTO_APPROVE !== 'true' && shouldPromptGate) {
        const ask = toolContext.askLine || askLine;
        const answer = await ask(turnGatePrompt());
        const norm = answer.trim().toLowerCase();

        if (norm === 'n' || norm === 'no') {
          closeAssistantBlock(lastContent.length, Date.now() - overallStart, totalToolCalls, router.lastRoutedModel, turnUsageOut);
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
        totalCompletionTokens += turnUsageOut ?? 0;
        const trivialTurn = writesThisTurn === 0 && failedThisTurn === 0 && (turnUsageOut ?? 0) <= 500;
        trivialTurnStreak = trivialTurn ? trivialTurnStreak + 1 : 0;
        const next = reclassifyTurn(currentComplexity, {
          totalCompletionTokens,
          writesThisTurn,
          toolCallsThisTurn: toolCallArray.length,
          failedToolsThisTurn: failedThisTurn,
          consecutiveTrivialTurns: trivialTurnStreak,
        });
        if (next !== currentComplexity) {
          trivialTurnStreak = 0;
          console.log(pc.dim(`  [ROUTE] Reclassified ${currentComplexity} → ${next} (${totalCompletionTokens} output tokens, ${totalToolCalls + toolCallArray.length} tool calls)`));
          currentComplexity = next;
        }
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

      const reply = response.choices[0]?.message?.content || '';
      messages.push({ role: 'assistant', content: reply });
      openAssistantBlock();
      writeAssistantChunk(reply);
      const elapsed = Date.now() - _turnStartTime;
      closeAssistantBlock(reply.length, elapsed, undefined, router.lastRoutedModel);
      return reply;
    } catch (error: any) {
      const firstLine = (error.message || '').split('\n')[0];
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
