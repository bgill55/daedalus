import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
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

export async function syntaxCheck(filePath: string, projectRoot: string, modifiedLines?: number[]): Promise<string | null> {
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
                return false;
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

export function checkCircuitBreaker(targetPath: string, context: ToolContext): string | null {
  if (!context.patchFailureStreak) return null;
  const streak = context.patchFailureStreak.get(targetPath) ?? 0;
  if (streak >= 2) {
    return `[CIRCUIT BREAKER] patch failed ${streak} consecutive times on ${path.basename(targetPath)}. Use read_file to inspect the current state and reconstruct your patch from the actual content.`;
  }
  return null;
}

export function recordWriteSuccess(targetPath: string, context: ToolContext): void {
  context.patchFailureStreak?.set(targetPath, 0);
  if (context.sessionReadCache && fs.existsSync(targetPath)) {
    context.sessionReadCache.set(targetPath, fs.statSync(targetPath).mtimeMs);
  }
}

export function recordRevert(targetPath: string, context: ToolContext): void {
  if (context.sessionReadCache && fs.existsSync(targetPath)) {
    context.sessionReadCache.set(targetPath, fs.statSync(targetPath).mtimeMs);
  }
}

export function recordPatchFailure(targetPath: string, context: ToolContext): void {
  const streak = context.patchFailureStreak?.get(targetPath) ?? 0;
  context.patchFailureStreak?.set(targetPath, streak + 1);
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
