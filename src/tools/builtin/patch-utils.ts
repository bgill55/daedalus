import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import ts from 'typescript';
import { ToolContext } from '../../types.js';

export function normalizeWhitespace(str: string): string {
  return normalizeUnicode(str)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => (line.match(/^\s+/) ? ' ' : '') + line.trimStart().trimEnd())
    .join('\n');
}

// Maps common Unicode punctuation variants to their ASCII equivalents so that a
// patch whose old_string uses a hyphen still matches a file that contains an
// en-dash, or straight quotes match smart quotes, etc. These are all 1:1
// single-character substitutions, so a character index in the normalized string
// maps 1:1 to the same index in the original — safe to use for match lookup while
// still slicing the original content for the actual replacement. (Only 1:1 mappings
// are included; multi-character expansions like ellipsis are intentionally excluded
// to preserve index alignment.)
const UNICODE_MAP: Record<string, string> = {
  '\u2013': '-', // en dash
  '\u2014': '-', // em dash
  '\u2010': '-', // hyphen
  '\u2011': '-', // non-breaking hyphen
  '\u00A0': ' ', // non-breaking space
  '\u2009': ' ', // thin space
  '\u201C': '"', // left double smart quote
  '\u201D': '"', // right double smart quote
  '\u2018': "'", // left single smart quote
  '\u2019': "'", // right single smart quote
};

export function normalizeUnicode(str: string): string {
  let out = '';
  for (const ch of str) {
    out += UNICODE_MAP[ch] ?? ch;
  }
  return out;
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

export function simpleHash(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

export function findClosestBlockScan(
  contentLines: string[],
  windowSize: number,
  searchLimit: number,
  normalTarget: string,
  threshold: number,
): { snippet: string; lineNo: number } | null {
  let bestDist = Infinity;
  let bestLineNo = -1;
  let bestSnippet = '';

  for (let i = 0; i <= searchLimit - windowSize; i++) {
    const window = contentLines.slice(i, i + windowSize).join('\n');
    const dist = levenshtein(normalizeWhitespace(window), normalTarget);
    if (dist < bestDist) {
      bestDist = dist;
      bestLineNo = i + 1;
      bestSnippet = window;
    }
  }

  if (bestDist <= threshold) {
    return { snippet: bestSnippet, lineNo: bestLineNo };
  }
  return null;
}

export function findClosestBlock(content: string, target: string): { snippet: string; lineNo: number } | null {
  const targetLines = target.split('\n');
  const windowSize = targetLines.length;
  const contentLines = content.split('\n');
  const searchLimit = Math.min(contentLines.length, 300);
  const normalTarget = normalizeWhitespace(target);
  const threshold = Math.ceil(normalTarget.length * 0.30);

  if (contentLines.length <= 100) {
    return findClosestBlockScan(contentLines, windowSize, searchLimit, normalTarget, threshold);
  }

  const targetHash = simpleHash(normalTarget);
  const chunkSize = Math.max(windowSize, 5);
  const candidates: number[] = [];

  for (let i = 0; i <= searchLimit - chunkSize; i += Math.max(1, Math.floor(chunkSize / 2))) {
    const chunk = contentLines.slice(i, i + chunkSize).join('\n');
    const chunkNorm = normalizeWhitespace(chunk);
    if (simpleHash(chunkNorm) === targetHash) {
      candidates.push(i);
    }
  }

  const refinedCandidates = new Set<number>();
  for (const start of candidates) {
    for (let di = -2; di <= 2; di++) {
      const idx = start + di;
      if (idx >= 0 && idx <= searchLimit - windowSize) refinedCandidates.add(idx);
    }
  }

  let bestDist = Infinity;
  let bestLineNo = -1;
  let bestSnippet = '';

  const scanSet = refinedCandidates.size > 0 ? refinedCandidates : new Set(Array.from({ length: searchLimit - windowSize + 1 }, (_, i) => i));

  for (const i of Array.from(scanSet)) {
    const window = contentLines.slice(i, i + windowSize).join('\n');
    const dist = levenshtein(normalizeWhitespace(window), normalTarget);
    if (dist < bestDist) {
      bestDist = dist;
      bestLineNo = i + 1;
      bestSnippet = window;
    }
  }

  if (bestDist <= threshold) {
    return { snippet: bestSnippet, lineNo: bestLineNo };
  }
  return null;
}

export interface FuzzyResult {
  patched?: string;
  error?: string;
}

export function fuzzyWhitespacePatch(content: string, oldStr: string, newStr: string, replaceAll: boolean): FuzzyResult {
  const normalOld = normalizeWhitespace(oldStr);
  const oldLineCount = oldStr.split('\n').length;
  const contentLines = content.split('\n');
  const matches: Array<{ start: number; end: number }> = [];

  for (let i = 0; i <= contentLines.length - oldLineCount; i++) {
    const window = contentLines.slice(i, i + oldLineCount).join('\n');
    if (normalizeWhitespace(window) === normalOld) {
      const start = contentLines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
      const end = start + window.length;
      matches.push({ start, end });
    }
  }

  if (matches.length === 0) {
    const trimmedOld = oldStr.trim();
    if (trimmedOld && trimmedOld !== oldStr) {
      return fuzzyWhitespacePatch(content, trimmedOld, newStr, replaceAll);
    }
    return { error: 'no_fuzzy_match' };
  }
  if (matches.length > 1 && !replaceAll) {
    return { error: `Fuzzy whitespace match found ${matches.length} ambiguous locations; add more surrounding context to make old_string unique.` };
  }

  if (replaceAll) {
    let result = content;
    for (let i = matches.length - 1; i >= 0; i--) {
      const { start, end } = matches[i];
      result = result.slice(0, start) + newStr + result.slice(end);
    }
    return { patched: result };
  }

  const { start, end } = matches[0];
  return { patched: content.slice(0, start) + newStr + content.slice(end) };
}

export function computeChangedLines(oldContent: string, newContent: string): number[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const maxLen = Math.max(oldLines.length, newLines.length);
  const changed: number[] = [];

  for (let i = 0; i < maxLen; i++) {
    if ((oldLines[i] ?? '') !== (newLines[i] ?? '')) {
      changed.push(i + 1);
    }
  }
  return changed;
}

interface TscBaseline {
  diagnostics: readonly ts.Diagnostic[];
  tsconfigMtime: number;
}

const tscBaselines = new Map<string, TscBaseline>();

function findTsconfig(filePath: string, projectRoot: string): string | null {
  let dir = path.dirname(filePath);
  while (true) {
    const candidate = path.join(dir, 'tsconfig.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const fallback = path.join(projectRoot, 'tsconfig.json');
  return fs.existsSync(fallback) ? fallback : null;
}

function runTscDiagnostics(tsconfigRoot: string): readonly ts.Diagnostic[] | null {
  try {
    const tsconfigPath = path.join(tsconfigRoot, 'tsconfig.json');
    const cfg = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (cfg.error) return null;
    const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, tsconfigRoot);
    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true, skipLibCheck: true });
    return ts.getPreEmitDiagnostics(program);
  } catch {
    return null;
  }
}

export function extractErrorLines(output: string): string[] {
  return output.split('\n')
    .map(l => l.trim())
    .filter(l => /error TS\d{4}/.test(l) && !/error TS5\d{3}/.test(l));
}

export function normalizeErrorLine(line: string): string {
  return line.replace(/\(\d+,\d+\)/g, '').trim();
}

function diagnosticsForFile(diags: readonly ts.Diagnostic[], targetAbs: string): ts.Diagnostic[] {
  const t = path.normalize(targetAbs);
  return diags.filter(d => d.file != null && path.normalize(d.file.fileName) === t);
}

function diagLine(d: ts.Diagnostic): number {
  if (d.file && d.start !== undefined) {
    return d.file.getLineAndCharacterOfPosition(d.start).line + 1;
  }
  return -1;
}

function isDeprecation(d: ts.Diagnostic): boolean {
  return d.code >= 5000 && d.code <= 5999;
}

// Module-resolution failures (missing/!unresolved imports, missing types) are
// environment issues, not patch syntax errors. Blocking a correct edit because a
// freshly-installed package's types aren't resolvable by the in-process tsc would
// cause the agent to loop on a valid change — so we never treat these as
// "introduced" by a patch.
function isModuleResolutionError(d: ts.Diagnostic): boolean {
  return [
    2307, // Cannot find module 'X' or its corresponding type declarations.
    2792, // Cannot find module 'X'. Did you mean to set moduleResolution?
    2891, // Cannot find module or type declarations for 'X'.
    2306, // 'X' refers to a UMD global, but not in a module.
    2503, // Cannot find namespace 'X'.
    7016, // Could not find a declaration file for module 'X'.
    1259, // Module 'X' can only be default-imported using esModuleInterop.
  ].includes(d.code);
}

// A missing `@types/node` makes Node globals (process, Buffer, __dirname, etc.)
// surface as TS2304 "Cannot find name 'X'". That is environmental — the agent
// cannot patch it away (it's a missing dev dependency during greenfield setup,
// not a code defect) — so it must never revert a write. Without this, scaffolding
// a fresh project (which references `process`/`Buffer` before `npm install
// @types/node` runs) gets its perfectly valid files reverted, stalling the run.
const NODE_GLOBALS = new Set([
  'process', 'Buffer', '__dirname', '__filename', 'global', 'module', 'require',
  'exports', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask', 'structuredClone', 'fetch',
  'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams', 'performance', 'process',
]);
function isMissingNodeGlobal(d: ts.Diagnostic): boolean {
  if (d.code !== 2304) return false;
  const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
  const m = msg.match(/Cannot find name '([^']+)'/);
  return !!m && NODE_GLOBALS.has(m[1]);
}
export { isMissingNodeGlobal };

// Transpile a single file in isolation to catch genuine syntax errors. This is
// independent of the rest of the project, so unrelated type errors or missing
// dependencies never cause a false "syntax error introduced by patch".
function singleFileSyntaxError(filePath: string): string | null {
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    const result = ts.transpileModule(code, {
      fileName: filePath,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
      reportDiagnostics: true,
    });
    const syntax = (result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
    if (syntax.length === 0) return null;
    return formatDiagnostic(syntax[0]);
  } catch {
    return null;
  }
}

function diagKey(d: ts.Diagnostic): string {
  return `${d.code}:${diagLine(d)}`;
}

function formatDiagnostic(d: ts.Diagnostic): string {
  const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
  const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
  const loc = pos ? `(${pos.line + 1},${pos.character + 1})` : '';
  const name = d.file ? d.file.fileName : '?';
  return `${name}${loc}: error TS${d.code}: ${msg}`;
}

export function isTestFile(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, '/').toLowerCase();
  return (
    norm.includes('.test.') ||
    norm.includes('.spec.') ||
    norm.includes('/tests/') ||
    norm.includes('/__tests__/') ||
    norm.includes('/test/') ||
    norm.startsWith('tests/') ||
    norm.startsWith('test/') ||
    norm.includes('.github/workflows/') ||
    norm.includes('.gitlab-ci')
  );
}

export function checkTestFileLock(filePath: string, context: ToolContext): string | null {
  if (!isTestFile(filePath)) return null;
  if (context.allowTestEdits) return null;

  // Scaffold-aware: a test file that does not exist yet on disk is a brand-new file
  // being created (e.g. GOAL.md requires `>= 1 vitest test`), not an existing
  // assertion being weakened. Allow first-time creation; only lock MODIFYING an
  // existing test file (the assertion-weakening case the lock exists for).
  if (!fs.existsSync(filePath)) return null;

  // Record the blocked attempt so a retry via a different tool (e.g. terminal
  // `cat >`) is recognized as a repeated bypass attempt, not a fresh request.
  if (!context.blockedTestWrites) context.blockedTestWrites = new Set<string>();
  const alreadyBlocked = context.blockedTestWrites.has(filePath);
  context.blockedTestWrites.add(filePath);

  if (alreadyBlocked) {
    return (
      `[TEST SUITE LOCK] Write to test file "${path.basename(filePath)}" was already refused earlier this session. ` +
      `Do NOT re-attempt it via another tool or the terminal — that is bypassing the lock. ` +
      `Either (1) report this blocker to the user and stop, or (2) if updating tests is the explicit goal, ` +
      `ask the user to re-run with test-update intent. Do not weaken, delete, or fake-pass any assertion to go green.`
    );
  }

  return (
    `[TEST SUITE LOCK] Write to test file "${path.basename(filePath)}" refused. ` +
    `Modifying test suite files is blocked by default to prevent test-assertion weakening. ` +
    `Do NOT attempt the write via the terminal or another tool to bypass this lock. ` +
    `If you intended to update or write tests, include "update test" or "test" in your request; ` +
    `otherwise report this blocker to the user and stop — never weaken or delete an assertion to make code pass.`
  );
}

// Gate wrapper around checkTestFileLock that honors a LIVE user authorization.
// The lexical allowTestEdits flag (set from the prompt) is not the only way to
// permit a test write: if the lock fires and the user explicitly approves via
// context.askLine, we set allowTestEdits for the rest of the session and allow
// the write. This closes the gap where an agent surfaces the blocker, the user
// says "yes", but the lock (which only saw the prompt text) still refuses.
// Returns null when the write is allowed, or the lock message when blocked.
export async function guardTestWrite(filePath: string, context: ToolContext): Promise<string | null> {
  const block = checkTestFileLock(filePath, context);
  if (!block) return null;
  if (context.askLine && !context.allowTestEdits) {
    let ans = '';
    try {
      ans = await context.askLine(
        `[TEST SUITE LOCK] Writing to test file "${path.basename(filePath)}" modifies the test suite. ` +
        `Allow it for this session? (y/N): `,
      );
    } catch {
      ans = '';
    }
    if (ans && /^y(es)?$/i.test(ans.trim())) {
      context.allowTestEdits = true;
      context.testApprovalGranted = true;
      return null;
    }
  }
  return block;
}

/**
 * Pre-flight dependency resolution check.
 * Run BEFORE writing content to disk or invoking syntaxCheck, to avoid the failure mode
 * where a patch introduces an import of an uninstalled package / package without @types
 * (e.g. `helmet` without `@types/helmet`), generating a real TS7016/TS2307 diagnostic that
 * correctly triggers a revert — which the agent then re-proposes 3x until it breaks the
 * patch circuit breaker or spins on side quests (running bare tsc, installing unrelated deps).
 *
 * This check verifies that every module specifier in `proposedContent` can be resolved by
 * TypeScript using the project's tsconfig.json compiler options (paths, baseUrl,
 * esModuleInterop, types). Returns a human-readable "resolve first" message if any
 * dependency has no usable type declarations, or null if the proposed imports are
 * resolvable. Import-resolution errors (TS2307/TS1259/...) are exactly the class the
 * post-write gate filters as environment noise — here we surface them pre-write as a
 * concrete install/type step instead of letting the agent re-propose the same patch.
 */
export function preflightDependencyCheck(
  filePath: string,
  projectRoot: string,
  proposedContent?: string,
): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.ts' && ext !== '.tsx' && ext !== '.js' && ext !== '.mjs' && ext !== '.cjs') {
    return null;
  }
  const content = proposedContent ?? safeRead(filePath);
  if (content === null) return null;

  const tsconfigPath = findTsconfig(filePath, projectRoot);
  if (!tsconfigPath) return null;
  const tsconfigRoot = path.dirname(tsconfigPath);

  // Scaffold-aware: a fresh project has no node_modules yet, so every third-party
  // import is "missing type declarations" until `npm install` runs. Blocking the
  // write then just churns the agent (write -> revert -> install -> re-write). Treat
  // the absence of node_modules as environment noise and let the write through; tsc
  // will still surface real errors after install. Established projects keep the gate.
  if (!fs.existsSync(path.join(tsconfigRoot, 'node_modules'))) return null;

  const specifiers = new Set<string>();
  const importRe = /(?:import\s+(?:[^'"]*?\s+from\s+)?|require\(\s*)['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(content)) !== null) {
    const spec = m[1];
    if (spec.startsWith('.') || spec.startsWith('/')) continue;
    // strip node: protocol (e.g. 'node:path' -> 'path') so built-ins resolve via @types/node
    const bare = spec.replace(/^node:/, '');
    // strip subpath (e.g. 'helmet/dist' -> 'helmet')
    const pkg = bare.split('/').reduce((acc, part) => {
      if (part.startsWith('@')) return part; // scoped: keep @scope
      if (acc.startsWith('@')) return `${acc}/${part}`; // @scope/name
      return part;
    }, '');
    if (pkg) specifiers.add(pkg);
  }
  if (specifiers.size === 0) return null;

  const missing: string[] = [];
  for (const pkg of specifiers) {
    if (packageResolves(pkg, tsconfigRoot)) continue;
    missing.push(pkg);
  }
  if (missing.length === 0) return null;

  const scoped = missing.map(p => `@types/${p.replace(/^@[^/]+\//, '')}`);
  return (
    `Pre-flight: patch would fail typecheck - missing type declarations for: ${missing.join(', ')}.\n` +
    `Resolve BEFORE patching (do not re-propose the same edit):\n` +
    `  npm install --save-dev ${scoped.join(' ')}\n` +
    `Then re-run the patch. If the package ships its own types, instead type the import ` +
    `(e.g. \`import type { HelmetOptions } from 'helmet'\`) so the literal is validated against the real signature.`
  );
}

/** Node.js built-in modules. These resolve via @types/node (a single package that
 * declares ALL built-ins) — there is no `node_modules/path` or `node_modules/@types/path`.
 * Flagging them as "missing type declarations" is always a false positive, so the
 * pre-flight gate treats any built-in as resolved. This is what made every patch to a
 * Node server file (which imports path/crypto/fs/etc.) fail pre-write. */
const NODE_BUILTINS = new Set([
  'assert', 'assert/strict', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'dns/promises', 'domain',
  'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl',
  'stream', 'stream/promises', 'string_decoder', 'test', 'timers', 'timers/promises', 'tls',
  'trace_events', 'tty', 'url', 'util', 'util/types', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

function isNodeBuiltin(pkg: string): boolean {
  return NODE_BUILTINS.has(pkg);
}

/** True if `pkg` is resolvable from node_modules with usable type declarations under this tsconfig. */
function packageResolves(pkg: string, tsconfigRoot: string): boolean {
  // Node built-ins are declared by @types/node; never flag them.
  if (isNodeBuiltin(pkg)) return true;
  // 1) package with bundled types: package.json "types"/"typings" or an index.d.ts present
  const pkgDir = path.join(tsconfigRoot, 'node_modules', pkg);
  if (fs.existsSync(pkgDir)) {
    const pkgJson = path.join(pkgDir, 'package.json');
    if (fs.existsSync(pkgJson)) {
      try {
        const j = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
        if (j.types || j.typings) return true;
      } catch { /* fall through */ }
    }
    if (fs.existsSync(path.join(pkgDir, 'index.d.ts'))) return true;
  }
  // 2) @types/<pkg> companion present
  const typesPkg = `@types/${pkg.replace(/^@[^/]+\//, '')}`;
  if (fs.existsSync(path.join(tsconfigRoot, 'node_modules', typesPkg))) return true;
  // 3) package name itself is a @types/* package
  if (pkg.startsWith('@types/') && fs.existsSync(pkgDir)) return true;
  return false;
}

export async function syntaxCheck(
  filePath: string,
  projectRoot: string,
  proposedContent?: string,
  originalContent?: string,
  modifiedLines?: number[],
): Promise<string | null> {
  const ext = path.extname(filePath).toLowerCase();
  const targetAbs = path.resolve(filePath);

  if (ext === '.json') {
    const text = proposedContent ?? safeRead(filePath);
    if (text === null) return null;
    try {
      JSON.parse(text);
      return null;
    } catch (e) {
      return `JSON syntax error: ${(e instanceof Error ? e.message : String(e))}`;
    }
  }

  if (ext === '.yaml' || ext === '.yml') {
    const text = proposedContent ?? safeRead(filePath);
    if (text === null) return null;
    const tabLine = text.split('\n').findIndex(l => l.includes('\t'));
    if (tabLine !== -1) return `YAML syntax error: tab character on line ${tabLine + 1} (YAML requires spaces)`;
    return null;
  }

  if (ext === '.ts' || ext === '.tsx') {
    const tsconfigPath = findTsconfig(filePath, projectRoot);
    if (!tsconfigPath) return null;

    const tsconfigRoot = path.dirname(tsconfigPath);
    const content = proposedContent ?? safeRead(filePath);
    if (content === null) return null;

    // 1) Definitive syntax gate: transpile ONLY the proposed content in memory.
    // A genuine syntax break (bad brackets, stray token) fails here regardless of
    // the rest of the project, and we never touch disk to discover it.
    const transpileDiag = transpileContent(content, targetAbs);
    if (transpileDiag) {
      const local = localizeUnbalancedDelimiter(content);
      const localHint = local
        ? `\n\nLocalized root cause: ${local}`
        : '';
      return `Syntax error introduced by patch — reverted.${localHint}\n${transpileDiag}`;
    }

    // 2) Type-error gate: compile the proposed content in memory and diff its
    // (code:line) diagnostics against the original content. Only NEWLY INTRODUCED
    // errors block. Module-resolution failures (TS2307 etc.) and deprecations are
    // environment noise the agent cannot patch away, so they never block — that
    // was the false-revert class (e.g. installing helmet then importing it).
    const allDiags = runTscDiagnostics(tsconfigRoot);
    if (!allDiags) return null;

    const proposedDiags = diagnosticsForFile(allDiags, targetAbs)
      .filter(d => !isDeprecation(d) && !isModuleResolutionError(d) && !isMissingNodeGlobal(d));

    const originalKeys = originalContent !== undefined
      ? baselineKeysFromOriginal(tsconfigRoot, targetAbs, originalContent)
      : new Set<string>();

    const introduced = proposedDiags.filter(d => !originalKeys.has(diagKey(d)));
    if (introduced.length === 0) return null;

    // Report ALL newly-introduced diagnostics, not just the first, so the agent
    // can fix every issue in a single corrected patch instead of looping
    // (fix one -> re-validate -> hit the next -> revert again). This is the
    // exact loop that previously sent weak-tier models to an unvalidated
    // MCP filesystem editor as an escape hatch.
    const allErrors = introduced.map(formatDiagnostic);

    // Targeted hint for the most common agent mistake: imports placed inside a
    // function body (illegal in ES modules) or otherwise misplaced. Caught as
    // TS1128 ("Import declarations cannot be nested"), TS1138 ("import only
    // allowed at top level"), or TS1232 ("import declaration can only be used at
    // the top level of a namespace or module").
    const hasMisplacedImport = introduced.some(d => d.code === 1128 || d.code === 1138 || d.code === 1232);
    const misplacedHint = hasMisplacedImport
      ? '\n\nHint: imports must be at the TOP LEVEL of the file (before any function), not inside a function body. Move each `import` statement above `export function createApp`.'
      : '';

    // Targeted hint for the "removed a symbol but it's still referenced" mistake:
    // the patch deletes a declaration (e.g. a function parameter) yet the symbol
    // is still used downstream, so the resulting TS2304 errors look like a generic
    // "syntax error" to the user/agent and the agent loops re-proposing the same
    // partial edit. Point at the exact still-referenced lines so it fixes them
    // together instead of retrying.
    const removedSymbolHint = buildRemovedSymbolHint(introduced, proposedContent, originalContent);

    return `Type error introduced by patch — reverted.\n${allErrors.join('\n')}${misplacedHint}${removedSymbolHint}`;
  }

  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    const text = proposedContent ?? safeRead(filePath);
    if (text === null) return null;
    const result = spawnSync(process.execPath, ['--check', filePath], {
      input: text,
      timeout: 10000,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      const output = (result.stderr ?? result.stdout ?? '').split('\n')[0];
      const hasTsSyntax = /(?:^|\s)(?:interface\s+\w+|type\s+\w+\s*=|private\s+|protected\s+|public\s+|readonly\s+|enum\s+\w+|implements\s+\w+|:\s*(?:string|number|boolean|any|unknown|never|void|Promise<|Record<|Array<|[A-Z][a-zA-Z0-9_]*<))/m.test(text);
      const tsHint = hasTsSyntax
        ? `\n\nHint: TypeScript syntax detected in a ${ext} file. For TypeScript projects, name your source file with a .ts extension (e.g. '${filePath.replace(/\.[mc]?js$/, '.ts')}') instead of ${ext}.`
        : '';
      return `Syntax error introduced by patch — reverted.\n${output || 'Syntax error detected'}${tsHint}`;
    }
  }

  return null;
}

// Detects when an introduced TS2304 ("Cannot find name 'X'") refers to a symbol the
// patch itself deleted (present in originalContent, absent in proposedContent), and
// returns a hint listing the lines where X is still referenced in the proposed file.
export function buildRemovedSymbolHint(
  introduced: ts.Diagnostic[],
  proposed?: string | null,
  original?: string | null,
): string {
  if (!proposed || !original) return '';
  const removedNames = new Set<string>();
  for (const m of original.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g)) {
    const name = m[1];
    // A declaration of `name` in the original that is absent in the proposed means
    // the patch deleted it. We match declaration shapes (param, binding, def) rather
    // than mere token presence, because the name may still appear as a *usage* in the
    // proposed file (e.g. `app.listen(port)`) — that usage is exactly what breaks.
    const declRe = new RegExp(
      `(?:\\b(?:const|let|var|function|class|interface|type|enum)\\s+${name}\\b` +
      `|[(,\\s]\\s*${name}\\s*\\??\\s*:` +
      `|\\b${name}\\s*=\\s)`,
    );
    if (declRe.test(original) && !declRe.test(proposed)) removedNames.add(name);
  }
  if (removedNames.size === 0) return '';
  const lines = proposed.split('\n');
  const hints: string[] = [];
  for (const name of removedNames) {
    const refs: number[] = [];
    const usageRe = new RegExp(`\\b${name}\\b`);
    const declRe = new RegExp(`\\b(?:const|let|var|function|class|interface|type|enum)\\s+${name}\\b`);
    lines.forEach((ln, i) => {
      if (usageRe.test(ln) && !declRe.test(ln)) {
        refs.push(i + 1);
      }
    });
    if (refs.length > 0) {
      hints.push(`'${name}' was removed by this patch but is still referenced at line(s) ${refs.join(', ')}. Remove or update those usages in the same edit (or read the current file and fix them together) — do not re-propose the same partial change.`);
    }
  }
  return hints.length > 0 ? `\n\nHint: ${hints.join(' ')}` : '';
}

function safeRead(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

// Transpile proposed content in isolation to catch genuine syntax errors.
function transpileContent(content: string, filePath: string): string | null {
  try {
    const result = ts.transpileModule(content, {
      fileName: filePath,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
      reportDiagnostics: true,
    });
    const syntax = (result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
    if (syntax.length === 0) return null;
    return formatDiagnostic(syntax[0]);
  } catch {
    return null;
  }
}

// Localize a syntax break to the OPENING delimiter, not the parser's recovery point.
// tsc/esbuild report (e.g.) "error TS1005 at line 387" for an unterminated template
// literal opened at line 260 — pointing the agent at 387 makes it blame whitespace or
// the diff/side-by-side tool and re-propose a cosmetic reindent (the exact loop the
// user hit). This scanner finds the first unbalanced delimiter (template literal or
// bracket) and reports where it OPENED, which is what the agent must fix. It runs only
// on files that already failed the transpile gate, so the cost is bounded by the failure
// path. Regex/JSX content may add bracket noise, but on a genuinely broken file the
// dangling-template signal dominates and is regex-proof (it keys off the backtick only).
function localizeUnbalancedDelimiter(content: string): string | null {
  const lines = content.split('\n');
  const stack: { ch: string; line: number; col: number }[] = [];
  const openers: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const closers: Record<string, string> = { ')': '(', '}': '{', ']': '[' };
  let inTemplate = false;
  let templateOpenLine = 0;
  let templateOpenCol = 0;
  let templateDepth = 0; // count of open ${...} inside the current top-level template
  let inBlock = false;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];
      const nxt = line[ci + 1] ?? '';
      if (inBlock) {
        if (ch === '*' && nxt === '/') { inBlock = false; ci++; }
        continue;
      }
      if (ch === '/' && nxt === '/') { break; } // line comment: rest of line is inert
      if (ch === '/' && nxt === '*') { inBlock = true; ci++; continue; }
      if (inTemplate) {
        if (ch === '\\') { ci++; continue; }
        if (ch === '`') {
          // A backtick closes the template ONLY at the top level (depth 0). A backtick
          // inside ${...} closes an INNER template and leaves the outer one open — without
          // this guard a legitimate `${ `inner` }` would wrongly close the outer literal.
          if (templateDepth === 0) { inTemplate = false; }
          continue;
        }
        if (ch === '$' && nxt === '{') { templateDepth++; ci++; continue; }
        if (ch === '}') { if (templateDepth > 0) templateDepth--; continue; }
        continue;
      }
      if (ch === '`') {
        if (!inTemplate) { inTemplate = true; templateOpenLine = li + 1; templateOpenCol = ci + 1; }
        continue;
      }
      if (ch === '"' || ch === "'") {
        const q = ch;
        ci++;
        while (ci < line.length) {
          const c2 = line[ci];
          if (c2 === '\\') { ci += 2; continue; }
          if (c2 === q) break;
          ci++;
        }
        continue;
      }
      if (openers[ch]) { stack.push({ ch, line: li + 1, col: ci + 1 }); continue; }
      if (closers[ch]) {
        const top = stack.pop();
        const expect = closers[ch];
        if (!top || top.ch !== expect) {
          return `Mismatched closer '${ch}' at line ${li + 1} col ${ci + 1}${top ? ` (opened '${top.ch}' at line ${top.line} col ${top.col})` : ''}.`;
        }
      }
    }
  }
  if (inTemplate) {
    return `Template literal opened with \` at line ${templateOpenLine} col ${templateOpenCol} is never closed (it is likely closed by the wrong character, e.g. a " instead of a \`). This is the root cause of the syntax break — tsc reports the error much later at its recovery point. Fix THIS opening backtick and its matching closer, not the line tsc points at.`;
  }
  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    return `Unclosed delimiter '${top.ch}' opened at line ${top.line} col ${top.col} and never closed — tsc may report the error far from here (at its recovery point). Fix this OPENING delimiter.`;
  }
  return null;
}

// Compute the (code:line) diagnostic keys for `originalContent` as if it were the
// target file, so we can tell which diagnostics the patch NEWLY introduced. We do a
// short disk swap (write orig, compile, restore) because tsc resolves types from the
// project's own tsconfig/node_modules — an in-memory CompilerHost would instead pull
// types from Daedalus's own install and give wrong results. The file is restored to
// its prior state (the proposed content) before returning, so the caller's disk is
// unchanged. Module-resolution + deprecation noise is excluded.
function baselineKeysFromOriginal(tsconfigRoot: string, targetAbs: string, originalContent: string): Set<string> {
  let prior: string | null = null;
  try {
    prior = fs.readFileSync(targetAbs, 'utf8');
    fs.writeFileSync(targetAbs, originalContent, 'utf8');
    const all = runTscDiagnostics(tsconfigRoot);
    if (!all) return new Set();
    return new Set(
      diagnosticsForFile(all, targetAbs)
        .filter(d => !isDeprecation(d) && !isModuleResolutionError(d) && !isMissingNodeGlobal(d))
        .map(diagKey),
    );
  } catch {
    return new Set();
  } finally {
    if (prior !== null) {
      try { fs.writeFileSync(targetAbs, prior, 'utf8'); } catch { /* ignore */ }
    }
  }
}

export function checkWriteWithoutRead(targetPath: string, context: ToolContext): string | null {
  if (!context.sessionReadCache) return null;
  if (!fs.existsSync(targetPath)) return null;
  const readMtime = context.sessionReadCache.get(targetPath);
  if (readMtime === undefined) {
    context.sessionReadCache.set(targetPath, fs.statSync(targetPath).mtimeMs);
    return null;
  }
  const currentMtime = fs.statSync(targetPath).mtimeMs;
  if (currentMtime > readMtime + 500) {
    return `[STALE READ] ${path.basename(targetPath)} was modified after you last read it. Use read_file to get the current content before patching.`;
  }
  return null;
}

function getStreakMap(context: ToolContext): Map<string, number> {
  if (!context.patchFailureStreak) {
    context.patchFailureStreak = new Map<string, number>();
  }
  return context.patchFailureStreak;
}

// ── Graduated patch circuit breaker ──────────────────────────────────────────
// Ported philosophy from Munder Difflin's breaker: escalate ONE level per
// failure (steer → constrain → stop) instead of a single binary trip, and
// recover one level per successful write. A successful patch clears the streak,
// so the ladder resets naturally (see recordWriteSuccess).

export type PatchBreakerLevel = 'healthy' | 'steering' | 'constrained' | 'stopped';

// Per-path streak thresholds, mirroring the steer→constrain→stop ladder.
// Tuned to Daedalus' small budgets: the per-path breaker escalates fast because
// a single file reverting twice is already a strong loop signal.
export const PATCH_BREAKER_STEER = 2; // gentle: re-read and reconstruct
export const PATCH_BREAKER_CONSTRAIN = 3; // firm: stop varying the same edit
export const PATCH_BREAKER_STOP = 4; // hard: pause the loop

export function patchBreakerLevel(streak: number): PatchBreakerLevel {
  if (streak >= PATCH_BREAKER_STOP) return 'stopped';
  if (streak >= PATCH_BREAKER_CONSTRAIN) return 'constrained';
  if (streak >= PATCH_BREAKER_STEER) return 'steering';
  return 'healthy';
}

export function checkCircuitBreaker(targetPath: string, context: ToolContext): string | null {
  const map = getStreakMap(context);
  const streak = map.get(targetPath) ?? 0;
  if (streak < PATCH_BREAKER_STEER) return null;

  const level = patchBreakerLevel(streak);
  const base = `[CIRCUIT BREAKER] patch reverted ${streak} consecutive times on ${path.basename(targetPath)}`;
  // Same-edit loop signal: the SAME intent was reverted repeatedly. This is the
  // clearest runaway shape — name it explicitly so the agent stops re-issuing
  // the identical broken edit and reads the actual error instead.
  const repeats = getPatchRepeatCount(targetPath, context);
  const loopNote = repeats >= 2
    ? ` This exact edit has now failed ${repeats} times in a row — you are looping on the same broken approach. Stop patching and diagnose the real error before trying again.`
    : '';
  switch (level) {
    case 'steering':
      return `${base}. Re-read the current file with read_file and reconstruct your patch from the actual content.${loopNote}`;
    case 'constrained':
      return `${base}. You keep issuing variations of the same edit — stop. Read the FULL current file, then either produce a written plan via the todo tool and a small verified patch, or report the blocker to the user.${loopNote}`;
    case 'stopped':
      return `${base}. Too many reverted patches on this file — pausing to avoid a loop. Diagnose the root cause by reading the FULL current file, then report the blocker to the user instead of retrying.${loopNote}`;
    default:
      return null;
  }
}

export function recordWriteSuccess(targetPath: string, context: ToolContext): void {
  getStreakMap(context).set(targetPath, 0);
  // A successful patch to this file clears the session-wide loop counter too, so a
  // later genuine failure on a different file/area starts the budget fresh.
  context.patchFailureTotal = 0;
  // Recovery: a real successful write resets the same-edit loop signal.
  context.patchRepeatCount?.delete(targetPath);
  context.patchRepeatKey?.delete(targetPath);
  if (context.sessionReadCache && fs.existsSync(targetPath)) {
    context.sessionReadCache.set(targetPath, fs.statSync(targetPath).mtimeMs);
  }
}

export function recordRevert(targetPath: string, context: ToolContext, intent?: string): void {
  const map = getStreakMap(context);
  const streak = map.get(targetPath) ?? 0;
  map.set(targetPath, streak + 1);
  context.patchFailureTotal = (context.patchFailureTotal ?? 0) + 1;
  if (context.sessionReadCache && fs.existsSync(targetPath)) {
    context.sessionReadCache.set(targetPath, fs.statSync(targetPath).mtimeMs);
  }
  // Same-edit loop detector (Munder Difflin "looping" signal): a repeated revert
  // of the SAME intent (target + attempted new content) is the clearest runaway
  // signal — the agent is re-issuing the identical broken edit. Bump the repeat
  // count so checkCircuitBreaker can name the loop and escalate faster.
  if (intent !== undefined) {
    if (!context.patchRepeatKey) context.patchRepeatKey = new Map<string, string>();
    if (!context.patchRepeatCount) context.patchRepeatCount = new Map<string, number>();
    const sig = `${targetPath}::${intentSignature(intent)}`;
    const prev = context.patchRepeatKey.get(targetPath);
    if (prev === sig) {
      context.patchRepeatCount.set(targetPath, (context.patchRepeatCount.get(targetPath) ?? 0) + 1);
    } else {
      context.patchRepeatKey.set(targetPath, sig);
      context.patchRepeatCount.set(targetPath, 1);
    }
  }
}

/** Lightweight, stable signature of an attempted patch's new content. Truncated
 *  so near-identical intents (whitespace/spacing tweaks) still collide as a loop. */
function intentSignature(intent: string): string {
  const normalized = intent.replace(/\s+/g, ' ').trim().slice(0, 200);
  let h = 5381;
  for (let i = 0; i < normalized.length; i++) {
    h = ((h << 5) + h + normalized.charCodeAt(i)) | 0;
  }
  return `${normalized.length}:${h}`;
}

/** Consecutive same-intent revert count for a path (0 when unknown). */
export function getPatchRepeatCount(targetPath: string, context: ToolContext): number {
  return context.patchRepeatCount?.get(targetPath) ?? 0;
}

// Global patch-failure loop breaker. Unlike the per-path streak (which resets on a
// successful read of the same file), this counts EVERY syntax-reverting patch in the
// session and is NOT cleared by intervening read_file calls. It exists to stop the
// exact failure mode where an agent issues many differently-worded patches to the same
// conceptual edit, each failing the in-memory syntax check, while interleaving reads
// so the per-path/per-signature breakers never accumulate. After 3 total reverts the
// caller must stop patching and produce a plan instead of retrying.
export const PATCH_FAILURE_LIMIT = 3;

export function checkGlobalPatchBreaker(context: ToolContext): string | null {
  const total = context.patchFailureTotal ?? 0;
  if (total < PATCH_FAILURE_LIMIT) return null;

  const level = patchBreakerLevel(total);
  const prefix = '[PAUSED] ' + total + ' patch(es) were reverted by the in-memory syntax check this session';
  switch (level) {
    case 'stopped':
      return `${prefix}. Too many reverted patches — pausing to avoid a loop. Diagnose the root cause by reading the FULL current file, then report the blocker to the user instead of retrying. Do NOT keep retrying variations of the same edit.`;
    case 'constrained':
      return `${prefix}. You keep issuing variations of the same edit across files/areas — stop. Read the FULL current file(s), produce a written plan via the todo tool and a small verified patch, or report the blocker to the user.`;
    default: // 'steering' (total === PATCH_FAILURE_LIMIT)
      return `${prefix}. Pause issuing further patches to this file/area. Diagnose the root cause by reading the FULL current file, then either (1) produce a written plan via the todo tool and a small, verified patch, or (2) report the blocker to the user instead of looping. Do NOT keep retrying variations of the same edit.`;
  }
}

export function recordPatchFailure(targetPath: string, context: ToolContext): void {
  const map = getStreakMap(context);
  const streak = map.get(targetPath) ?? 0;
  map.set(targetPath, streak + 1);
}

export function validateImports(filePath: string, projectRoot: string): string[] {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(ext)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const warnings: string[] = [];

  const importRe = /^import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/gm;
  let match;
  while ((match = importRe.exec(content)) !== null) {
    const spec = match[1];
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const candidates = [spec, `${spec}.ts`, `${spec}.js`, `${spec}/index.ts`, `${spec}/index.js`];
      const resolved = candidates.map(c => path.resolve(path.dirname(filePath), c));
      if (!resolved.some(r => fs.existsSync(r))) {
        warnings.push(`Local import not found: '${spec}'`);
      }
    } else {
      const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      const pkgJson = path.join(projectRoot, 'package.json');
      if (fs.existsSync(pkgJson)) {
        try {
          const { dependencies = {}, devDependencies = {} } = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
          if (!dependencies[pkg] && !devDependencies[pkg]) {
            const nmPath = path.join(projectRoot, 'node_modules', pkg);
            if (!fs.existsSync(nmPath)) {
              warnings.push(`npm package not in package.json: '${pkg}'`);
            }
          }
        } catch { /* ignored */ }
      }
    }
  }
  return warnings;
}

export function validateExports(filePath: string): string[] {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(ext)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const warnings: string[] = [];

  const namedExportRe = /^export\s+\{([^}]+)\}/gm;
  let match;
  while ((match = namedExportRe.exec(content)) !== null) {
    const names = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    for (const name of names) {
      const definedRe = new RegExp(`(?:function|class|const|let|var|type|interface|enum)\\s+${name}\\b`);
      if (!definedRe.test(content)) {
        warnings.push(`Exported name '${name}' is not defined in this file`);
      }
    }
  }
  return warnings;
}

export async function runColocatedTests(filePath: string, projectRoot: string): Promise<string | null> {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, -ext.length);
  const testCandidates = [`${base}.test${ext}`, `${base}.spec${ext}`];
  const testFile = testCandidates.find(t => fs.existsSync(t));
  if (!testFile) return null;

  const result = spawnSync('npx', ['vitest', 'run', testFile, '--reporter=verbose'], {
    cwd: projectRoot,
    timeout: 30000,
    encoding: 'utf8',
    shell: true,
  });
  if (result.status !== 0) {
    const output = ((result.stdout ?? '') + (result.stderr ?? '')).split('\n')
      .filter(l => l.match(/FAIL|×|Error|AssertionError/))
      .slice(0, 8)
      .join('\n');
    return `[TEST FAILURE] ${path.basename(testFile)} failed after this change:\n${output || result.stdout?.slice(0, 400) || 'unknown error'}\nFix the code to make the tests pass.`;
  }
  return null;
}

export function checkPackageJsonAntiPatterns(filePath: string, _projectRoot: string): string[] {
  if (!filePath.endsWith('package.json')) return [];
  try {
    const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const warnings: string[] = [];
    const pkgName = pkg.name || '';
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    if (allDeps['vscode']) {
      warnings.push('Deprecated `vscode` npm package found in dependencies. Use only `@types/vscode` for type definitions.');
    }

    if (allDeps[pkgName]) {
      warnings.push(`Circular dependency: package "${pkgName}" depends on itself. Remove "${pkgName}" from dependencies.`);
    }
    if (allDeps['daedalus-cli'] && !pkgName?.includes('daedalus-cli')) {
      warnings.push('Project should not depend on "daedalus-cli" — the CLI is spawned externally, not imported as a library.');
    }

    const vsCodeTypes = pkg.devDependencies?.['@types/vscode'];
    const vsCodeEngine = pkg.engines?.vscode;
    if (vsCodeTypes && vsCodeEngine && vsCodeTypes.replace(/^\^|\~/, '') !== vsCodeEngine.replace(/^\^|\~/, '')) {
      warnings.push(`@types/vscode version (${vsCodeTypes}) should match engines.vscode (${vsCodeEngine}) exactly.`);
    }

    return warnings;
  } catch { return []; }
}

export function buildPostWriteWarnings(filePath: string, projectRoot: string): string[] {
  const importWarnings = validateImports(filePath, projectRoot);
  const exportWarnings = validateExports(filePath);
  const antiPatterns = checkPackageJsonAntiPatterns(filePath, projectRoot);
  return [...importWarnings, ...exportWarnings, ...antiPatterns];
}
