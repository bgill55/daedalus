import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatMarkdownPRReply, closeAssistantBlock } from './formatting.js';

describe('closeAssistantBlock', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function output(): string {
    return consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
  }

  it('renders the real token count when realOutTokens is provided', () => {
    closeAssistantBlock(100, 2000, 3, 'model-x', 1500);
    const text = output();
    expect(text).toContain('3 tool(s)');
    expect(text).toContain('1.5k out');
    expect(text).toContain('750.0 tok/s');
  });

  it('renders small real token counts without the k suffix', () => {
    closeAssistantBlock(100, 1000, 0, 'model-x', 120);
    const text = output();
    expect(text).toContain('120 out');
  });

  it('keeps the char-based estimate when realOutTokens is omitted', () => {
    closeAssistantBlock(4000, 2000, 2, 'model-x');
    const text = output();
    expect(text).toContain('2 tool(s)');
    expect(text).toContain('1.0k out');
    expect(text).toContain('500.0 tok/s');
  });
});

describe('formatMarkdownPRReply', () => {
  it('cleans up raw HTML details tags, br tags, and images', () => {
    const raw = `<details open>\n<summary>Description</summary>\n<br/>\nSome details text.\n<img src="https://example.com/badge.svg" />\n</details>`;
    const cleaned = formatMarkdownPRReply(raw);
    expect(cleaned).not.toContain('<details open>');
    expect(cleaned).toContain('<details>');
    expect(cleaned).not.toContain('<br/>');
    expect(cleaned).toContain('![](https://example.com/badge.svg)');
  });

  it('normalizes excessive blank lines', () => {
    const raw = `Line 1\n\n\n\nLine 2`;
    const cleaned = formatMarkdownPRReply(raw);
    expect(cleaned).toBe(`Line 1\n\nLine 2`);
  });
});
