import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import ts from 'typescript';
import { ToolContext } from '../../types.js';

export function normalizeWhitespace(str: string): string {
  return str
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => (line.match(/^\s+/) ? ' ' : '') + line.trimStart().trimEnd())
    .join('\n');
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
  const name = d.file ? path.basename(d.file.fileName) : '?';
  return `${name}${loc}: error TS${d.code}: ${msg}`;
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
    if (transpileDiag) return transpileDiag;

    // 2) Type-error gate: compile the proposed content in memory and diff its
    // (code:line) diagnostics against the original content. Only NEWLY INTRODUCED
    // errors block. Module-resolution failures (TS2307 etc.) and deprecations are
    // environment noise the agent cannot patch away, so they never block — that
    // was the false-revert class (e.g. installing helmet then importing it).
    const allDiags = runTscDiagnostics(tsconfigRoot);
    if (!allDiags) return null;

    const proposedDiags = diagnosticsForFile(allDiags, targetAbs)
      .filter(d => !isDeprecation(d) && !isModuleResolutionError(d));

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
    const hint = hasMisplacedImport
      ? '\n\nHint: imports must be at the TOP LEVEL of the file (before any function), not inside a function body. Move each `import` statement above `export function createApp`.'
      : '';

    return `${allErrors.join('\n')}${hint}`;
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
      return output || 'Syntax error detected';
    }
  }

  return null;
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
        .filter(d => !isDeprecation(d) && !isModuleResolutionError(d))
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

export function checkCircuitBreaker(targetPath: string, context: ToolContext): string | null {
  const map = getStreakMap(context);
  const streak = map.get(targetPath) ?? 0;
  if (streak >= 2) {
    return `[CIRCUIT BREAKER] patch failed ${streak} consecutive times on ${path.basename(targetPath)}. Use read_file to inspect the current state and reconstruct your patch from the actual content.`;
  }
  return null;
}

export function recordWriteSuccess(targetPath: string, context: ToolContext): void {
  getStreakMap(context).set(targetPath, 0);
  if (context.sessionReadCache && fs.existsSync(targetPath)) {
    context.sessionReadCache.set(targetPath, fs.statSync(targetPath).mtimeMs);
  }
}

export function recordRevert(targetPath: string, context: ToolContext): void {
  const map = getStreakMap(context);
  const streak = map.get(targetPath) ?? 0;
  map.set(targetPath, streak + 1);
  if (context.sessionReadCache && fs.existsSync(targetPath)) {
    context.sessionReadCache.set(targetPath, fs.statSync(targetPath).mtimeMs);
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
