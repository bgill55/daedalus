import fs from 'fs';
import path from 'path';
import { execSync, spawn, spawnSync } from 'child_process';
import os from 'os';
import { ToolContext, ToolResult } from '../../types.js';
import { guardGitPath } from '../git-guard.js';
import { runDiffWorkflow, type DiffOptions } from './diff-ui.js';

const DEFAULT_EXCLUDE_DIRS = [
  'node_modules', 'dist', 'build', '.git', 'target', 'coverage',
  'venv', '.venv', 'env', '.env', '__pycache__', '.pytest_cache',
  '.mypy_cache', '.next', 'out', '.cache'
];


function normalizeWhitespace(str: string): string {
  return str
    .split('\n')
    .map(line => (line.match(/^\s+/) ? ' ' : '') + line.trimStart().trimEnd())
    .join('\n');
}

function levenshtein(a: string, b: string): number {
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

function findClosestBlock(content: string, target: string): { snippet: string; lineNo: number } | null {
  const targetLines = target.split('\n');
  const windowSize = targetLines.length;
  const contentLines = content.split('\n');
  const searchLimit = Math.min(contentLines.length, 300);
  const normalTarget = normalizeWhitespace(target);
  const threshold = Math.ceil(normalTarget.length * 0.30);

  // Fast path: for files under 100 lines, scan everything
  if (contentLines.length <= 100) {
    return findClosestBlockScan(contentLines, windowSize, searchLimit, normalTarget, threshold);
  }

  // Chunk-based pre-filter: hash each chunk and compare to target hash
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

  // Also check exact overlap around each candidate
  const refinedCandidates = new Set<number>();
  for (const start of candidates) {
    for (let di = -2; di <= 2; di++) {
      const idx = start + di;
      if (idx >= 0 && idx <= searchLimit - windowSize) refinedCandidates.add(idx);
    }
  }

  // Run Levenshtein on refined candidates only, plus fall back to full scan if none found
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

function findClosestBlockScan(
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

function simpleHash(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

interface FuzzyResult {
  patched?: string;
  error?: string;
}

function fuzzyWhitespacePatch(content: string, oldStr: string, newStr: string, replaceAll: boolean): FuzzyResult {
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

  if (matches.length === 0) return { error: 'no_fuzzy_match' };
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

function computeChangedLines(oldContent: string, newContent: string): number[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const maxLen = Math.max(oldLines.length, newLines.length);
  const changed: number[] = [];

  for (let i = 0; i < maxLen; i++) {
    if ((oldLines[i] ?? '') !== (newLines[i] ?? '')) {
      changed.push(i + 1); // 1-indexed line numbers
    }
  }
  return changed;
}

async function syntaxCheck(filePath: string, projectRoot: string, modifiedLines?: number[]): Promise<string | null> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.json') {
    try {
      JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return null;
    } catch (e: any) {
      return `JSON syntax error: ${e.message}`;
    }
  }

  if (ext === '.yaml' || ext === '.yml') {
    const content = fs.readFileSync(filePath, 'utf8');
    const tabLine = content.split('\n').findIndex(l => l.includes('\t'));
    if (tabLine !== -1) return `YAML syntax error: tab character on line ${tabLine + 1} (YAML requires spaces)`;
    return null;
  }

  if (ext === '.ts' || ext === '.tsx') {
    // Walk up from the file's directory to find the nearest tsconfig.json
    let tsconfigDir = path.dirname(filePath);
    let tsconfigPath: string | null = null;
    while (true) {
      const candidate = path.join(tsconfigDir, 'tsconfig.json');
      if (fs.existsSync(candidate)) { tsconfigPath = candidate; break; }
      const parent = path.dirname(tsconfigDir);
      if (parent === tsconfigDir) break;
      tsconfigDir = parent;
    }
    if (!tsconfigPath) tsconfigPath = path.join(projectRoot, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) return null;

    const tsconfigRoot = path.dirname(tsconfigPath);
    const runTsc = () => spawnSync('npx', ['tsc', '--noEmit', '--skipLibCheck'], {
      cwd: tsconfigRoot,
      timeout: 15000,
      encoding: 'utf8',
      shell: true,
    });
    let result = runTsc();
    if (result.status !== 0) {
      const output = (result.stdout ?? '') + (result.stderr ?? '');
      const lines = output.split('\n');
      const hasDeprecation = lines.some(l => /error TS5\d{3}/.test(l));
      if (hasDeprecation) {
        try {
          const raw = fs.readFileSync(tsconfigPath, 'utf8');
          const cfg = JSON.parse(raw);
          if (!cfg.compilerOptions) cfg.compilerOptions = {};
          if (!cfg.compilerOptions.ignoreDeprecations) {
            cfg.compilerOptions.ignoreDeprecations = '6.0';
            fs.writeFileSync(tsconfigPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
            result = runTsc();
          }
        } catch { /* if tsconfig parse fails, leave it alone */ }
      }
      if (result.status !== 0) {
        const retryOutput = (result.stdout ?? '') + (result.stderr ?? '');
        const targetBase = path.basename(filePath);
        const filteredLines = retryOutput.split('\n').filter(l => {
          if (!/error TS/.test(l) || /error TS5\d{3}/.test(l)) return false;
          if (!l.includes(targetBase)) return false;
          if (modifiedLines && modifiedLines.length > 0) {
            const lineMatch = l.match(/\((\d+),\d+\)/);
            if (lineMatch) {
              const errLine = parseInt(lineMatch[1], 10);
              if (!modifiedLines.includes(errLine)) {
                return false; // pre-existing error on untouched line
              }
            }
          }
          return true;
        });
        const firstFiltered = filteredLines.find(l => /error TS/.test(l) && !/error TS5\d{3}/.test(l));
        if (firstFiltered) return firstFiltered;
      }
    }
    return null;
  }

  if (ext === '.js' || ext === '.mjs' || ext === '.cjs' || ext === '.ts' || ext === '.tsx') {
    const result = spawnSync(process.execPath, ['--check', filePath], {
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

function checkWriteWithoutRead(targetPath: string, context: ToolContext): string | null {
  if (!context.sessionReadCache) return null;
  if (!fs.existsSync(targetPath)) return null;
  const readMtime = context.sessionReadCache.get(targetPath);
  if (readMtime === undefined) {
    // Auto-read: populate cache so the write/patch proceeds without requiring a separate read_file
    context.sessionReadCache.set(targetPath, fs.statSync(targetPath).mtimeMs);
    return null;
  }
  const currentMtime = fs.statSync(targetPath).mtimeMs;
  if (currentMtime > readMtime + 500) {
    return `[STALE READ] ${path.basename(targetPath)} was modified after you last read it. Use read_file to get the current content before patching.`;
  }
  return null;
}

function checkCircuitBreaker(targetPath: string, context: ToolContext): string | null {
  if (!context.patchFailureStreak) return null;
  const streak = context.patchFailureStreak.get(targetPath) ?? 0;
  if (streak >= 2) {
    return `[CIRCUIT BREAKER] patch failed ${streak} consecutive times on ${path.basename(targetPath)}. Use read_file to inspect the current state and reconstruct your patch from the actual content.`;
  }
  return null;
}

function recordWriteSuccess(targetPath: string, context: ToolContext): void {
  context.patchFailureStreak?.set(targetPath, 0);
  if (context.sessionReadCache && fs.existsSync(targetPath)) {
    context.sessionReadCache.set(targetPath, fs.statSync(targetPath).mtimeMs);
  }
}

function recordPatchFailure(targetPath: string, context: ToolContext): void {
  const streak = context.patchFailureStreak?.get(targetPath) ?? 0;
  context.patchFailureStreak?.set(targetPath, streak + 1);
}

function validateImports(filePath: string, projectRoot: string): string[] {
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

function validateExports(filePath: string): string[] {
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

async function runColocatedTests(filePath: string, projectRoot: string): Promise<string | null> {
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

function checkPackageJsonAntiPatterns(filePath: string, projectRoot: string): string[] {
  if (!filePath.endsWith('package.json')) return [];
  try {
    const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const warnings: string[] = [];
    const pkgName = pkg.name || '';
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

    // Deprecated `vscode` package (not @types/vscode)
    if (allDeps['vscode']) {
      warnings.push('Deprecated `vscode` npm package found in dependencies. Use only `@types/vscode` for type definitions.');
    }

    // Circular self-dependency
    if (allDeps[pkgName]) {
      warnings.push(`Circular dependency: package "${pkgName}" depends on itself. Remove "${pkgName}" from dependencies.`);
    }
    if (allDeps['daedalus-cli'] && !pkgName?.includes('daedalus-cli')) {
      warnings.push('Project should not depend on "daedalus-cli" — the CLI is spawned externally, not imported as a library.');
    }

    // Mismatched @types/vscode vs engines.vscode
    const vsCodeTypes = pkg.devDependencies?.['@types/vscode'];
    const vsCodeEngine = pkg.engines?.vscode;
    if (vsCodeTypes && vsCodeEngine && vsCodeTypes.replace(/^\^|\~/, '') !== vsCodeEngine.replace(/^\^|\~/, '')) {
      warnings.push(`@types/vscode version (${vsCodeTypes}) should match engines.vscode (${vsCodeEngine}) exactly.`);
    }

    return warnings;
  } catch { return []; }
}

function buildPostWriteWarnings(filePath: string, projectRoot: string): string[] {
  const importWarnings = validateImports(filePath, projectRoot);
  const exportWarnings = validateExports(filePath);
  const antiPatterns = checkPackageJsonAntiPatterns(filePath, projectRoot);
  return [...importWarnings, ...exportWarnings, ...antiPatterns];
}

function resolvePath(p: string, projectRoot: string): string {
  const resolved = path.isAbsolute(p) ? p : path.resolve(projectRoot, p);
  // Allow explicit absolute paths to existing locations (cross-project access)
  if (path.isAbsolute(p) && fs.existsSync(resolved)) return resolved;
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path traversal blocked: ${p} is outside the project directory`);
  }
  // Block direct access to .git/ internals
  const gitGuard = guardGitPath(resolved);
  if (gitGuard) throw new Error(gitGuard);
  return resolved;
}

function formatError(error: string, toolCallId: string = '', name: string = ''): ToolResult {
  return { toolCallId, name, success: false, content: '', error };
}

export async function readFile(args: { path: string; offset?: number; limit?: number }, context: ToolContext): Promise<ToolResult> {
  try {
    const targetPath = resolvePath(args.path, context.projectRoot);
    const offset = args.offset ?? 1;
    const limit = args.limit ?? 1000;

    if (!fs.existsSync(targetPath)) {
      return formatError(`File not found: ${args.path}`);
    }

    const content = fs.readFileSync(targetPath, 'utf8');
    const lines = content.split('\n');
    const totalLines = lines.length;
    const start = Math.max(0, offset - 1);
    const end = Math.min(totalLines, start + limit);
    const selected = lines.slice(start, end);

    if (context.sessionReadCache) {
      context.sessionReadCache.set(targetPath, fs.statSync(targetPath).mtimeMs);
    }
    if (context.patchFailureStreak) {
      context.patchFailureStreak.set(targetPath, 0);
    }

    let output = '';
    for (let i = 0; i < selected.length; i++) {
      output += `${start + i + 1}|${selected[i]}\n`;
    }
    if (end < totalLines) {
      output += `... [${totalLines - end} more lines]`;
    }

    return { toolCallId: '', name: 'read_file', success: true, content: output };
  } catch (err: any) {
    return formatError(`Failed to read file: ${err.message}`);
  }
}

export function detectPlaceholders(text: string): boolean {
  if (!text) return false;
  const lines = text.split('\n');
  const placeholderPatterns = [
    /^\s*(\/\/|#|\/\*)\s*\.\.\./i,
    /^\s*\.\.\.\s*$/,
    /^\s*(\/\/|#)\s*(rest of the|same as|existing|todo: rest)/i,
    /^\s*\/\*\s*(rest of the|same as|existing|todo: rest).*?\*\//i,
  ];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const pattern of placeholderPatterns) {
      if (pattern.test(trimmed)) {
        return true;
      }
    }
  }
  return false;
}

export async function writeFile(args: { path: string; content: string }, context: ToolContext): Promise<ToolResult> {
  try {
    if (detectPlaceholders(args.content)) {
      return formatError(`Code placeholders like '// ...' or '/* ... */' detected. You must write the complete, non-abbreviated code.`);
    }
    const targetPath = resolvePath(args.path, context.projectRoot);

    const readGuard = checkWriteWithoutRead(targetPath, context);
    if (readGuard) return formatError(readGuard);

    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const previousContent = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : null;
    const changedLines = previousContent ? computeChangedLines(previousContent, args.content) : [];
    fs.writeFileSync(targetPath, args.content, 'utf8');

    const syntaxError = await syntaxCheck(targetPath, context.projectRoot, changedLines.length > 0 ? changedLines : undefined);
    if (syntaxError) {
      if (previousContent !== null) {
        fs.writeFileSync(targetPath, previousContent, 'utf8');
      } else {
        fs.unlinkSync(targetPath);
      }
      return formatError(`Syntax error in ${args.path} — file reverted.\n${syntaxError}\nFix the error and retry.`);
    }

    if (context.patchHistory) {
      context.patchHistory.push({
        filePath: targetPath,
        oldContent: previousContent || '',
        newContent: args.content,
        timestamp: Date.now(),
        description: `Created new file: ${args.path}`,
      });
    }

    const postWarnings = buildPostWriteWarnings(targetPath, context.projectRoot);
    const testFailure = await runColocatedTests(targetPath, context.projectRoot);
    const notices: string[] = [];
    if (postWarnings.length > 0) notices.push(`Warnings:\n${postWarnings.map(w => `  • ${w}`).join('\n')}`);
    if (testFailure) notices.push(testFailure);

    recordWriteSuccess(targetPath, context);

    const suffix = notices.length > 0 ? `\n\n${notices.join('\n\n')}` : '';
    return { toolCallId: '', name: 'write_file', success: true, content: `Written ${args.content.length} chars to ${args.path}${suffix}` };
  } catch (err: any) {
    return formatError(`Failed to write file: ${err.message}`);
  }
}

export async function patchFile(args: { path: string; old_string: string; new_string: string; replace_all?: boolean }, context: ToolContext): Promise<ToolResult> {
  try {
    if (!args.path) {
      return formatError("Missing required parameter: path");
    }
    if (args.old_string === undefined || args.old_string === null) {
      return formatError("Missing required parameter: old_string");
    }
    if (args.new_string === undefined || args.new_string === null) {
      return formatError("Missing required parameter: new_string");
    }
    if (detectPlaceholders(args.new_string) && !detectPlaceholders(args.old_string)) {
      return formatError(`Code placeholders like '// ...' or '/* ... */' detected in new_string. You must write the complete, fully realized code. Do NOT abbreviate code.`);
    }
    const targetPath = resolvePath(args.path, context.projectRoot);
    if (!fs.existsSync(targetPath)) {
      return formatError(`File not found: ${args.path}. Check the spelling and file extension, or run search_files / list_files to verify the correct path.`);
    }

    const circuitBreaker = checkCircuitBreaker(targetPath, context);
    if (circuitBreaker) return formatError(circuitBreaker);

    const readGuard = checkWriteWithoutRead(targetPath, context);
    if (readGuard) return formatError(readGuard);

    const rawContent = fs.readFileSync(targetPath, 'utf8');
    const hasCRLF = rawContent.includes('\r\n');
    const content = hasCRLF ? rawContent.replace(/\r\n/g, '\n') : rawContent;

    const oldStr = args.old_string.replace(/\r\n/g, '\n');
    const newStr = (args.new_string ?? '').replace(/\r\n/g, '\n');
    const replaceAll = args.replace_all ?? false;

    let patched: string;
    if (replaceAll) {
      if (!content.includes(oldStr)) {
        const fuzzy = fuzzyWhitespacePatch(content, oldStr, newStr, true);
        if (fuzzy.error && fuzzy.error !== 'no_fuzzy_match') { recordPatchFailure(targetPath, context); return formatError(fuzzy.error); }
        if (!fuzzy.patched) { recordPatchFailure(targetPath, context); return formatError(`Old string not found in file (checked with CRLF normalization and fuzzy whitespace matching).\nTo fix this: call read_file on ${args.path} to fetch the latest text and indentation.`); }
        patched = fuzzy.patched;
      } else {
        patched = content.split(oldStr).join(newStr);
      }
    } else {
      const idx = content.indexOf(oldStr);
      if (idx === -1) {
        const fuzzy = fuzzyWhitespacePatch(content, oldStr, newStr, false);
        if (fuzzy.error && fuzzy.error !== 'no_fuzzy_match') return formatError(fuzzy.error);
        if (fuzzy.patched) {
          patched = fuzzy.patched;
        } else {
          recordPatchFailure(targetPath, context);
          const hint = findClosestBlock(content, oldStr);
          const hintMsg = hint
            ? `\n\nClosest match found at line ${hint.lineNo}:\n${'─'.repeat(40)}\n${hint.snippet}\n${'─'.repeat(40)}\nRe-read the file and retry the patch with the exact content above.`
            : `\n\nNo close match found. Use read_file to verify the exact content before patching.`;
          return formatError(`Old string not found in ${args.path}.\nTo fix this: call read_file on ${args.path} to fetch the latest text and indentation.${hintMsg}`);
        }
      } else {
        const secondIdx = content.indexOf(oldStr, idx + oldStr.length);
        if (secondIdx !== -1) {
          return formatError(`Old string matches multiple locations. Add more surrounding lines (e.g. function declaration, imports) to make old_string unique, or use replace_all: true.`);
        }
        patched = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
      }
    }

    const finalNormalized = hasCRLF ? patched.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') : patched;

    const autoApply = context.autoApplyEdits ?? 'prompt';

    if (autoApply === 'skip') {
      return {
        toolCallId: '',
        name: 'patch',
        success: true,
        content: `PATCH_AUTO_SKIPPED: ${args.path} — dry-run mode active. Change NOT written.`,
      };
    }

    if (autoApply === 'all') {
      const changedLines = computeChangedLines(content, finalNormalized);
      fs.writeFileSync(targetPath, finalNormalized, 'utf8');
      const syntaxError = await syntaxCheck(targetPath, context.projectRoot, changedLines.length > 0 ? changedLines : undefined);
      if (syntaxError) {
        fs.writeFileSync(targetPath, rawContent, 'utf8');
        return formatError(`Syntax error introduced by patch — reverted.\n${syntaxError}\nAnalyze the TypeScript/JavaScript compiler error above, check your brackets, semicolons, import declarations, and type definitions, and retry with a corrected patch.`);
      }
      if (context.patchHistory) {
        context.patchHistory.push({
          filePath: targetPath,
          oldContent: content,
          newContent: finalNormalized,
          timestamp: Date.now(),
          description: args.old_string.split('\n')[0].slice(0, 60),
        });
      }
      const postWarningsA = buildPostWriteWarnings(targetPath, context.projectRoot);
      const testFailureA = await runColocatedTests(targetPath, context.projectRoot);
      recordWriteSuccess(targetPath, context);
      const noticesA: string[] = [];
      if (postWarningsA.length > 0) noticesA.push(`Warnings:\n${postWarningsA.map(w => `  • ${w}`).join('\n')}`);
      if (testFailureA) noticesA.push(testFailureA);
      const suffixA = noticesA.length > 0 ? `\n\n${noticesA.join('\n\n')}` : '';
      return { toolCallId: '', name: 'patch', success: true, content: `Patched ${args.path}${hasCRLF ? ' (CRLF preserved)' : ''}${suffixA}` };
    }

    // Show interactive diff via diff-ui
    const diffOpts: DiffOptions = {
      filePath: args.path,
      oldContent: content,
      newContent: finalNormalized,
      autoApply,
    };

    const diffResult = await runDiffWorkflow(diffOpts, autoApply, context);

    if (diffResult.decision === 'no' || diffResult.decision === 'skip') {
      return {
        toolCallId: '',
        name: 'patch',
        success: false,
        content: '',
        error: `PATCH_DECLINED: User chose not to apply changes to ${args.path}. Do NOT retry the same patch.`,
      };
    }

    const writeContent = diffResult.editedContent
      ? (hasCRLF ? diffResult.editedContent.replace(/\n/g, '\r\n') : diffResult.editedContent)
      : finalNormalized;

    fs.writeFileSync(targetPath, writeContent, 'utf8');

    const changedLinesInteractive = computeChangedLines(content, writeContent);
    const syntaxError = await syntaxCheck(targetPath, context.projectRoot, changedLinesInteractive.length > 0 ? changedLinesInteractive : undefined);
    if (syntaxError) {
      fs.writeFileSync(targetPath, rawContent, 'utf8');
      return formatError(`Syntax error introduced by patch — reverted.\n${syntaxError}\nAnalyze the TypeScript/JavaScript compiler error above, check your brackets, semicolons, import declarations, and type definitions, and retry with a corrected patch.`);
    }

    if (diffResult.decision === 'all') {
      context.autoApplyEdits = 'all';
    }

    if (context.patchHistory) {
      context.patchHistory.push({
        filePath: targetPath,
        oldContent: content,
        newContent: writeContent,
        timestamp: Date.now(),
        description: args.old_string.split('\n')[0].slice(0, 60),
      });
    }

    const postWarningsB = buildPostWriteWarnings(targetPath, context.projectRoot);
    const testFailureB = await runColocatedTests(targetPath, context.projectRoot);
    recordWriteSuccess(targetPath, context);
    const noticesB: string[] = [];
    if (postWarningsB.length > 0) noticesB.push(`Warnings:\n${postWarningsB.map(w => `  • ${w}`).join('\n')}`);
    if (testFailureB) noticesB.push(testFailureB);
    const suffixB = noticesB.length > 0 ? `\n\n${noticesB.join('\n\n')}` : '';
    return { toolCallId: '', name: 'patch', success: true, content: `Patched ${args.path}${hasCRLF ? ' (CRLF preserved)' : ''}${suffixB}` };
  } catch (err: any) {
    return formatError(`Failed to patch file: ${err.message}`);
  }
}

function rgAvailable(): boolean {
  try { execSync('rg --version', { stdio: 'ignore' }); return true; } catch { return false; }
}

function nativeGrep(dir: string, pattern: string, fileGlob?: string, limit = 50): string[] {
  const regex = new RegExp(pattern, 'i');
  const results: string[] = [];
  const walk = (d: string, depth = 0) => {
    if (depth > 8 || results.length >= limit) return;
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        if (results.length >= limit) break;
        const full = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === '.' || e.name === '..') continue;
          if (DEFAULT_EXCLUDE_DIRS.includes(e.name)) continue;
          walk(full, depth + 1);
        }
        else if (e.isFile()) {
          if (fileGlob && !e.name.endsWith(fileGlob.replace('*', ''))) continue;
          try {
            const content = fs.readFileSync(full, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) results.push(`${full}:${i + 1}:${lines[i].trim().slice(0, 200)}`);
            }
          } catch { /* ignored */ }
        }
      }
    } catch { /* ignored */ }
  };
  walk(dir);
  return results.slice(0, limit);
}

export async function searchFiles(args: { pattern: string; target?: 'content' | 'files'; path?: string; file_glob?: string; limit?: number }, context: ToolContext): Promise<ToolResult> {
  try {
    const searchPath = args.path ? resolvePath(args.path, context.projectRoot) : context.projectRoot;
    const target = args.target ?? 'content';
    const limit = args.limit ?? 50;

    if (target === 'files') {
      // File name search — use walkDir (native)
      const files = walkDir(searchPath, searchPath, 8, args.pattern);
      const content = files.slice(0, limit).sort().join('\n');
      return { toolCallId: '', name: 'search_files', success: true, content: content || '(no matches)' };
    }

    // Content search — try ripgrep first, fall back to native
    if (rgAvailable()) {
      const rgArgs = ['--no-heading', '--line-number', '--color=never'];
      rgArgs.push(args.pattern);
      if (args.file_glob) {
        rgArgs.push('--glob', args.file_glob);
      }
      rgArgs.push(searchPath);

      return new Promise((resolve) => {
        const child = spawn('rg', rgArgs, { cwd: context.projectRoot, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
        child.stderr?.on('data', () => { /* stderr implicitly collected */ });

        const killTimer = setTimeout(() => {
          child.kill('SIGTERM');
          resolve({ toolCallId: '', name: 'search_files', success: true, content: output.slice(0, 50000) || '(no matches)' });
        }, 30000);

        child.on('close', () => {
          clearTimeout(killTimer);
          const lines = output.split('\n').filter(l => l).slice(0, limit);
          resolve({ toolCallId: '', name: 'search_files', success: true, content: lines.length > 0 ? lines.join('\n') : '(no matches)' });
        });

        child.on('error', (err) => {
          clearTimeout(killTimer);
          resolve({ toolCallId: '', name: 'search_files', success: false, content: '', error: `rg failed: ${err.message}` });
        });
      });
    }

    // Native fallback
    const matches = nativeGrep(searchPath, args.pattern, args.file_glob, limit);
    return { toolCallId: '', name: 'search_files', success: true, content: matches.length > 0 ? matches.join('\n') : '(no matches)' };
  } catch (err: any) {
    return formatError(`Search failed: ${err.message}`);
  }
}

function globToRegex(pattern: string): string {
  let regex = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      regex += '.*';
      i += 2;
      if (pattern[i] === '/' || pattern[i] === '\\') {
        regex += '[/\\\\]';
        i++;
      }
    } else if (ch === '*' ) {
      regex += '[^/\\\\]*';
      i++;
    } else if (ch === '?') {
      regex += '[^/\\\\]';
      i++;
    } else if (ch === '.') {
      regex += '\\.';
      i++;
    } else if (ch === '{') {
      const end = pattern.indexOf('}', i);
      if (end === -1) {
        regex += '\\{';
        i++;
      } else {
        const inner = pattern.slice(i + 1, end);
        const parts = inner.split(',');
        regex += '(' + parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')';
        i = end + 1;
      }
    } else {
      regex += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return regex;
}

function matchesGlob(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const regexStr = globToRegex(pattern);
  return new RegExp(`^${regexStr}$`).test(normalized);
}

function walkDir(dir: string, baseDir: string, maxDepth: number, pattern?: string, _currentDepth = 0): string[] {
  if (_currentDepth > maxDepth) return [];
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.' || entry.name === '..') continue;
        if (DEFAULT_EXCLUDE_DIRS.includes(entry.name)) continue;
        results.push(...walkDir(fullPath, baseDir, maxDepth, pattern, _currentDepth + 1));
      } else if (entry.isFile()) {
        if (!pattern || matchesGlob(path.relative(baseDir, fullPath), pattern)) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // skip unreadable
  }
  return results;
}

export async function listFiles(args: { path?: string; depth?: number; glob?: string; limit?: number }, context: ToolContext): Promise<ToolResult> {
  try {
    const targetPath = args.path ? resolvePath(args.path, context.projectRoot) : context.projectRoot;
    const depth = args.depth ?? 3;
    const glob = args.glob;
    const limit = args.limit ?? 500;

    const files = walkDir(targetPath, targetPath, depth, glob);
    files.sort();

    const totalCount = files.length;
    let content = '';
    if (totalCount > limit) {
      content = files.slice(0, limit).join('\n') + `\n... [truncated, ${totalCount - limit} more files found. Use search_files or list_files with a specific subpath or glob to see more]`;
    } else if (totalCount > 0) {
      content = files.join('\n');
    } else {
      content = '(empty)';
    }

    return { toolCallId: '', name: 'list_files', success: true, content };
  } catch (err: any) {
    return formatError(`List files failed: ${err.message}`);
  }
}