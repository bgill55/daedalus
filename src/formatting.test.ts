import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatMarkdownPRReply, closeAssistantBlock, openAssistantBlock, displayWidth, writeAssistantChunk } from './formatting.js';

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

  it('bottom rule width matches the top rule when stats are long', () => {
    // Simulate an open+close so _lastBoxW is set from a fixed terminal width.
    process.stdout.columns = 80;
    openAssistantBlock();
    // Long stats line that previously made the bottom wider than the top.
    closeAssistantBlock(12345, 9876, 4, 'freellmapi-gemini-3.5-flash-preview', 12345);
    // Each console.log call is one string (may contain an embedded leading \n).
    const allLines = consoleSpy.mock.calls
      .map(c => String(c[0]))
      .flatMap(s => s.split('\n'));
    const top = allLines.find(l => l.includes('Daedalus'))!;
    const bot = allLines.find(l => l.includes('·'))!;
    // displayWidth counts terminal cell width (emoji/wide glyphs = 2 cells). Both rules
    // must be exactly _lastBoxW wide (cols - 6 = 74) so the box frame stays aligned.
    const expected = 80 - 6;
    expect(displayWidth(top)).toBe(expected);
    expect(displayWidth(bot)).toBe(expected);
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

describe('parseTextToolCalls', () => {
  it('parses pipe-style tool calls like <|toolcall>call:mcpfilesystemwritefile{...}<tool_call|>', async () => {
    const { parseTextToolCalls } = await import('./formatting.js');
    const raw = `<|toolcall>call:mcpfilesystemwritefile{filepath: 'README.md', newcontent: '# PromptVault'}<tool_call|>`;
    const calls = parseTextToolCalls(raw);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('write_file');
    const args = JSON.parse(calls[0].function.arguments);
    expect(args.path).toBe('README.md');
    expect(args.content).toBe('# PromptVault');
  });

  it('strips pipe-style tool call tags from assistant response text', async () => {
    const { stripToolCallMarkup } = await import('./formatting.js');
    const raw = `<|toolcall>call:mcpfilesystemreadtextfile{path: "public/script.js"}<toolcall|>The collection dropdown should now update.`;
    const cleaned = stripToolCallMarkup(raw);
    expect(cleaned).toBe('The collection dropdown should now update.');
  });
});

describe('writeAssistantChunk (thinking renderer)', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.stdout.columns = 80;
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function output(): string {
    return consoleSpy.mock.calls.map(c => c.join(' ')).join('\n');
  }

  it('renders a complete think block in dim (gray) font and strips the tags', () => {
    openAssistantBlock();
    writeAssistantChunk('<think>Let me figure out the best approach here.</think>Hello!');
    closeAssistantBlock(10, 500, 0, 'model-x');
    const text = output();
    // Tags must never appear in the rendered output.
    expect(text).not.toContain('<think>');
    expect(text).not.toContain('</think>');
    // Think content is dimmed.
    expect(text).toContain('\x1b[2m');
    // Answer content is bright white.
    expect(text).toContain('\x1b[97m');
    expect(text).toContain('Hello!');
  });

  it('handles think tags split across stream chunks', () => {
    openAssistantBlock();
    writeAssistantChunk('<thi');
    writeAssistantChunk('nk>reasoning mid');
    writeAssistantChunk('dle</think>final answer');
    closeAssistantBlock(10, 500, 0, 'model-x');
    const text = output();
    expect(text).not.toContain('<think>');
    expect(text).not.toContain('</think>');
    expect(text).toContain('reasoning mid');
    expect(text).toContain('final answer');
    // Both dim (thinking) and bright (answer) segments present.
    expect(text).toContain('\x1b[2m');
    expect(text).toContain('\x1b[97m');
  });

  it('renders a reply with no think block in bright white only', () => {
    openAssistantBlock();
    writeAssistantChunk('Just a plain reply.');
    closeAssistantBlock(10, 500, 0, 'model-x');
    const text = output();
    expect(text).toContain('Just a plain reply.');
    expect(text).toContain('\x1b[97m');
    // No think-only sentinel content is rendered (no reasoning was emitted).
    expect(text).not.toContain('SECRETTHINK');
  });

  it('keeps think content separated from the answer (no tag leakage)', () => {
    openAssistantBlock();
    writeAssistantChunk('<think>SECRETTHINK internal reasoning</think>The answer is 42.');
    closeAssistantBlock(10, 500, 0, 'model-x');
    const text = output();
    // The think sentinel is rendered (dimmed) but the literal tags are gone.
    expect(text).toContain('SECRETTHINK');
    expect(text).not.toContain('<think>');
    expect(text).not.toContain('</think>');
    expect(text).toContain('The answer is 42.');
  });

  it('does not render an open think block as white when the closer splits across chunks', () => {
    openAssistantBlock();
    // Open <think> arrives in one chunk; the closing </think> arrives later. The interim
    // reasoning must stay dimmed, never flash white.
    writeAssistantChunk('<think>reasoning begins');
    writeAssistantChunk(' and continues');
    writeAssistantChunk('dle</think>the answer');
    closeAssistantBlock(10, 500, 0, 'model-x');
    const text = output();
    expect(text).not.toContain('<think>');
    expect(text).not.toContain('</think>');
    expect(text).toContain('reasoning begins');
    expect(text).toContain('the answer');
    // Reasoning rendered dimmed.
    expect(text).toContain('\x1b[2m');
    // Actual answer rendered bright (white), not as a leaked tag.
    expect(text).toContain('\x1b[97m');
  });

  it('collapses runs of blank lines into a single separator (no dead space)', () => {
    openAssistantBlock();
    writeAssistantChunk('Line one.\n\n\n\n\n\nLine two.');
    closeAssistantBlock(10, 500, 0, 'model-x');
    const text = output();
    expect(text).toContain('Line one.');
    expect(text).toContain('Line two.');
    // No more than one blank rendered line may sit between two content lines.
    const lines = text.split('\n').map(l => l.replace(/\x1b\[[0-9;]*m/g, '').trim());
    const i1 = lines.indexOf('Line one.');
    const i2 = lines.indexOf('Line two.');
    const between = lines.slice(i1 + 1, i2);
    expect(between.filter(l => l === '').length).toBeLessThanOrEqual(1);
  });

});
