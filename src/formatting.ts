import pc from 'picocolors';
import type { ToolCall } from './types.js';

export const termW = Math.max(50, (process.stdout.columns ?? 80) - 5);

export function wrapLine(line: string, maxW: number): string[] {
  if (line.length <= maxW) return [line];
  const words = line.split(' ');
  const result: string[] = [];
  let cur = '';
  for (const word of words) {
    if (cur && cur.length + 1 + word.length <= maxW) {
      cur += ' ' + word;
    } else {
      if (cur) result.push(cur);
      cur = word;
      while (cur.length > maxW) {
        result.push(cur.slice(0, maxW));
        cur = cur.slice(maxW);
      }
    }
  }
  if (cur) result.push(cur);
  return result;
}

export function printUserTurn(userMessage: string): void {
  const bdr = (s: string) => pc.dim(pc.yellow(s));
  const lines = userMessage.split('\n');

  let maxLineLen = 0;
  const allWrappedLines: string[] = [];
  for (const line of lines) {
    const wrapped = wrapLine(line, termW);
    allWrappedLines.push(...wrapped);
    for (const part of wrapped) {
      if (part.length > maxLineLen) maxLineLen = part.length;
    }
  }

  const w = Math.max(15, maxLineLen);

  console.log(`\n  ${bdr('╭─')} ${pc.yellow(pc.bold('⬡ You'))} ${bdr('─'.repeat(Math.max(0, w - 7)))}${bdr('╮')}`);
  for (const part of allWrappedLines) {
    console.log(`  ${bdr('│')} ${pc.white(part)}${' '.repeat(Math.max(0, w - part.length))}${bdr('│')}`);
  }
  console.log(`  ${bdr('╰')}${bdr('─'.repeat(w + 1))}${bdr('╯')}`);
  console.log();
}

let _assistantLineBuf = '';
let _inCodeBlock = false;

export function stripAnsi(str: string): string {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

export function wrapAnsiLine(line: string, maxW: number): string[] {
  if (stripAnsi(line).length <= maxW) return [line];
  const words = line.split(' ');
  const result: string[] = [];
  let cur = '';
  for (const word of words) {
    const curVisible = stripAnsi(cur).length;
    const wordVisible = stripAnsi(word).length;
    if (cur && curVisible + 1 + wordVisible <= maxW) {
      cur += ' ' + word;
    } else {
      if (cur) result.push(cur);
      cur = word;
      while (stripAnsi(cur).length > maxW) {
        result.push(cur);
        cur = '';
      }
    }
  }
  if (cur) result.push(cur);
  return result;
}

export function formatMarkdownLine(line: string): string {
  if (line.startsWith('# ')) return pc.bold(pc.cyan(line.substring(2)));
  if (line.startsWith('## ')) return pc.bold(pc.cyan(line.substring(3)));
  if (line.startsWith('### ')) return pc.bold(pc.cyan(line.substring(4)));
  if (line.startsWith('> ')) return `${pc.gray('│')} ${pc.italic(line.substring(2))}`;

  let prefix = '';
  let content = line;
  const listMatch = line.match(/^(\s*)([\*\-\+•])\s+(.*)$/);
  if (listMatch) {
    prefix = `${listMatch[1]}${pc.gray('•')} `;
    content = listMatch[3];
  }
  content = content.replace(/\`(.*?)\`/g, (_, p1) => pc.yellow(p1));
  content = content.replace(/\*\*(.*?)\*\*/g, (_, p1) => pc.bold(p1));
  content = content.replace(/\*(.*?)\*/g, (_, p1) => pc.italic(p1));
  content = content.replace(/_(.*?)_/g, (_, p1) => pc.italic(p1));
  return prefix + content;
}

export function openAssistantBlock(): void {
  console.log(`\n  ${pc.cyan(pc.bold('◇ Daedalus'))}`);
}

export function writeAssistantChunk(chunk: string): void {
  _assistantLineBuf += chunk;
  const lines = _assistantLineBuf.split('\n');
  _assistantLineBuf = lines.pop() || '';
  for (const line of lines) {
    const isCodeBlockDelimiter = line.trim().startsWith('```');
    if (isCodeBlockDelimiter) _inCodeBlock = !_inCodeBlock;
    if (_inCodeBlock || isCodeBlockDelimiter) {
      for (const part of wrapLine(line, termW)) {
        console.log(`  ${pc.gray(part)}`);
      }
    } else {
      const formatted = formatMarkdownLine(line);
      for (const part of wrapAnsiLine(formatted, termW)) {
        console.log(`  ${part}`);
      }
    }
  }
}

export function closeAssistantBlock(
  tokens: number,
  elapsedMs: number,
  toolCount?: number,
  modelName?: string,
): void {
  if (_assistantLineBuf) {
    const isCodeBlockDelimiter = _assistantLineBuf.trim().startsWith('```');
    if (isCodeBlockDelimiter) _inCodeBlock = !_inCodeBlock;
    if (_inCodeBlock || isCodeBlockDelimiter) {
      for (const part of wrapLine(_assistantLineBuf, termW)) {
        console.log(`  ${pc.gray(part)}`);
      }
    } else {
      const formatted = formatMarkdownLine(_assistantLineBuf);
      for (const part of wrapAnsiLine(formatted, termW)) {
        console.log(`  ${part}`);
      }
    }
  }
  _assistantLineBuf = '';
  _inCodeBlock = false;

  const modelStr = modelName ? `${modelName}  ·  ` : '';
  const meta = toolCount !== undefined
    ? `${modelStr}${toolCount} tool(s)  ·  ~${Math.round(tokens / 4)}t out  ·  ${elapsedMs}ms`
    : `${modelStr}~${Math.round(tokens / 4)}t out  ·  ${elapsedMs}ms`;
  console.log(`  ${pc.dim(meta)}\n`);
}

export function turnSeparator(): void {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  console.log(`  ${pc.dim('─'.repeat(58))} ${pc.dim(ts)}`);
}

export function parseTextToolCalls(text: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  const regex = /<(longcat_)?tool_call>([\s\S]*?)<\/(longcat_)?tool_call>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const blockContent = match[2].trim();
    const lines = blockContent.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const toolName = lines[0].replace(/<[^>]+>/g, '').trim();

    const args: Record<string, any> = {};
    const keyRegex = /<(longcat_)?arg_key>([\s\S]*?)<\/(longcat_)?arg_key>/g;
    const valRegex = /<(longcat_)?arg_value>([\s\S]*?)<\/(longcat_)?arg_value>/g;

    const keys: string[] = [];
    const values: string[] = [];

    let keyMatch;
    while ((keyMatch = keyRegex.exec(blockContent)) !== null) {
      keys.push(keyMatch[2].trim());
    }

    let valMatch;
    while ((valMatch = valRegex.exec(blockContent)) !== null) {
      values.push(valMatch[2].trim());
    }

    for (let i = 0; i < Math.min(keys.length, values.length); i++) {
      const k = keys[i];
      const v = values[i];
      try { args[k] = JSON.parse(v); } catch { args[k] = v; }
    }

    toolCalls.push({
      id: `call_parsed_${Date.now()}_${toolCalls.length}`,
      type: 'function',
      function: { name: toolName, arguments: JSON.stringify(args) },
    });
  }
  return toolCalls;
}
