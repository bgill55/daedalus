import { describe, it, expect } from 'vitest';
import { parseTextToolCalls } from './formatting.js';

describe('parseTextToolCalls bare-JSON branch', () => {
  it('extracts {"name":..., "arguments":{...}} with nested object args', () => {
    const text = `Here is the file:
{
  "name": "write_file",
  "arguments": {
    "content": "export const x = 1;",
    "path": "daedalus-scan/src/ranking-extra.ts"
  }
}`;
    const calls = parseTextToolCalls(text);
    expect(calls.length).toBe(1);
    expect(calls[0].function.name).toBe('write_file');
    const args = JSON.parse(calls[0].function.arguments);
    expect(args.path).toBe('daedalus-scan/src/ranking-extra.ts');
    expect(args.content).toBe('export const x = 1;');
  });

  it('extracts multiple bare-JSON tool calls', () => {
    const text = `Plan:
{
  "name": "write_file",
  "arguments": { "path": "a.ts", "content": "x" }
}
{
  "name": "terminal",
  "arguments": { "command": "npm run build", "workdir": "daedalus-scan" }
}`;
    const calls = parseTextToolCalls(text);
    expect(calls.length).toBe(2);
    expect(calls[0].function.name).toBe('write_file');
    expect(calls[1].function.name).toBe('terminal');
  });

  it('ignores JSON without a known tool name', () => {
    const text = `{"name": "not_a_real_tool", "arguments": {"x": 1}}`;
    const calls = parseTextToolCalls(text);
    expect(calls.length).toBe(0);
  });

  it('handles OpenAI shape {"function":{"name":..., "arguments":"..."}}', () => {
    const text = `{"function":{"name":"read_file","arguments":"{\"path\":\"foo.ts\"}"}}`;
    const calls = parseTextToolCalls(text);
    expect(calls.length).toBe(1);
    expect(calls[0].function.name).toBe('read_file');
    expect(JSON.parse(calls[0].function.arguments).path).toBe('foo.ts');
  });
});
