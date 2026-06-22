// Context summarization — compresses older conversation cycles into a single LLM-generated summary
// before resorting to hard pruning.

import pc from 'picocolors';
import { estimateMessageTokens } from './tokens.js';
import type { ChatMessage } from '../types.js';

export interface SummaryResult {
  /** How many turns were summarized */
  summarizedTurns: number;
  /** How many tokens were saved */
  savedTokens: number;
}

/**
 * Summarizes older conversation cycles using the model router.
 * Keeps the last `keepTurns` cycles intact and compresses everything older.
 * Falls through to a brief summary if the LLM call fails.
 */
export async function summarizeMessages(
  messages: ChatMessage[],
  targetTokens: number,
  summarizeFn: (systemPrompt: string, userContent: string) => Promise<string>,
  keepTurns = 2,
): Promise<SummaryResult> {
  const systemPrompt = messages[0]?.role === 'system' ? messages[0] : null;
  const nonSystemMessages = systemPrompt ? messages.slice(1) : messages;

  // Group messages into user-led cycles
  interface Cycle { startIdx: number; messages: ChatMessage[]; tokens: number }
  const cycles: Cycle[] = [];
  let current: ChatMessage[] = [];
  let currentStart = systemPrompt ? 1 : 0;

  for (let i = 0; i < nonSystemMessages.length; i++) {
    const msg = nonSystemMessages[i];
    if (msg.role === 'user' && current.length > 0) {
      cycles.push({
        startIdx: currentStart,
        messages: current,
        tokens: current.reduce((s, m) => s + estimateMessageTokens(m), 0),
      });
      current = [];
      currentStart = (systemPrompt ? 1 : 0) + i;
    }
    current.push(msg);
  }
  if (current.length > 0) {
    cycles.push({ startIdx: currentStart, messages: current, tokens: current.reduce((s, m) => s + estimateMessageTokens(m), 0) });
  }

  // Only summarize if we have more cycles than keepTurns
  if (cycles.length <= keepTurns) return { summarizedTurns: 0, savedTokens: 0 };

  const olderCycles = cycles.slice(0, cycles.length - keepTurns);
  const totalTokens = olderCycles.reduce((s, c) => s + c.tokens, 0);
  if (totalTokens < 500) return { summarizedTurns: 0, savedTokens: 0 };

  // Build a condensed version of the older conversation
  const olderMessages = olderCycles.flatMap(c => c.messages);
  const transcript = olderMessages.map(m => {
    const role = m.role.toUpperCase();
    if (m.role === 'tool') {
      const preview = typeof m.content === 'string' ? m.content.slice(0, 200) : '';
      return `[TOOL RESULT] ${preview}`;
    }
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return `[${role}] ${content.slice(0, 500)}`;
  }).join('\n\n');

  const summaryPrompt = `Summarize the following technical conversation excerpt. Focus on:
1. What was the goal or task?
2. What key decisions were made?
3. What files were changed or discussed?
4. What is currently pending or unresolved?
5. Any important technical details discovered.

Keep the summary under 300 words. Write in past tense. Here is the conversation:\n\n${transcript}`;

  let summaryText = '';
  try {
    summaryText = await summarizeFn(
      'You are a precise technical summarizer. Output only the summary, no preamble.',
      summaryPrompt,
    );
    summaryText = summaryText.trim().slice(0, 2000);
  } catch {
    // Fallback: brief description-based summary
    const toolsCalled = new Set<string>();
    const filesMentioned = new Set<string>();
    for (const msg of olderMessages) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolsCalled.add(tc.function.name);
          try {
            const args = JSON.parse(tc.function.arguments);
            if (args.path) filesMentioned.add(args.path);
            if (args.filePath) filesMentioned.add(args.filePath);
          } catch {}
        }
      }
    }
    const toolList = [...toolsCalled].join(', ');
    const fileList = [...filesMentioned].slice(0, 5).join(', ');
    summaryText = `Earlier conversation: used ${toolList || 'various tools'} on ${fileList || 'the codebase'}. Key context has been compressed to save tokens.`;
  }

  const summaryMessage: ChatMessage = {
    role: 'system',
    content: `[Summarized earlier conversation]: ${summaryText}`,
  };

  const summaryTokens = estimateMessageTokens(summaryMessage);
  const saved = totalTokens - summaryTokens;

  // Replace older cycles with the summary message
  const firstOldIdx = olderCycles[0].startIdx;
  const lastOldEnd = olderCycles[olderCycles.length - 1].startIdx + olderCycles[olderCycles.length - 1].messages.length;

  const before = messages.slice(0, firstOldIdx);
  const after = messages.slice(lastOldEnd);
  messages.length = 0;
  messages.push(...before, summaryMessage, ...after);

  return {
    summarizedTurns: olderCycles.flatMap(c => c.messages).filter(m => m.role === 'user' || m.role === 'assistant').length,
    savedTokens: saved,
  };
}
