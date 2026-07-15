import pc from 'picocolors';
import type { ToolCall } from './types.js';

export const termW = Math.max(50, (process.stdout.columns ?? 80) - 5);
const bar = pc.dim('│');

function stripAnsi(str: string): string {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

function sepLine(char = '─', len = 40): string {
  return pc.dim(char.repeat(len));
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
  const isTui = (globalThis as any).isTui;
  const cols = process.stdout.columns ?? 80;
  const targetWidth = isTui 
    ? Math.max(40, Math.floor(cols * 0.8) - 8)
    : Math.max(50, cols - 5);

  const lines = userMessage.split('\n');
  const wrapped: string[] = [];
  for (const line of lines) wrapped.push(...wrapLine(line, targetWidth));

  const contentW = wrapped.reduce((m, l) => Math.max(m, stripAnsi(l).length), 0);
  const boxW = Math.max(20, contentW) + 2;

  console.log(`\n  ${pc.dim('╭─')} ${pc.bold('You')} ${pc.dim(`─${'─'.repeat(Math.max(0, boxW - 5))}╮`)}`);
  for (const part of wrapped) {
    const pad = ' '.repeat(Math.max(0, boxW - stripAnsi(part).length));
    console.log(`  ${bar} ${pc.white(part)}${pad} ${bar}`);
  }
  console.log(`  ${pc.dim('╰')}${pc.dim('─'.repeat(boxW + 2))}${pc.dim('╯')}`);
}

// ── Assistant message ──────────────────────────────────────────

let _buf = '';
let _inCode = false;
let _codeLines: string[] = [];

let _commentaryLines = 0;
const _toolsRun: { name: string; success: boolean }[] = [];
let _collapseEnabled = true;

export function setFormattingConfig(config: any): void {
  if (config?.ui?.collapseCommentary === false) {
    _collapseEnabled = false;
  }
}

export function collapseCommentary(): void {
  if (!_collapseEnabled) {
    _commentaryLines = 0;
    _toolsRun.length = 0;
    return;
  }
  if (_commentaryLines === 0) return;

  process.stdout.write('\u001b[1A\u001b[2K'.repeat(_commentaryLines));

  if (_toolsRun.length > 0) {
    const allSuccess = _toolsRun.every(t => t.success);
    const badge = allSuccess ? pc.green('✔') : pc.yellow('✗');
    const summary = _toolsRun.map(t => {
      return t.success ? pc.dim(t.name) : pc.red(t.name);
    }).join(', ');
    console.log(`  ${badge} ${pc.dim('Executed tools:')} ${summary}`);
  }

  _commentaryLines = 0;
  _toolsRun.length = 0;
}

export function openAssistantBlock(): void {
  collapseCommentary();
  console.log(`\n  ${pc.cyan(pc.bold('Daedalus'))} ${sepLine('─', 40)}`);
}

function emitCodeBlock(): void {
  if (_codeLines.length === 0) return;
  const lineDigits = String(_codeLines.length).length;
  for (let i = 0; i < _codeLines.length; i++) {
    const lineNo = String(i + 1).padStart(lineDigits);
    const content = _codeLines[i];
    for (const part of wrapLine(content, termW - lineDigits - 3)) {
      console.log(`  ${bar} ${pc.dim(`${lineNo} │`)} ${part}`);
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

    if (line.startsWith('```')) {
      if (_inCode) {
        emitCodeBlock();
        _inCode = false;
      } else {
        _inCode = true;
      }
      continue;
    }

    if (_inCode) {
      _codeLines.push(line);
      continue;
    }

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
  _buf = '';

  // Compact metadata line — single dim line, no wrapping
  const parts: string[] = [];
  if (modelName) parts.push(pc.dim(modelName));
  if (toolCount !== undefined) parts.push(pc.dim(`${toolCount} tool(s)`));
  const tokenStr = tokens >= 4000 ? `${(tokens / 4 / 1000).toFixed(1)}k out` : `${Math.round(tokens / 4)} out`;
  parts.push(pc.dim(tokenStr));
  const elapsed = elapsedMs >= 1000 ? `${(elapsedMs / 1000).toFixed(1)}s` : `${elapsedMs}ms`;
  parts.push(pc.dim(elapsed));
  console.log(`  ${pc.dim('└')} ${parts.join(` ${pc.dim('·')} `)}`);
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
  collapseCommentary();
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  console.log(`\n  ${sepLine('─', 40)} ${pc.dim(ts)}`);
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

export function printToolStart(count: number, names: string[]): void {
  const label = count === 1 ? names[0] : `${names.join(', ')}`;
  console.log(`  ${pc.dim('▸')} ${pc.dim(label)}`);
  _commentaryLines++;
  for (const name of names) {
    if (!_toolsRun.some(t => t.name === name)) {
      _toolsRun.push({ name, success: true });
    }
  }
}

export function printToolResult(name: string, success: boolean, error?: string): void {
  const t = _toolsRun.find(x => x.name === name);
  if (t) t.success = success;

  if (success) {
    console.log(`  ${pc.green('✔')} ${pc.dim(name)}`);
  } else {
    console.log(`  ${pc.red('✗')} ${pc.dim(name)}${error ? `  ${pc.red(error)}` : ''}`);
  }
  _commentaryLines++;
}

export function printToolContentPreview(content: string): void {
  if (!content) return;
  const lines = content.split('\n').filter(l => l.trim());
  const preview = lines.slice(0, 1).map(l => l.length > 100 ? l.slice(0, 100) + '…' : l).join('\n');
  if (preview) {
    console.log(`  ${pc.dim('  ')}${pc.gray(preview)}`);
    _commentaryLines++;
  }
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

  // LM Studio `tool` block fallback: ```tool\nfunc_name(key="value", ...)\n```
  if (toolCalls.length === 0) {
    const toolBlockRe = /```tool\s*\n(\w+)\(([\s\S]*?)\)\s*\n```/;
    const blockMatch = text.match(toolBlockRe);
    if (blockMatch) {
      const funcName = blockMatch[1].toLowerCase();
      const rawArgs = blockMatch[2].trim();
      const args: Record<string, any> = {};
      if (funcName === 'write_file' || funcName === 'patch') {
        const keyValueRe = /(\w+)=["']([\s\S]*?)["']/g;
        let km;
        while ((km = keyValueRe.exec(rawArgs)) !== null) {
          args[km[1]] = km[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        }
        if (funcName === 'write_file' && args.file_path && !args.path) {
          args.path = args.file_path;
          delete args.file_path;
        }
      }
      if (Object.keys(args).length > 0 || (funcName === 'terminal' && rawArgs)) {
        toolCalls.push({
          id: `call_parsed_ls_${Date.now()}`,
          type: 'function',
          function: { name: funcName, arguments: JSON.stringify(args) },
        });
      }
    }
  }

  // Natural-language fallback: detect model saying "use the `write_file` tool" + code block
  const toolNameRe = /\buse\s+(?:the\s+)?`?(\w+)`?\s+(?:tool|function|command)\b/i;
  const bodyMatch = text.match(toolNameRe);
  if (bodyMatch && toolCalls.length === 0) {
    const tool = bodyMatch[1].toLowerCase();
    if (['write_file','patch','search_files','terminal','read_file','git_diff','git_status'].includes(tool)) {
      const args: Record<string, any> = {};
      if (tool === 'write_file') {
        const cleanText = text.replace(/`/g, '');
        const pathMatch = cleanText.match(/(?:create|write|add|created|creating)\s+(?:a\s+|the\s+)?(?:file\s+(?:named\s+)?)?([A-Za-z0-9_\-./\\:]+\.[A-Za-z0-9]+)/i) ||
                          cleanText.match(/(?:in|at)\s+(?:the\s+)?([A-Za-z0-9_\-./\\:]+\.[A-Za-z0-9]+)/i);
        const path = pathMatch ? pathMatch[1].replace(/\\/g,'/') : null;
        if (path) {
          const codeMatch = text.match(/```[\s\S]*?```/);
          if (codeMatch) {
            const codeContent = codeMatch[0].replace(/^```\w*\n?/,'').replace(/\n?```$/,'');
            args.path = path;
            args.content = codeContent;
          } else {
            args.path = path;
          }
        }
      }
      if (args.path) {
        toolCalls.push({
          id: `call_parsed_nl_${Date.now()}`,
          type: 'function',
          function: { name: tool, arguments: JSON.stringify(args) },
        });
      }
    }
  }

  // Code-block fallback: if the text contains a TS/TSX/JS code block and mentions a .ts/.tsx/.js file path without any tool call
  if (toolCalls.length === 0) {
    const cleanText = text.replace(/`/g, '');
    const hasCodeBlock = /```(?:tsx?|jsx?|javascript|typescript)[\s\S]*?```/i.test(text) || /```[\s\S]*?\b(import|export|const|function|return)\b[\s\S]*?```/i.test(text);
    const fileMention = cleanText.match(/(?:in|at|file)[\s:]*([A-Za-z0-9_\-./\\:]+\.[A-Za-z0-9]+)/i) ||
                        cleanText.match(/([A-Za-z0-9_\-./\\:]+\.[a-zA-Z0-9]+)/);
    if (hasCodeBlock && fileMention) {
      const path = fileMention[1].replace(/\\/g,'/');
      const codeMatch = text.match(/```[\s\S]*?```/);
      if (codeMatch) {
        const codeContent = codeMatch[0].replace(/^```\w*\n?/,'').replace(/\n?```$/,'');
        toolCalls.push({
          id: `call_parsed_code_${Date.now()}`,
          type: 'function',
          function: { name: 'write_file', arguments: JSON.stringify({ path, content: codeContent }) },
        });
      } else {
        toolCalls.push({
          id: `call_parsed_code_${Date.now()}`,
          type: 'function',
          function: { name: 'write_file', arguments: JSON.stringify({ path }) },
        });
      }
    }
  }

  return toolCalls;
}

