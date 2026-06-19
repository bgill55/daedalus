import { describe, it, expect } from 'vitest';
import { parseTextToolCalls, formatMarkdownLine } from './index.js';

describe('parseTextToolCalls', () => {
  it('should parse longcat_tool_call with keys and values', () => {
    const text = `
Let me find and read the README first.
<longcat_tool_call>search_files
<longcat_arg_key>pattern</longcat_arg_key>
<longcat_arg_value>README</longcat_arg_value>
</longcat_tool_call>
    `;
    const calls = parseTextToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('search_files');
    expect(JSON.parse(calls[0].function.arguments)).toEqual({
      pattern: 'README',
    });
  });

  it('should parse standard tool_call tags as well', () => {
    const text = `
<tool_call>read_file
<arg_key>path</arg_key>
<arg_value>package.json</arg_value>
</tool_call>
    `;
    const calls = parseTextToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('read_file');
    expect(JSON.parse(calls[0].function.arguments)).toEqual({
      path: 'package.json',
    });
  });

  it('should support multiple arguments', () => {
    const text = `
<longcat_tool_call>patch
<longcat_arg_key>path</longcat_arg_key>
<longcat_arg_value>src/main.ts</longcat_arg_value>
<longcat_arg_key>old_string</longcat_arg_key>
<longcat_arg_value>foo</longcat_arg_value>
<longcat_arg_key>new_string</longcat_arg_key>
<longcat_arg_value>bar</longcat_arg_value>
</longcat_tool_call>
    `;
    const calls = parseTextToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('patch');
    expect(JSON.parse(calls[0].function.arguments)).toEqual({
      path: 'src/main.ts',
      old_string: 'foo',
      new_string: 'bar',
    });
  });

  it('should return empty array if no tags are present', () => {
    const text = 'Just some normal conversation text with no tags.';
    const calls = parseTextToolCalls(text);
    expect(calls).toHaveLength(0);
  });
});

describe('formatMarkdownLine', () => {
  it('should format headers', () => {
    expect(formatMarkdownLine('# Header 1')).toContain('Header 1');
    expect(formatMarkdownLine('## Header 2')).toContain('Header 2');
    expect(formatMarkdownLine('### Header 3')).toContain('Header 3');
  });

  it('should format lists', () => {
    expect(formatMarkdownLine('* Bullet')).toContain('Bullet');
    expect(formatMarkdownLine('  - Indented Bullet')).toContain('  ');
  });

  it('should format bold, italic, and inline code', () => {
    const formatted = formatMarkdownLine('This is **bold**, *italic*, and `code` text.');
    expect(formatted).toContain('bold');
    expect(formatted).toContain('italic');
    expect(formatted).toContain('code');
    expect(formatted).not.toContain('`code`');
  });
});
