import pc from 'picocolors';
import type { ToolCall } from './types.js';

export const termW = Math.max(50, (process.stdout.columns ?? 80) - 5);

function stripAnsi(str: string): string {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

// ── Line wrapping ──────────────────────────────────────────────

function wrapLine(line: string, maxW: number): string[] {
  if (stripAnsi(line).length <= maxW) return [line];
  const words = line.split(' ');
  const result: string[] = [];
  let cur = '';
  for (const word of words) {
    const curVis = stripAnsi(cur).length;
    const wordVis = stripAnsi(word).length;
    if (cur && curVis + 1 + wordVis <= maxW) {
      cur += ' ' + word;
    } else {
      if (cur) result.push(cur);
      cur = word;
    }
  }
  if (cur) result.push(cur);
  return result;
}

// ── User message ───────────────────────────────────────────────

export function printUserTurn(userMessage: string): void {
  const lines = userMessage.split('\n');
  const wrapped: string[] = [];
  for (const line of lines) wrapped.push(...wrapLine(line, termW));

  const contentW = wrapped.reduce((m, l) => Math.max(m, stripAnsi(l).length), 0);
  const boxW = Math.max(20, contentW) + 2;

  const boxColor = (s: string) => pc.dim(pc.yellow(s));
  const sep = `  ${boxColor('╭─')} ${pc.yellow(pc.bold('You'))} ${boxColor('─'.repeat(Math.max(0, boxW - 5)))}${boxColor('╮')}`;
  console.log(`\n${sep}`);
  for (const part of wrapped) {
    const pad = ' '.repeat(Math.max(0, boxW - stripAnsi(part).length));
    console.log(`  ${boxColor('│')} ${pc.white(part)}${pad}${boxColor('│')}`);
  }
  console.log(`  ${boxColor('╰')}${boxColor('─'.repeat(boxW + 1))}${boxColor('╯')}`);
}

// ── Assistant message ──────────────────────────────────────────

let _buf = '';
let _inCode = false;
let _codeLang = '';
let _codeLines: string[] = [];

export function openAssistantBlock(): void {
  console.log(`\n  ${pc.cyan(pc.bold('Daedalus'))}`);
}

function emitCodeBlock(): void {
  if (_codeLines.length === 0) return;
  const lineDigits = String(_codeLines.length).length;
  for (let i = 0; i < _codeLines.length; i++) {
    const lineNo = String(i + 1).padStart(lineDigits);
    const gutter = pc.dim(` ${lineNo} │`);
    const content = _codeLines[i];
    for (const part of wrapLine(content, termW - lineDigits - 3)) {
      console.log(`  ${gutter} ${part}`);
    }
  }
  _codeLines = [];
}

export function writeAssistantChunk(chunk: string): void {
  _buf += chunk;
  const completeLines = _buf.split('\n');
  _buf = completeLines.pop() || '';

  for (const raw of completeLines) {
    const line = raw.trimEnd();

    // Code block fences
    if (line.startsWith('```')) {
      if (_inCode) {
        emitCodeBlock();
        _inCode = false;
        _codeLang = '';
      } else {
        _inCode = true;
        _codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (_inCode) {
      _codeLines.push(line);
      continue;
    }

    // Inline markdown rendering
    const formatted = formatMarkdownLine(line);
    for (const part of wrapLine(formatted, termW)) {
      console.log(`  ${part}`);
    }
  }
}

export function closeAssistantBlock(
  tokens: number,
  elapsedMs: number,
  toolCount?: number,
  modelName?: string,
): void {
  // Flush remaining buffer
  if (_buf) {
    const line = _buf.trimEnd();
    if (_inCode) {
      _codeLines.push(line);
    } else {
      if (line.startsWith('```')) {
        emitCodeBlock();
      } else {
        const formatted = formatMarkdownLine(line);
        for (const part of wrapLine(formatted, termW)) {
          console.log(`  ${part}`);
        }
      }
    }
  }
  emitCodeBlock();
  _inCode = false;
  _codeLang = '';
  _buf = '';

  // Compact metadata line — single dim line, no wrapping
  const parts: string[] = [];
  if (modelName) parts.push(pc.dim(modelName));
  if (toolCount !== undefined) parts.push(pc.dim(`${toolCount} tool(s)`));
  const tokenStr = tokens >= 4000 ? `${(tokens / 4 / 1000).toFixed(1)}k out` : `${Math.round(tokens / 4)} out`;
  parts.push(pc.dim(tokenStr));
  const elapsed = elapsedMs >= 1000 ? `${(elapsedMs / 1000).toFixed(1)}s` : `${elapsedMs}ms`;
  parts.push(pc.dim(elapsed));
  console.log(`  ${parts.join(' · ')}\n`);
}

// ── Inline markdown ────────────────────────────────────────────

export function formatMarkdownLine(line: string): string {
  // Headings
  if (line.startsWith('### ')) return pc.bold(pc.cyan(line.slice(4)));
  if (line.startsWith('## ')) return pc.bold(pc.cyan(line.slice(3)));
  if (line.startsWith('# ')) return pc.bold(pc.cyan(line.slice(2)));

  // Blockquotes
  if (line.startsWith('> ')) return `${pc.gray('│')} ${pc.italic(line.slice(2))}`;

  let indent = '';
  let body = line;
  const list = line.match(/^(\s*)([-*•])\s+(.*)/);
  if (list) {
    indent = list[1];
    body = list[3];
  }

  // Horizontal rules
  if (/^[-*_]{3,}$/.test(body.trim())) return pc.dim('─'.repeat(termW));

  body = body
    .replace(/`([^`]+)`/g, (_, p) => pc.yellow(p))
    .replace(/\*\*([^*]+)\*\*/g, (_, p) => pc.bold(p))
    .replace(/\*([^*]+)\*/g, (_, p) => pc.italic(p))
    .replace(/_([^_]+)_/g, (_, p) => pc.italic(p));

  return indent + (list ? `${pc.dim('•')} ${body}` : body);
}

// ── Separator ──────────────────────────────────────────────────

export function turnSeparator(): void {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  console.log(`  ${pc.dim('─'.repeat(50))} ${pc.dim(ts)}`);
}

// ── Context warning ────────────────────────────────────────────

export function printContextWarning(pct: number): void {
  console.log(`  ${pc.dim('Context')} ${pc.yellow(pct.toString().padStart(3))}% ${pc.dim('— summarizing older turns')}`);
}

export function printContextResult(summarized: number, savedKt: number): void {
  console.log(`  ${pc.green('✔')} ${pc.dim(`Summarized ${summarized} older turns, saved ~${savedKt}kt`)}`);
}

export function printContextPrune(pruned: number, truncated: number, savedKt: number): void {
  const parts: string[] = [];
  if (pruned > 0) parts.push(`removed ${pruned} cycles`);
  if (truncated > 0) parts.push(`truncated ${truncated} tool outputs`);
  parts.push(`saved ~${savedKt}kt`);
  console.log(`  ${pc.dim('┃')} ${pc.dim(`Hard pruning: ${parts.join(', ')}`)}`);
}

// ── Tool execution ─────────────────────────────────────────────

export function printToolStart(count: number, names: string[], spinnerDim: (s: string) => string): string {
  const label = count === 1 ? names[0] : `${names.join(', ')}`;
  const msg = `  ${pc.dim('▸')} ${pc.dim(label)}`;
  return msg;
}

export function printToolResult(name: string, success: boolean, error?: string): void {
  if (success) {
    console.log(`  ${pc.green('✔')} ${pc.dim(name)}`);
  } else {
    console.log(`  ${pc.red('✗')} ${pc.dim(name)}${error ? `  ${pc.red(error)}` : ''}`);
  }
}

export function printToolContentPreview(content: string): void {
  if (!content) return;
  const lines = content.split('\n').filter(l => l.trim());
  const preview = lines.slice(0, 1).map(l => l.length > 100 ? l.slice(0, 100) + '…' : l).join('\n');
  if (preview) console.log(`  ${pc.dim('  ')}${pc.gray(preview)}`);
}

// ── Turn gate prompt ───────────────────────────────────────────

export function turnGatePrompt(): string {
  return `\n  ${pc.dim('?')} Next turn? ${pc.dim('[y/n/e]')} `;
}

// ── Parsed tool calls ──────────────────────────────────────────

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
