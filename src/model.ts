import pc from 'picocolors';
import { BUILTIN_TOOLS, POWER_TOOLS } from './tools/definitions.js';
import { executeToolCalls } from './tools/executor.js';
import { mcpRegistry } from './tools/mcp/registry.js';
import { DaedalusSpinner } from './tools/daedalus-spinner.js';
import { calculateSessionTokens, pruneMessages } from './session/tokens.js';
import { parseTextToolCalls, openAssistantBlock, writeAssistantChunk, closeAssistantBlock } from './formatting.js';
import type { ToolContext, ToolCall, ChatMessage } from './types.js';
import type { LocalRouter, ChatResponse } from './router/index.js';

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

export interface ModelDeps {
  messages: ChatMessage[];
  config: any;
  router: LocalRouter;
  toolContext: ToolContext;
  buildFileContext: () => string;
  askLine: (prompt: string) => Promise<string>;
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
  const { messages, config, router, toolContext, buildFileContext, askLine } = deps;

  async function callModelWithTools(
    userContent: string,
    imageBase64?: string,
  ): Promise<{ content: string; toolCalls: ToolCall[] }> {
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
    if (config.ui.showTokens) {
      const maxT = config.context.maxTokens ?? 128000;
      const summarizeAt = config.context.summarizeAt ?? 0.8;
      const threshold = Math.floor(maxT * summarizeAt);

      const fileCtx = buildFileContext();
      const tokens = calculateSessionTokens(messages, fileCtx);
      if (tokens.total > threshold) {
        console.log(pc.yellow(`\n  ${pc.bold('[WARN]')} Context budget threshold exceeded (${Math.round(summarizeAt * 100)}%). Auto-pruning older turns...`));
        const target = Math.floor(maxT * 0.6);
        const pruneResult = pruneMessages(messages, fileCtx, target);
        if (pruneResult.prunedTurns > 0 || pruneResult.truncatedTools > 0) {
          console.log(`  ${pc.green('✔')} Pruned ${pruneResult.prunedTurns} older cycles and truncated ${pruneResult.truncatedTools} tool outputs (saved ~${Math.round(pruneResult.savedTokens / 1000)}kt).`);
        }
      }
    }

    const allTools = [...BUILTIN_TOOLS, ...POWER_TOOLS, ...mcpRegistry.getToolDefinitions()];

    _turnStartTime = Date.now();

    let lastContent = '';
    let turn = 0;

    while (turn < MAX_TOOL_TURNS) {
      const spinner = new DaedalusSpinner({ text: 'Daedalus thinking', color: (s) => pc.cyan(s) });
      spinner.start();

      let fullContent = '';
      const toolCallMap: Map<number, ToolCall> = new Map();
      let blockOpened = false;
      const turnStart = Date.now();

      const openBlock = () => {
        if (!blockOpened) {
          blockOpened = true;
          spinner.stop();
          openAssistantBlock();
        }
      };

      const signal = ensureAbortController().signal;

      try {
        const stream = await router.chatStream({
          model: 'auto',
          messages,
          temperature: 0.1,
          tools: allTools,
          tool_choice: 'auto',
          stream: true,
          signal,
        });

        for await (const chunk of stream) {
          if (signal.aborted) break;
          const choice = chunk.choices[0];
          if (!choice) continue;

          const delta = choice.delta;

          if (delta.content) {
            openBlock();
            fullContent += delta.content;
            writeAssistantChunk(delta.content);
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
          if (blockOpened) closeAssistantBlock(fullContent.length, Date.now() - turnStart, undefined, router.lastRoutedModel);
          console.log(pc.dim('\n  [STOP] Stopped'));
          clearAbortController();
          return { content: fullContent, toolCalls: [] };
        }

      } catch (error: any) {
        if (signal.aborted) {
          spinner.stop();
          console.log(pc.dim('\n  [STOP] Stopped'));
          clearAbortController();
          return { content: '', toolCalls: [] };
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

      if (blockOpened) {
        closeAssistantBlock(fullContent.length, Date.now() - turnStart, toolCallArray.length, router.lastRoutedModel);
      }

      if (toolCallArray.length === 0) {
        messages.push({ role: 'assistant', content: fullContent });
        return { content: fullContent, toolCalls: [] };
      }

      messages.push({
        role: 'assistant',
        content: fullContent || '',
        tool_calls: toolCallArray,
      });

      const dangerousTools = ['terminal', 'write_file'];
      let turnApproved = false;
      const approvedCallIndices = new Set<number>();

      for (let i = 0; i < toolCallArray.length; i++) {
        const tc = toolCallArray[i];
        if (dangerousTools.includes(tc.function.name) && !turnApproved) {
          const args = tc.function.arguments;
          const preview = args.length > 120 ? args.slice(0, 120) + '...' : args;
          process.stdout.write(`\n  ${pc.yellow('[WARN]')} ${pc.bold(tc.function.name)} ${pc.dim(preview)}\n`);
          const line = await askLine(`  ${pc.dim('Allow? [y]es / [n]o / [a]ll for this turn: ')}`);
          const char = line.trim().toLowerCase().slice(0, 1);
          if (char === 'a') turnApproved = true;
          if (char === 'n') {
            console.log(`  ${pc.red('[FAIL]')} ${tc.function.name} ${pc.red(' — rejected')}`);
            continue;
          }
        }
        approvedCallIndices.add(i);
      }

      const approvedCalls = toolCallArray.filter((_, i) => approvedCallIndices.has(i));

      console.log(`\n  ${pc.dim('[TOOL]')} ${pc.dim(`Executing ${approvedCalls.length} tool call(s)...`)}`);
      
      const toolNames = approvedCalls.map(c => c.function.name);
      const spinnerLabel = approvedCalls.length === 1
        ? `Executing ${toolNames[0]}`
        : `Executing ${approvedCalls.length} tool calls (${toolNames.join(', ')})`;

      const toolSpinner = new DaedalusSpinner({
        text: spinnerLabel,
        color: (s) => pc.dim(s)
      });
      toolSpinner.start();

      toolContext.pauseSpinner = () => {
        toolSpinner.stop();
      };
      toolContext.resumeSpinner = () => {
        toolSpinner.start();
      };

      let results;
      try {
        results = await executeToolCalls(approvedCalls, toolContext);
      } finally {
        toolSpinner.stop();
        toolContext.pauseSpinner = () => {};
        toolContext.resumeSpinner = () => {};
      }

      for (const result of results) {
        messages.push({
          role: 'tool',
          content: truncateToolResult(result.content),
          tool_call_id: result.toolCallId,
        } as ChatMessage);

        const status = result.success ? pc.green('✔') : pc.red('✗');
        console.log(`  ${status} ${result.name}`);
        if (!result.success && result.error) {
          console.log(pc.red(`     Error: ${result.error}`));
        }
        if (result.success && result.content) {
          const contentStr = result.content;
          const lines = contentStr.split('\n');
          const previewLines = lines.slice(0, 3);
          for (const line of previewLines) {
            const truncated = line.length > 120 ? line.slice(0, 120) + '…' : line;
            if (truncated.trim()) console.log(`  ${pc.dim('┃')} ${pc.gray(truncated)}`);
          }
          if (lines.length > 3) {
            console.log(`  ${pc.dim('┃')} ${pc.dim(`… ${lines.length - 3} more line${lines.length - 3 > 1 ? 's' : ''}`)}`);
          }
        }
        if (result.success && result.name === 'screenshot_page') {
          try {
            const parsed = JSON.parse(result.content);
            if (parsed.type === 'vision' && parsed.base64) {
              messages.push({
                role: 'user',
                content: [
                  { type: 'text', text: `[Screenshot of ${parsed.url}${parsed.selector ? ` > ${parsed.selector}` : ''}]` },
                  { type: 'image_url', image_url: { url: `data:image/png;base64,${parsed.base64}` } },
                ],
              } as ChatMessage);
              console.log(`  ${pc.cyan('[VISION]')} Screenshot injected into context (${Math.round(parsed.base64.length * 0.75 / 1024)}KB)`);
            }
          } catch {}
        }
      }

      turn++;
    }

    console.log(`\n  ${pc.yellow('[WARN]')} ${pc.yellow(`Reached max tool turns (${MAX_TOOL_TURNS}). Stopping.`)}`);
    messages.push({ role: 'assistant', content: lastContent });
    return { content: lastContent, toolCalls: [] };
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
        model: 'auto',
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
