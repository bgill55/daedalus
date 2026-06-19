import { ChatMessage } from '../types.js';

/**
 * Estimates token count for a text string using a standard character-to-token ratio.
 * For mixed code and English, ~3.8 characters per token is a safe, slightly conservative estimate.
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.8);
}

/**
 * Estimates token count for a single chat message.
 */
export function estimateMessageTokens(message: ChatMessage): number {
  let count = 0;
  if (typeof message.content === 'string') {
    count += estimateTokenCount(message.content);
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'text') {
        count += estimateTokenCount(part.text ?? '');
      } else if (part.type === 'image_url') {
        // High-resolution images typically cost between 85-2000 tokens.
        // We use a safe estimate of 1000 tokens.
        count += 1000;
      }
    }
  }

  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      count += estimateTokenCount(tc.function.name);
      count += estimateTokenCount(tc.function.arguments);
    }
  }

  return count;
}

/**
 * Calculates session token usage breakdown.
 */
export function calculateSessionTokens(
  messages: ChatMessage[],
  activeFilesContext: string
): { system: number; history: number; activeFiles: number; total: number } {
  let system = 0;
  let history = 0;
  const activeFiles = estimateTokenCount(activeFilesContext);

  for (const msg of messages) {
    const tokens = estimateMessageTokens(msg);
    if (msg.role === 'system') {
      system += tokens;
    } else {
      history += tokens;
    }
  }

  return {
    system,
    history,
    activeFiles,
    total: system + history + activeFiles,
  };
}

interface ConversationCycle {
  startIndex: number;
  messages: ChatMessage[];
  tokens: number;
}

/**
 * Prunes the conversation history to fit within a target token limit.
 * First truncates large tool outputs in older turns (preserving the last K turns).
 * If still over budget, removes entire older user-led conversation cycles (preserving system prompt and last K turns).
 * Returns the number of pruned/modified items and the token savings.
 */
export function pruneMessages(
  messages: ChatMessage[],
  activeFilesContext: string,
  targetLimit: number,
  keepLastTurnsCount = 3
): { prunedTurns: number; truncatedTools: number; savedTokens: number } {
  const initialTokens = calculateSessionTokens(messages, activeFilesContext).total;
  if (initialTokens <= targetLimit) {
    return { prunedTurns: 0, truncatedTools: 0, savedTokens: 0 };
  }

  // 1. Group messages into user-led cycles (excluding the system prompt)
  const systemPrompt = messages[0]?.role === 'system' ? messages[0] : null;
  const nonSystemMessages = systemPrompt ? messages.slice(1) : messages;

  const cycles: ConversationCycle[] = [];
  let currentCycle: ChatMessage[] = [];
  let currentStartIndex = systemPrompt ? 1 : 0;

  for (let i = 0; i < nonSystemMessages.length; i++) {
    const msg = nonSystemMessages[i];
    if (msg.role === 'user' && currentCycle.length > 0) {
      cycles.push({
        startIndex: currentStartIndex,
        messages: currentCycle,
        tokens: currentCycle.reduce((sum, m) => sum + estimateMessageTokens(m), 0),
      });
      currentCycle = [];
      currentStartIndex = (systemPrompt ? 1 : 0) + i;
    }
    currentCycle.push(msg);
  }
  if (currentCycle.length > 0) {
    cycles.push({
      startIndex: currentStartIndex,
      messages: currentCycle,
      tokens: currentCycle.reduce((sum, m) => sum + estimateMessageTokens(m), 0),
    });
  }

  let truncatedToolsCount = 0;

  // 2. Pass 1: Truncate large tool outputs in cycles older than the last keepLastTurnsCount
  if (cycles.length > keepLastTurnsCount) {
    const olderCycles = cycles.slice(0, cycles.length - keepLastTurnsCount);
    for (const cycle of olderCycles) {
      for (const msg of cycle.messages) {
        if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 1000) {
          const originalLen = msg.content.length;
          msg.content = `[Tool output truncated (${originalLen} chars originally)]`;
          truncatedToolsCount++;
        }
      }
      // Re-calculate cycle tokens
      cycle.tokens = cycle.messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
    }
  }

  let currentTokens = calculateSessionTokens(messages, activeFilesContext).total;
  if (currentTokens <= targetLimit) {
    return {
      prunedTurns: 0,
      truncatedTools: truncatedToolsCount,
      savedTokens: initialTokens - currentTokens,
    };
  }

  // 3. Pass 2: Remove entire cycles from oldest to newest (preserving last keepLastTurnsCount cycles)
  let cyclesRemovedCount = 0;
  while (cycles.length > keepLastTurnsCount && currentTokens > targetLimit) {
    const removedCycle = cycles.shift()!;
    cyclesRemovedCount++;
    currentTokens -= removedCycle.tokens;
  }

  // 4. Reconstruct the messages array
  const newMessages: ChatMessage[] = [];
  if (systemPrompt) {
    newMessages.push(systemPrompt);
  }
  for (const cycle of cycles) {
    newMessages.push(...cycle.messages);
  }

  messages.length = 0;
  messages.push(...newMessages);

  return {
    prunedTurns: cyclesRemovedCount,
    truncatedTools: truncatedToolsCount,
    savedTokens: initialTokens - currentTokens,
  };
}
