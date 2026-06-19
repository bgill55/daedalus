import { describe, it, expect } from 'vitest';
import { ChatMessage } from '../types.js';
import {
  estimateTokenCount,
  estimateMessageTokens,
  calculateSessionTokens,
  pruneMessages,
} from './tokens.js';

describe('Token estimation utilities', () => {
  it('should estimate token counts based on char length', () => {
    expect(estimateTokenCount('')).toBe(0);
    expect(estimateTokenCount('hello')).toBe(2); // Math.ceil(5 / 3.8)
    expect(estimateTokenCount('hello world')).toBe(3); // Math.ceil(11 / 3.8)
  });

  it('should estimate message tokens correctly', () => {
    const textMessage: ChatMessage = { role: 'user', content: 'test message content' };
    expect(estimateMessageTokens(textMessage)).toBe(Math.ceil(20 / 3.8));

    const imageMessage: ChatMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'image prompt' },
        { type: 'image_url', image_url: { url: 'data:...' } },
      ],
    };
    expect(estimateMessageTokens(imageMessage)).toBe(Math.ceil(12 / 3.8) + 1000);

    const toolCallMessage: ChatMessage = {
      role: 'assistant',
      content: 'thinking',
      tool_calls: [
        {
          id: '1',
          type: 'function',
          function: { name: 'test_tool', arguments: '{"arg": 1}' },
        },
      ],
    };
    const expected =
      Math.ceil(8 / 3.8) + // content
      Math.ceil(9 / 3.8) + // tool name
      Math.ceil(10 / 3.8); // tool args
    expect(estimateMessageTokens(toolCallMessage)).toBe(expected);
  });

  it('should calculate session tokens breakdown', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system message' },
      { role: 'user', content: 'user message' },
      { role: 'assistant', content: 'ai reply' },
    ];
    const fileCtx = 'file contents here';
    const breakdown = calculateSessionTokens(messages, fileCtx);

    expect(breakdown.system).toBe(estimateTokenCount('system message'));
    expect(breakdown.history).toBe(
      estimateTokenCount('user message') + estimateTokenCount('ai reply')
    );
    expect(breakdown.activeFiles).toBe(estimateTokenCount(fileCtx));
    expect(breakdown.total).toBe(
      breakdown.system + breakdown.history + breakdown.activeFiles
    );
  });
});

describe('Pruning conversation history', () => {
  it('should not prune if total tokens are within budget', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'user' },
    ];
    const result = pruneMessages(messages, '', 1000);
    expect(result.prunedTurns).toBe(0);
    expect(result.truncatedTools).toBe(0);
    expect(messages.length).toBe(2);
  });

  it('should truncate large tool outputs in older turns first', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'old turn' },
      { role: 'tool', content: 'a'.repeat(2000) }, // very large tool output
      { role: 'user', content: 'recent turn' },
      { role: 'assistant', content: 'reply' },
    ];

    // Total characters: 3 + 8 + 2000 + 11 + 5 = 2027 chars -> ~534 tokens
    // We keep last 1 turn (recent turn + reply = 1 cycle).
    // The older cycle's tool output should get truncated.
    const targetLimit = 200; // sufficiently small
    const result = pruneMessages(messages, '', targetLimit, 1);

    expect(result.truncatedTools).toBe(1);
    expect(messages[2].content).toContain('[Tool output truncated');
    expect(messages.length).toBe(5); // none of the cycles removed yet because truncation solved it
  });

  it('should remove older cycles if truncation is not enough', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'cycle 1 user content' },
      { role: 'assistant', content: 'cycle 1 assistant content' },
      { role: 'user', content: 'cycle 2 user content' },
      { role: 'assistant', content: 'cycle 2 assistant content' },
      { role: 'user', content: 'cycle 3 user content' },
      { role: 'assistant', content: 'cycle 3 assistant' },
    ];

    // Keep last 1 turn. Prune target limit is very small, so cycle 1 and cycle 2 should be removed.
    const targetLimit = 15;
    const result = pruneMessages(messages, '', targetLimit, 1);

    expect(result.prunedTurns).toBe(2); // cycle 1 and cycle 2 removed
    expect(messages.length).toBe(3); // system prompt + cycle 3 (user + assistant)
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toBe('cycle 3 user content');
    expect(messages[2].content).toBe('cycle 3 assistant');
  });
});
