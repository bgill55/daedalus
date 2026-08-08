import pc from 'picocolors';
import type { ToolCall } from './types.js';
import { TOOL_IMPLEMENTATIONS } from './tools/definitions.js';

export const termW = Math.max(50, (process.stdout.columns ?? 80) - 5);

function stripAnsi(str: string): string {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

// Display (cell) width of a string. ANSI codes contribute 0; most chars are 1 cell,
// but East-Asian Wide / Fullwidth / CJK / pictographic (emoji) glyphs occupy 2 cells
// in a terminal. Box-drawing chars (U+2500–U+257F) are intentionally 1 cell. Using
// string.length (or stripAnsi length) here is what makes boxes misalign when a header
// contains an emoji like ⚡ — that glyph is 2 cells wide but was counted as 1.
function isWide(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana, Katakana, CJK
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK Compatibility Forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) || // Fullwidth symbols
    (cp >= 0x1f000 && cp <= 0x1faff) || // Emoji / pictographs
    (cp >= 0x2600 && cp <= 0x27bf) // Misc symbols + Dingbats (includes ⚡)
  );
}

export function displayWidth(str: string): number {
  const clean = stripAnsi(str);
  let w = 0;
  for (const ch of clean) {
    w += isWide(ch) ? 2 : 1;
  }
  return w;
}

function sepLine(char = '─', len = 40): string {
  return pc.dim(char.repeat(len));
}

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
  const isTui = globalThis.isTui;
  const cols = process.stdout.columns ?? 80;
  const targetWidth = isTui
    ? Math.max(40, Math.floor(cols * 0.8) - 8)
    : Math.max(50, cols - 5);

  const lines = userMessage.split('\n');
  const wrapped: string[] = [];
  for (const line of lines) wrapped.push(...wrapLine(line, targetWidth));

  const lineLen = Math.max(20, Math.min(70, cols - 6));

  console.log(`\n  ${pc.bold(pc.green('─ You ─'))} ${pc.dim('─'.repeat(Math.max(10, lineLen - 7)))}`);
  for (const part of wrapped) {
    console.log(`  ${pc.whiteBright(part)}`);
  }
  console.log(`  ${pc.dim('─'.repeat(lineLen + 2))}\n`);
}

// ── Tool call buffer (stored per-turn for compact display + review) ──

export interface ToolBufferEntry {
  name: string;
  success?: boolean;
  error?: string;
  contentPreview?: string;
}

let _toolBuffer: ToolBufferEntry[] = [];
let _commentaryLines = 0;
let _collapseEnabled = true;
let _compactMode = true;

export function setFormattingConfig(config: { ui?: { collapseCommentary?: boolean; compactMode?: boolean } & Record<string, unknown> }): void {
  if (config?.ui?.collapseCommentary === false) _collapseEnabled = false;
  if (config?.ui?.compactMode === false) _compactMode = false;
}

export function getToolBuffer(): ToolBufferEntry[] {
  return _toolBuffer;
}

export function clearToolBuffer(): void {
  _toolBuffer = [];
  _commentaryLines = 0;
}

// ── Assistant message ──────────────────────────────────────────

let _buf = '';
let _inCode = false;
let _codeLines: string[] = [];

export function collapseCommentary(): void {
  if (!_collapseEnabled) {
    _commentaryLines = 0;
    return;
  }
  if (_commentaryLines === 0 && _toolBuffer.length === 0) return;

  if (_compactMode) {
    if (_toolBuffer.length > 0) {
      const allSuccess = _toolBuffer.every(t => t.success !== false);
      const badge = allSuccess ? pc.green('✔') : pc.yellow('✗');
      const summary = _toolBuffer.map(t => {
        return t.success !== false ? pc.dim(t.name) : pc.red(t.name);
      }).join(', ');
      console.log(`  ${pc.dim('┊')} ${badge} ${pc.dim('Executed tools:')} ${summary}`);

      for (const entry of _toolBuffer) {
        if (entry.contentPreview) {
          console.log(`  ${pc.dim('┊')}   ${pc.gray(entry.contentPreview)}`);
        }
      }
    }
  } else {
    process.stdout.write('\u001b[1A\u001b[2K'.repeat(_commentaryLines));

    if (_toolBuffer.length > 0) {
      const allSuccess = _toolBuffer.every(t => t.success !== false);
      const badge = allSuccess ? pc.green('✔') : pc.yellow('✗');
      const summary = _toolBuffer.map(t => {
        return t.success !== false ? pc.dim(t.name) : pc.red(t.name);
      }).join(', ');
      console.log(`  ${pc.dim('┊')} ${badge} ${pc.dim('Executed tools:')} ${summary}`);
    }
  }

  _toolBuffer = [];
  _commentaryLines = 0;
}

let _lastBoxW = 70;

function getBoxWidth(): number {
  const cols = process.stdout.columns ?? 80;
  return Math.max(40, cols - 6);
}

export function openAssistantBlock(): void {
  collapseCommentary();
  _lastBoxW = getBoxWidth();
  // Straight top rule: title padded to a fixed width with displayWidth-aware padding
  // so an emoji in the title (⚡ = 2 cells) can't throw the alignment off.
  printRule(`${pc.bold(pc.cyan('⚡ Daedalus'))}`);
}

// Horizontal rule of exactly _lastBoxW cells. `content` (if any) is placed at the
// start and the rest is filled with '─'. Uses displayWidth so wide glyphs count as 2.
function printRule(content: string): void {
  const inner = '─'.repeat(Math.max(2, _lastBoxW - 2));
  const prefix = '  ';
  if (!content) {
    console.log(`${prefix}${pc.cyan(inner)}`);
    return;
  }
  const vis = displayWidth(content);
  const fill = '─'.repeat(Math.max(0, _lastBoxW - 2 - vis));
  console.log(`${prefix}${pc.cyan(content)}${pc.cyan(fill)}`);
}

// Box geometry: total visible width = _lastBoxW (includes the 2-space indent).
// Body lines are indented text (no side rails); they wrap at _lastBoxW - 2.
function printBoxLine(line: string): void {
  const innerW = Math.max(20, _lastBoxW - 2);
  const parts = wrapLine(line, innerW);
  for (const part of parts) {
    const vis = displayWidth(part);
    const pad = Math.max(0, innerW - vis);
    console.log(`  ${part}${' '.repeat(pad)}`);
  }
}

function emitCodeBlock(): void {
  if (_codeLines.length === 0) return;
  const innerW = Math.max(20, _lastBoxW - 2);
  const lineDigits = String(_codeLines.length).length;
  for (let i = 0; i < _codeLines.length; i++) {
    const lineNo = String(i + 1).padStart(lineDigits);
    const content = _codeLines[i];
    const wrapped = wrapLine(content, innerW - lineDigits - 3);
    for (const part of wrapped) {
      const vis = displayWidth(part);
      const pad = Math.max(0, innerW - lineDigits - 3 - vis);
      console.log(`  ${pc.dim(`${lineNo} │`)} ${part}${' '.repeat(pad)}`);
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
    printBoxLine(formatted);
  }
}

export function closeAssistantBlock(
  tokens: number,
  elapsedMs: number,
  toolCount?: number,
  modelName?: string,
  realOutTokens?: number,
  tier?: string,
): void {
  if (_buf) {
    const line = _buf.trimEnd();
    if (_inCode) {
      _codeLines.push(line);
    } else {
      if (line.startsWith('```')) {
        emitCodeBlock();
      } else {
        const formatted = formatMarkdownLine(line);
        printBoxLine(formatted);
      }
    }
  }
  emitCodeBlock();
  _inCode = false;
  _buf = '';

  const parts: string[] = [];
  if (tier) parts.push(tier);
  if (modelName) parts.push(modelName);
  if (toolCount !== undefined) parts.push(`${toolCount} tool(s)`);
  const estTokens = Math.round(tokens / 4);
  const outTokens = realOutTokens !== undefined ? realOutTokens : estTokens;
  const tokenStr = realOutTokens !== undefined
    ? (realOutTokens >= 1000 ? `${(realOutTokens / 1000).toFixed(1)}k out` : `${realOutTokens} out`)
    : (tokens >= 4000 ? `${(tokens / 4 / 1000).toFixed(1)}k out` : `${estTokens} out`);
  parts.push(tokenStr);
  const elapsed = elapsedMs >= 1000 ? `${(elapsedMs / 1000).toFixed(1)}s` : `${elapsedMs}ms`;
  parts.push(elapsed);
  if (elapsedMs > 0 && outTokens > 0) {
    const tps = (outTokens / (elapsedMs / 1000)).toFixed(1);
    parts.push(`${tps} tok/s`);
  }

  const rawStats = parts.join(' · ');
  // Bottom rule: stats as the leading content, filled to a fixed width. Truncate with
  // an ellipsis if the stats are longer than the box so the rule stays exactly _lastBoxW.
  let stats = rawStats;
  const avail = _lastBoxW - 2;
  if (displayWidth(stats) > avail) {
    // Reserve 1 cell for the trailing '…' so the truncated stats + ellipsis fit.
    let s = stats;
    while (displayWidth(s) > avail - 1) s = s.slice(0, -1);
    stats = s.trimEnd() + '…';
  }
  printRule(pc.dim(stats));
}

// ── Inline markdown ────────────────────────────────────────────

export function formatMarkdownLine(line: string): string {
  if (line.startsWith('### ')) return pc.bold(pc.cyan(line.slice(4)));
  if (line.startsWith('## ')) return pc.bold(pc.cyan(line.slice(3)));
  if (line.startsWith('# ')) return pc.bold(pc.cyan(line.slice(2)));

  if (line.startsWith('> ')) return `${pc.gray('│')} ${pc.italic(line.slice(2))}`;

  let indent = '';
  let body = line;
  const list = line.match(/^(\s*)([-*•])\s+(.*)/);
  if (list) {
    indent = list[1];
    body = list[3];
  }

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
  if (!_compactMode) {
    const label = count === 1 ? names[0] : `${names.join(', ')}`;
    console.log(`  ${pc.dim('▸')} ${pc.dim(label)}`);
    _commentaryLines++;
  }

  for (const name of names) {
    if (!_toolBuffer.some(t => t.name === name)) {
      _toolBuffer.push({ name, success: true });
    }
  }
}

export function printToolResult(name: string, success: boolean, error?: string): void {
  const t = _toolBuffer.find(x => x.name === name);
  if (t) {
    t.success = success;
    if (error) t.error = error;
  }

  if (!_compactMode) {
    if (success) {
      console.log(`  ${pc.green('✔')} ${pc.dim(name)}`);
    } else {
      console.log(`  ${pc.red('✗')} ${pc.dim(name)}${error ? `  ${pc.red(error)}` : ''}`);
    }
    _commentaryLines++;
  }
}

export function printToolContentPreview(content: string): void {
  if (!content) return;

  let preview: string;
  if (content.startsWith('{"type":"vision"')) {
    preview = '[Image data...]';
  } else {
    const lines = content.split('\n').filter(l => l.trim());
    preview = lines.slice(0, 1).map(l => l.length > 100 ? l.slice(0, 100) + '…' : l).join('\n');
  }

  if (_compactMode) {
    const last = _toolBuffer[_toolBuffer.length - 1];
    if (last && last.contentPreview === undefined) {
      last.contentPreview = preview;
    }
  } else {
    console.log(`  ${pc.dim('  ')}${pc.gray(preview)}`);
    _commentaryLines++;
  }
}

// ── Turn gate prompt ───────────────────────────────────────────

export function turnGatePrompt(): string {
  return `\n  ${pc.dim('?')} Next turn? ${pc.dim('[y/n/e]')} `;
}

// ── Parsed tool calls ──────────────────────────────────────────

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveToolName(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (TOOL_IMPLEMENTATIONS[trimmed]) return trimmed;
  const norm = normalizeToolName(trimmed);
  const match = Object.keys(TOOL_IMPLEMENTATIONS).find(k => normalizeToolName(k) === norm);
  return match ?? null;
}

function parseBracketToolItem(item: string, idx: number): ToolCall | null {
  const m = item.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*(?:\(([\s\S]*)\))?$/);
  if (!m) return null;
  const name = resolveToolName(m[1]);
  if (!name) return null;
  const rawArgs = (m[2] ?? '').trim();
  const args: Record<string, unknown> = {};
  if (rawArgs) {
    const kvRe = /([a-zA-Z_]\w*)\s*=\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|([^\s,]+))/g;
    let km;
    while ((km = kvRe.exec(rawArgs)) !== null) {
      const val = km[2] ?? km[3] ?? km[4];
      args[km[1]] = String(val).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
  }
  return {
    id: `call_parsed_bracket_${Date.now()}_${idx}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
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

    const args: Record<string, unknown> = {};
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

  if (toolCalls.length === 0) {
    const pipeToolCallRe = /<\|?tool_?call\|?>\s*(?:call:)?([a-zA-Z0-9_-]+)\s*(\{[\s\S]*?\}|\([\s\S]*?\))\s*<\|?tool_?call\|?>?/g;
    let pipeMatch;
    while ((pipeMatch = pipeToolCallRe.exec(text)) !== null) {
      const rawName = pipeMatch[1].toLowerCase();
      const rawBody = pipeMatch[2].trim();
      
      let toolName = rawName;
      if (rawName.includes('writefile') || rawName.includes('write_file')) toolName = 'write_file';
      else if (rawName.includes('patchfile') || rawName.includes('patch')) toolName = 'patch';
      else if (rawName.includes('readfile') || rawName.includes('read_file')) toolName = 'read_file';
      else {
        const resolved = resolveToolName(rawName);
        if (resolved) toolName = resolved;
      }

      const args: Record<string, unknown> = {};
      if (rawBody.startsWith('{') && rawBody.endsWith('}')) {
        const kvRe = /([a-zA-Z0-9_-]+)\s*:\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|([^\s,}]+))/g;
        let kvm;
        while ((kvm = kvRe.exec(rawBody)) !== null) {
          const k = kvm[1];
          let v = kvm[2] ?? kvm[3] ?? kvm[4];
          if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
          args[k] = v;
        }
      }

      if (toolName === 'write_file' || toolName === 'patch') {
        if (!args.path && args.filepath) {
          args.path = args.filepath;
          delete args.filepath;
        }
        if (!args.path && args.file_path) {
          args.path = args.file_path;
          delete args.file_path;
        }
        if (!args.content && args.newcontent) {
          args.content = args.newcontent;
          delete args.newcontent;
        }
      }

      if (Object.keys(args).length > 0 || toolName === 'terminal') {
        toolCalls.push({
          id: `call_pipe_${Date.now()}_${toolCalls.length}`,
          type: 'function',
          function: { name: toolName, arguments: JSON.stringify(args) },
        });
      }
    }
  }

  if (toolCalls.length === 0) {
    const toolBlockRe = /```tool\s*\n(\w+)\(([\s\S]*?)\)\s*\n```/;
    const blockMatch = text.match(toolBlockRe);
    if (blockMatch) {
      const funcName = blockMatch[1].toLowerCase();
      const rawArgs = blockMatch[2].trim();
      const args: Record<string, unknown> = {};
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

  const toolNameRe = /\buse\s+(?:the\s+)?`?(\w+)`?\s+(?:tool|function|command)\b/i;
  const bodyMatch = text.match(toolNameRe);
  if (bodyMatch && toolCalls.length === 0) {
    const tool = bodyMatch[1].toLowerCase();
    if (['write_file','patch','search_files','terminal','read_file','git_diff','git_status'].includes(tool)) {
      const args: Record<string, unknown> = {};
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

  if (toolCalls.length === 0) {
    const bracketRe = /\[([^\]]{2,})\]/g;
    let bm;
    while ((bm = bracketRe.exec(text)) !== null) {
      const before = text.slice(Math.max(0, bm.index - 40), bm.index).toLowerCase();
      if (/tools? (?:available|include|like|such as)|available (?:tools?|commands?)|using .* tools?/i.test(before)) continue;
      const items = bm[1].split(',').map(s => s.trim()).filter(Boolean);
      if (items.length === 0) continue;
      const calls: ToolCall[] = [];
      for (const item of items) {
        const call = parseBracketToolItem(item, calls.length);
        if (call) calls.push(call);
      }
      if (calls.length > 0) {
        toolCalls.push(...calls);
        break;
      }
    }
  }

  return toolCalls;
}

export function stripToolCallMarkup(text: string): string {
  if (!text) return '';
  return text
    .replace(/<\|?tool_?call\|?>[\s\S]*?<\|?tool_?call\|?>?/gi, '')
    .replace(/<(longcat_)?tool_call>[\s\S]*?<\/(longcat_)?tool_call>/gi, '')
    .replace(/```tool\s*\n[\s\S]*?\n```/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatMarkdownPRReply(text: string): string {
  let cleaned = text.trim();

  // Replace malformed HTML details/summary elements with clean markdown collapsibles or clean sections
  cleaned = cleaned.replace(/<details\s+open>/gi, '<details>\n');
  cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n');
  
  // Convert HTML img shields or raw HTML tags outside code blocks to standard markdown
  cleaned = cleaned.replace(/<img\s+src="([^"]+)"[^>]*>/gi, '![]($1)');

  // Ensure double linebreaks around headers
  cleaned = cleaned.replace(/\n(#+\s+.*)/g, '\n\n$1');

  // Normalize excessive blank lines (cap at 2 consecutive newlines)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}
