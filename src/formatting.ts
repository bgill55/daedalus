import pc from 'picocolors';
import { highlight } from 'cli-highlight';
import type { ToolCall } from './types.js';
import { TOOL_IMPLEMENTATIONS } from './tools/definitions.js';
import { setTheme, brand, rule, dim, info, ok, warn, err } from './ui/theme.js';
import { globalSessionStats } from './session/analytics.js';

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
  return dim(char.repeat(len));
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

  console.log(`\n  ${pc.bold(ok('─ You ─'))} ${dim('─'.repeat(Math.max(10, lineLen - 7)))}`);
  for (const part of wrapped) {
    console.log(`  ${pc.whiteBright(part)}`);
  }
  console.log(`  ${dim('─'.repeat(lineLen + 2))}\n`);
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
let _showCost = false;
let _lastEmittedBlank = false;

export function setFormattingConfig(config: { ui?: { collapseCommentary?: boolean; compactMode?: boolean; showCost?: boolean; diffStyle?: string; theme?: string } & Record<string, unknown> }): void {
  if (config?.ui?.collapseCommentary === false) _collapseEnabled = false;
  if (config?.ui?.compactMode === false) _compactMode = false;
  if (config?.ui?.showCost === true) _showCost = true;
  if (config?.ui?.theme) setTheme(config.ui.theme as 'dark' | 'light' | 'auto');
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
let _codeLang = '';
let _codeLines: string[] = [];
// Thinking renderer: when a reasoning model emits raw <think>...</think> inline, we render
// that block in dimmed (gray) font while the final answer renders in white — so the user can
// tell "Daedalus is thinking" from "Daedalus is replying". Tags can split across stream
// chunks, so we buffer until a closing tag and flush any open block on block close.
let _inThink = false;
let _thinkBuf = '';
let _pending = ''; // incomplete <think>/</think> tag fragment held across stream chunks

export function collapseCommentary(): void {
  if (!_collapseEnabled) {
    _commentaryLines = 0;
    return;
  }
  if (_commentaryLines === 0 && _toolBuffer.length === 0) return;

  if (_compactMode) {
    if (_toolBuffer.length > 0) {
      const allSuccess = _toolBuffer.every(t => t.success !== false);
      const badge = allSuccess ? ok('✔') : warn('✗');
      const summary = _toolBuffer.map(t => {
        return t.success !== false ? dim(t.name) : err(t.name);
      }).join(', ');
      console.log(`  ${dim('┊')} ${badge} ${dim('Executed tools:')} ${summary}`);

      for (const entry of _toolBuffer) {
        if (entry.contentPreview) {
          console.log(`  ${dim('┊')}   ${pc.gray(entry.contentPreview)}`);
        }
      }
    }
  } else {
    process.stdout.write('\u001b[1A\u001b[2K'.repeat(_commentaryLines));

    if (_toolBuffer.length > 0) {
      const allSuccess = _toolBuffer.every(t => t.success !== false);
      const badge = allSuccess ? ok('✔') : warn('✗');
      const summary = _toolBuffer.map(t => {
        return t.success !== false ? dim(t.name) : err(t.name);
      }).join(', ');
      console.log(`  ${dim('┊')} ${badge} ${dim('Executed tools:')} ${summary}`);
    }
  }

  _toolBuffer = [];
  _commentaryLines = 0;
}

let _lastBoxW = 70;

// Approximate blended $/1k-token pricing for common cloud families, used only
// for the opt-in cost estimate in the assistant footer. Local endpoints
// (lmstudio/ollama/localhost) are free. Heuristic — not an invoice.
interface PriceRate { in: number; out: number; }
const PRICE_TABLE: Array<{ re: RegExp; rate: PriceRate }> = [
  { re: /gpt-4o/i, rate: { in: 0.005, out: 0.015 } },
  { re: /gpt-4/i, rate: { in: 0.03, out: 0.06 } },
  { re: /gpt-3\.5/i, rate: { in: 0.0005, out: 0.0015 } },
  { re: /claude-3\.5/i, rate: { in: 0.003, out: 0.015 } },
  { re: /claude/i, rate: { in: 0.003, out: 0.015 } },
  { re: /sonnet/i, rate: { in: 0.003, out: 0.015 } },
  { re: /haiku/i, rate: { in: 0.00025, out: 0.00125 } },
  { re: /(gemini|gemma)/i, rate: { in: 0.0005, out: 0.0015 } },
  { re: /(deepseek)/i, rate: { in: 0.00027, out: 0.0011 } },
  { re: /(command|cohere)/i, rate: { in: 0.0015, out: 0.002 } },
];

function estimatePrice(modelName?: string): PriceRate | null {
  if (!modelName) return null;
  if (/(lmstudio|ollama|localhost|:1234|:11434|vllm|llama\.cpp|local)/i.test(modelName)) {
    return null;
  }
  for (const { re, rate } of PRICE_TABLE) {
    if (re.test(modelName)) return rate;
  }
  return null;
}

function getBoxWidth(): number {
  const cols = process.stdout.columns ?? 80;
  return Math.max(40, cols - 6);
}

export function openAssistantBlock(): void {
  collapseCommentary();
  _lastBoxW = getBoxWidth();
  // Straight top rule: title padded to a fixed width with displayWidth-aware padding
  // so a wide glyph in the title can't throw the alignment off.
  printRule(`${pc.bold(brand('Daedalus'))}`);
}

// Horizontal rule of exactly _lastBoxW cells. `content` (if any) is placed at the
// start and the rest is filled with '─'. Uses displayWidth so wide glyphs count as 2.
function printRule(content: string): void {
  const inner = '─'.repeat(Math.max(2, _lastBoxW - 2));
  const prefix = '  ';
  if (!content) {
    console.log(`${prefix}${rule(inner)}`);
    return;
  }
  const vis = displayWidth(content);
  const fill = '─'.repeat(Math.max(0, _lastBoxW - 2 - vis));
  console.log(`${prefix}${rule(content)}${rule(fill)}`);
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

/**
 * Render a determinate progress bar on a single line (carriage-return update).
 * `ratio` is 0..1. Uses theme-aware colors. Pass `final: true` to append a
 * newline so subsequent output starts on a fresh line.
 */
export function printProgressBar(ratio: number, label: string, opts?: { width?: number; final?: boolean }): void {
  const width = opts?.width ?? 24;
  const pct = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(pct * width);
  const bar = brand('█'.repeat(filled)) + dim('░'.repeat(width - filled));
  const pctStr = `${Math.round(pct * 100)}%`.padStart(4);
  const tail = label ? ` ${pc.gray(label.slice(-36))}` : '';
  process.stdout.write(`\r  ${bar} ${pc.bold(pctStr)}${tail}${opts?.final ? '\n' : ''}`);
}

function emitCodeBlock(): void {
  if (!_inCode) return;
  // Drop a trailing closing fence if the model emitted one inside the buffer.
  const rawLines = _codeLines.filter(l => !l.trimStart().startsWith('```'));
  if (rawLines.length === 0) {
    _inCode = false;
    _codeLang = '';
    _codeLines = [];
    return;
  }
  const innerW = Math.max(20, _lastBoxW - 2);
  const lineDigits = String(rawLines.length).length;

  // Highlight the whole block once (preserves ANSI across lines), then render
  // each line with a gutter line number. Unknown languages fall back to plain.
  let highlighted: string;
  try {
    highlighted = highlight(rawLines.join('\n'), {
      language: _codeLang || 'text',
      ignoreIllegals: true,
    });
  } catch {
    highlighted = rawLines.join('\n');
  }
  const hlLines = highlighted.split('\n');
  // Guard against a mismatch between source/highlighted line counts.
  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = String(i + 1).padStart(lineDigits);
    const part = hlLines[i] ?? rawLines[i];
    const vis = displayWidth(stripAnsi(part));
    const pad = Math.max(0, innerW - lineDigits - 3 - vis);
    console.log(`  ${dim(`${lineNo} │`)} ${part}${' '.repeat(pad)}`);
  }
  _inCode = false;
  _codeLang = '';
  _codeLines = [];
}

export function writeAssistantChunk(chunk: string): void {
  // Render <think>...</think> reasoning inline in a dimmed (gray) font while the final
  // answer renders in white — so the user can tell "Daedalus is thinking" from "Daedalus is
  // replying". Think tags routinely split across stream chunks, so we hold only a genuine
  // incomplete-tag PREFIX (≤7 chars, a prefix of "<think>" or "</think>") in _pending for the
  // next chunk; all other text is emitted immediately in the current (think/plain) context.
  // Crucially, while a think block is open we accumulate its body in _thinkBuf and only ever
  // emit it dimmed — never as a white reply. Completed think blocks flush dimmed; the answer
  // after </think> renders white. Literal tags are never printed.
  let s = _pending + chunk;
  _pending = '';
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('<think>', i);
    const close = s.indexOf('</think>', i);
    let tag = -1, tagLen = 0, isOpen = false;
    if (open !== -1 && (close === -1 || open < close)) { tag = open; tagLen = 7; isOpen = true; }
    else if (close !== -1) { tag = close; tagLen = 8; isOpen = false; }

    if (tag === -1) {
      // No complete tag remains. Emit everything except a trailing partial-tag prefix.
      const keep = tagPrefixLen(s.slice(i));
      emitRaw(s.slice(i, s.length - keep));
      _pending = s.slice(s.length - keep);
      break;
    }

    // Emit text before the tag in the current context.
    emitRaw(s.slice(i, tag));

    if (isOpen) {
      _inThink = true;
    } else {
      _inThink = true;
      flushThinkBuffer();
      _inThink = false;
    }
    i = tag + tagLen;
  }
}

// Length (0..7) of the suffix of `str` that is a prefix of "<think>" or "</think>".
// Used to hold a split tag fragment across stream chunks without dropping real text.
function tagPrefixLen(str: string): number {
  const tags = ['<think>', '</think>'];
  let best = 0;
  for (const t of tags) {
    for (let k = 1; k <= Math.min(7, t.length - 1, str.length); k++) {
      if (str.endsWith(t.slice(0, k))) best = Math.max(best, k);
    }
  }
  return best;
}

function emitRaw(text: string): void {
  if (!text) return;
  if (_inThink) {
    _thinkBuf += text;
    flushCompleteLines();
  } else {
    _buf += text;
    flushCompleteLines();
  }
}

// Emit any complete lines buffered for the current think/non-think state; keep the trailing
// partial line in its buffer.
function flushCompleteLines(): void {
  const src = _inThink ? _thinkBuf : _buf;
  if (!src) return;
  const lines = src.split('\n');
  const last = lines.pop() ?? '';
  for (const raw of lines) emitAssistantLine(raw);
  if (_inThink) _thinkBuf = last;
  else _buf = last;
}

function flushThinkBuffer(): void {
  if (!_thinkBuf) return;
  for (const raw of _thinkBuf.split('\n')) emitAssistantLine(raw);
  _thinkBuf = '';
}

function emitAssistantLine(raw: string): void {
  const line = raw.trimEnd();
  // Collapse runs of blank lines (models routinely pad output with several empty
  // lines) into a single separator so the terminal doesn't render dead space.
  if (line.trim() === '') {
    if (_lastEmittedBlank) return;
    _lastEmittedBlank = true;
  } else {
    _lastEmittedBlank = false;
  }
  if (_inCode) {
    _codeLines.push(line);
    return;
  }
  if (line.startsWith('```')) {
    // Opening fence: capture the language token (e.g. "```ts" -> "ts") and switch
    // into code mode. The closing fence is detected in closeAssistantBlock.
    _inCode = true;
    _codeLang = line.slice(3).trim();
    return;
  }
  if (_inThink) printBoxLine(dim(formatMarkdownLine(line)));
  else printBoxLine(pc.whiteBright(formatMarkdownLine(line)));
}

export function closeAssistantBlock(
  tokens: number,
  elapsedMs: number,
  toolCount?: number,
  modelName?: string,
  realOutTokens?: number,
  tier?: string,
  opts?: { showCost?: boolean; selfCorrections?: number },
): void {
  if (modelName) globalSessionStats.setLastModel(modelName, tier);
  const showCost = opts?.showCost === true || _showCost;
  // Flush any trailing think buffer (a model may end the stream without a closing tag)
  // and any remaining non-think line before finalizing the block. Drop any partial tag
  // fragment held in _pending (it will never complete now).
  if (_inThink || _thinkBuf) {
    _inThink = true;
    flushThinkBuffer();
    _inThink = false;
  }
  _pending = '';
  if (_buf) {
    const line = _buf.trimEnd();
    if (_inCode) {
      // A ``` fence while in code mode is the closing fence, not code content.
      if (!line.startsWith('```')) {
        _codeLines.push(line);
      }
    } else {
      if (line.startsWith('```')) {
        emitCodeBlock();
      } else {
        printBoxLine(pc.whiteBright(formatMarkdownLine(line)));
      }
    }
  }
  emitCodeBlock();
  _inCode = false;
  _inThink = false;
  _buf = '';
  _thinkBuf = '';
  _lastEmittedBlank = false;

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
  if (opts?.selfCorrections && opts.selfCorrections > 0) {
    parts.push(`${opts.selfCorrections} auto-heal${opts.selfCorrections === 1 ? '' : 's'}`);
  }

  // Cost estimate (opt-in via ui.showCost). Local models cost $0; cloud families
  // use approximate blended $/1k-token rates. Heuristic — not an invoice.
  if (showCost && outTokens > 0) {
    const inTokens = tokens > 0 ? tokens : 0;
    const rate = estimatePrice(modelName);
    if (rate) {
      const cost = (inTokens / 1000) * rate.in + (outTokens / 1000) * rate.out;
      if (cost > 0) parts.push(`$${cost.toFixed(4)}`);
    }
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
  printRule(dim(stats));
}

// ── Inline markdown ────────────────────────────────────────────

export function formatMarkdownLine(line: string): string {
  if (line.startsWith('### ')) return pc.bold(info(line.slice(4)));
  if (line.startsWith('## ')) return pc.bold(info(line.slice(3)));
  if (line.startsWith('# ')) return pc.bold(info(line.slice(2)));

  if (line.startsWith('> ')) return `${pc.gray('│')} ${pc.italic(line.slice(2))}`;

  let indent = '';
  let body = line;
  const list = line.match(/^(\s*)([-*•])\s+(.*)/);
  if (list) {
    indent = list[1];
    body = list[3];
  }

  if (/^[-*_]{3,}$/.test(body.trim())) return dim('─'.repeat(termW));

  body = body
    .replace(/`([^`]+)`/g, (_, p) => warn(p))
    .replace(/\*\*([^*]+)\*\*/g, (_, p) => pc.bold(p))
    .replace(/\*([^*]+)\*/g, (_, p) => pc.italic(p))
    .replace(/_([^_]+)_/g, (_, p) => pc.italic(p));

  return indent + (list ? `${dim('•')} ${body}` : body);
}

// ── Separator ──────────────────────────────────────────────────

export function turnSeparator(): void {
  collapseCommentary();
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  console.log(`\n  ${sepLine('─', 40)} ${dim(ts)}`);
}

// ── Context warning ────────────────────────────────────────────

export function printContextWarning(pct: number): void {
  console.log(`  ${dim('Context')} ${warn(pct.toString().padStart(3))}% ${dim('— summarizing older turns')}`);
}

export function printContextResult(summarized: number, savedKt: number): void {
  console.log(`  ${ok('✔')} ${dim(`Summarized ${summarized} older turns, saved ~${savedKt}kt`)}`);
}

export function printContextPrune(pruned: number, truncated: number, savedKt: number): void {
  const parts: string[] = [];
  if (pruned > 0) parts.push(`removed ${pruned} cycles`);
  if (truncated > 0) parts.push(`truncated ${truncated} tool outputs`);
  parts.push(`saved ~${savedKt}kt`);
  console.log(`  ${dim('┃')} ${dim(`Hard pruning: ${parts.join(', ')}`)}`);
}

// ── Tool execution ─────────────────────────────────────────────

export function printToolStart(count: number, names: string[]): void {
  if (!_compactMode) {
    const label = count === 1 ? names[0] : `${names.join(', ')}`;
    console.log(`  ${dim('▸')} ${dim(label)}`);
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
      console.log(`  ${ok('✔')} ${dim(name)}`);
    } else {
      console.log(`  ${err('✗')} ${dim(name)}${error ? `  ${err(error)}` : ''}`);
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
    console.log(`  ${dim('  ')}${pc.gray(preview)}`);
    _commentaryLines++;
  }
}

// ── Turn gate prompt ───────────────────────────────────────────

export function turnGatePrompt(): string {
  return `\n  ${dim('?')} Next turn? ${dim('[y/n/e]')} `;
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

export function extractBalancedObject(text: string, openIdx: number): string | null {
  if (text[openIdx] !== '{') return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(openIdx, i + 1); }
  }
  return null;
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

  if (toolCalls.length === 0) {
    // Branch 4: bare JSON tool calls, e.g. {"name": "write_file", "arguments": {...}}
    // or OpenAI shape {"function": {"name": "...", "arguments": "..."}}.
    // Models emitting tool calls as plain JSON (no native function-calling / no markup
    // wrapper) produce exactly this — extract and validate against the known tool set.
    const jsonCallRe = /"name"\s*:\s*"([\w-]+)"\s*,\s*"arguments"\s*:/g;
    let jm;
    while ((jm = jsonCallRe.exec(text)) !== null) {
      const name = jm[1];
      const resolved = resolveToolName(name);
      if (!resolved) continue;
      // Walk back to the opening brace of the enclosing JSON object.
      let start = jm.index;
      while (start > 0 && text[start - 1] !== '{') start--;
      const braceIdx = start - 1;
      if (braceIdx < 0 || text[braceIdx] !== '{') continue;
      const objStr = extractBalancedObject(text, braceIdx);
      if (!objStr) continue;
      let parsed: { arguments?: unknown };
      try { parsed = JSON.parse(objStr); } catch { continue; }
      const rawArgs = parsed.arguments;
      const argsObj = typeof rawArgs === 'string' ? (() => { try { return JSON.parse(rawArgs); } catch { return null; } })() : (rawArgs ?? null);
      if (typeof argsObj !== 'object' || argsObj === null) continue;
      toolCalls.push({
        id: `call_json_${Date.now()}_${toolCalls.length}`,
        type: 'function',
        function: { name: resolved, arguments: JSON.stringify(argsObj) },
      });
    }
  }

  if (toolCalls.length === 0) {
    // OpenAI-style: {"function": {"name": "...", "arguments": "..."}}
    const fnRe = /"function"\s*:\s*\{\s*"name"\s*:\s*"([\w-]+)"\s*,\s*"arguments"\s*:\s*("[\s\S]*?(?:"\s*\})|"\{[\s\S]*?\}")/g;
    let fm;
    while ((fm = fnRe.exec(text)) !== null) {
      const name = fm[1];
      const resolved = resolveToolName(name);
      if (!resolved) continue;
      const rawArgs = fm[2].replace(/^"|"$/g, '');
      let argsObj: unknown;
      try { argsObj = JSON.parse(rawArgs); } catch { continue; }
      if (typeof argsObj !== 'object' || argsObj === null) continue;
      toolCalls.push({
        id: `call_jsonfn_${Date.now()}_${toolCalls.length}`,
        type: 'function',
        function: { name: resolved, arguments: JSON.stringify(argsObj) },
      });
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
