import { describe, it, expect } from 'vitest';
import { messageText } from './types.js';
import type { MessageContentPart } from './types.js';

describe('messageText', () => {
  it('returns empty string for null', () => {
    expect(messageText(null)).toBe('');
  });

  it('returns the string content as-is', () => {
    expect(messageText('hello')).toBe('hello');
  });

  it('concatenates only text parts, skipping image_url data URLs', () => {
    const content: MessageContentPart[] = [
      { type: 'text', text: 'look at this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA...huge' } },
      { type: 'text', text: ' and that' },
    ];
    expect(messageText(content)).toBe('look at this and that');
  });

  it('returns empty string when content is only an image', () => {
    const content: MessageContentPart[] = [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }];
    expect(messageText(content)).toBe('');
  });
});

describe('ToolContext sub-interfaces', () => {
  it('allows building a valid ToolContext composing all sub-interfaces', () => {
    const ctx: import('./types.js').ToolContext = {
      sessionId: 'sess-123',
      projectRoot: '/test',
      projectHash: 'hash-abc',
      activeFiles: new Map(),
      agentRole: 'coder',
      abortSignal: new AbortController().signal,
      patchHistory: [],
      terminalConsecutiveFails: 0,
      archGuardHits: 0,
    };

    expect(ctx.sessionId).toBe('sess-123');
    expect(ctx.patchHistory).toEqual([]);
    expect(ctx.terminalConsecutiveFails).toBe(0);
    expect(ctx.archGuardHits).toBe(0);
  });
});
