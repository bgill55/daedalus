import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { ToolContext, ToolResult } from '../../types.js';
import { guardGitPath } from '../git-guard.js';
import { runDiffWorkflow, type DiffOptions } from './diff-ui.js';
import {
  findClosestBlock,
  fuzzyWhitespacePatch,
  computeChangedLines,
  syntaxCheck,
  checkWriteWithoutRead,
  checkCircuitBreaker,
  recordWriteSuccess,
  recordRevert,
  recordPatchFailure,
  runColocatedTests,
  buildPostWriteWarnings,
} from './patch-utils.js';

const DEFAULT_EXCLUDE_DIRS = [
  'node_modules', 'dist', 'build', '.git', 'target', 'coverage',
  'venv', '.venv', 'env', '.env', '__pycache__', '.pytest_cache',
  '.mypy_cache', '.next', 'out', '.cache'
];

function resolvePath(p: string, projectRoot: string): string {
  if (!p) {
    throw new Error('Path argument is empty or undefined');
  }

  let normalizedPath = p;
  // Convert /c/path or /d/path (Git Bash / WSL style) to C:/path or D:/path
  if (/^[\/\\]([a-zA-Z])[\/\\]/.test(normalizedPath)) {
    const drive = normalizedPath[1].toUpperCase();
    normalizedPath = `${drive}:/${normalizedPath.substring(3)}`;
  }
  if (process.platform === 'win32') {
    normalizedPath = normalizedPath.replace(/\//g, '\\');
  } else {
    normalizedPath = normalizedPath.replace(/\\/g, '/');
  }

  const resolved = path.isAbsolute(normalizedPath) ? normalizedPath : path.resolve(projectRoot, normalizedPath);
  // Allow explicit absolute paths if the file or its parent directory exists
  if (path.isAbsolute(normalizedPath) && (fs.existsSync(resolved) || fs.existsSync(path.dirname(resolved)))) {
    const gitGuard = guardGitPath(resolved);
    if (gitGuard) throw new Error(gitGuard);
    return resolved;
  }

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

    const ext = path.extname(targetPath).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
      const buffer = fs.readFileSync(targetPath);
      let mimeType = 'image/png';
      if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
      else if (ext === '.gif') mimeType = 'image/gif';
      else if (ext === '.webp') mimeType = 'image/webp';
      else if (ext === '.bmp') mimeType = 'image/bmp';

      const base64 = buffer.toString('base64');
      const response = {
        type: 'vision',
        base64,
        mimeType,
        path: args.path
      };
      return { toolCallId: '', name: 'read_file', success: true, content: JSON.stringify(response) };
    }

    let content = '';
    if (targetPath.toLowerCase().endsWith('.pdf')) {
      const pdfBuffer = fs.readFileSync(targetPath);
      const pdfParseModule = (await import('pdf-parse')) as any;
      const parser = new pdfParseModule.PDFParse({ data: new Uint8Array(pdfBuffer) });
      const parsedData = await parser.getText();
      content = parsedData.text;
    } else {
      content = fs.readFileSync(targetPath, 'utf8');
    }
    const lines = content.replace(/\r/g, '').split('\n');
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
    if (!args.path) {
      return formatError("Missing required parameter: path. You must specify a file path to write to.");
    }
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
    const hasCRLF = previousContent ? previousContent.includes('\r\n') : false;
    const finalContent = hasCRLF ? args.content.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') : args.content;
    const prevNormalized = previousContent ? previousContent.replace(/\r/g, '') : null;
    const newNormalized = args.content.replace(/\r/g, '');
    const changedLines = prevNormalized ? computeChangedLines(prevNormalized, newNormalized) : [];
    fs.writeFileSync(targetPath, finalContent, 'utf8');

    const syntaxError = await syntaxCheck(targetPath, context.projectRoot, changedLines.length > 0 ? changedLines : undefined);
    if (syntaxError) {
      if (previousContent !== null) {
        fs.writeFileSync(targetPath, previousContent, 'utf8');
        recordRevert(targetPath, context);
      } else {
        fs.unlinkSync(targetPath);
        context.sessionReadCache?.delete(targetPath);
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
    const content = rawContent.replace(/\r/g, '');

    const oldStr = args.old_string.replace(/\r/g, '');
    const newStr = (args.new_string ?? '').replace(/\r/g, '');
    const replaceAll = args.replace_all ?? false;

    if (replaceAll && /^\w+$/.test(oldStr) && oldStr.length <= 4) {
      const escaped = oldStr.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`(\\w|-)${escaped}|${escaped}(\\w|-)`, 'g');
      if (regex.test(content)) {
        return formatError(`Safety block: replace_all on a short string ('${args.old_string}') was blocked because it would destructively modify larger words or hyphenated names (like in '${content.match(regex)?.[0] || ''}'). Please provide more surrounding lines/context in old_string to make the patch unique.`);
      }
    }

    let patched: string;
    if (replaceAll) {
      if (!content.includes(oldStr)) {
        const fuzzy = fuzzyWhitespacePatch(content, oldStr, newStr, true);
        if (fuzzy.error && fuzzy.error !== 'no_fuzzy_match') { recordPatchFailure(targetPath, context); return formatError(fuzzy.error); }
        if (!fuzzy.patched) {
          recordPatchFailure(targetPath, context);
          const lines = content.split('\n');
          const showLines = lines.slice(0, 100).map((line, index) => `${index + 1}: ${line}`).join('\n');
          const suffix = lines.length > 100 ? `\n... (showing first 100 lines of ${lines.length} total)` : '';
          return formatError(`Old string not found in file (checked with CRLF normalization and fuzzy whitespace matching).\nTo fix this: call read_file on ${args.path} to fetch the latest text and indentation.\n\nHere is the current content of the file (with line numbers) to help you construct the correct old_string:\n${'─'.repeat(40)}\n${showLines}${suffix}\n${'─'.repeat(40)}\nModify your old_string to match the exact lines above.`);
        }
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
          let hintMsg = '';
          if (hint) {
            hintMsg = `\n\nClosest match found at line ${hint.lineNo}:\n${'─'.repeat(40)}\n${hint.snippet}\n${'─'.repeat(40)}\nRe-read the file and retry the patch with the exact content above.`;
          } else {
            const lines = content.split('\n');
            const showLines = lines.slice(0, 100).map((line, index) => `${index + 1}: ${line}`).join('\n');
            const suffix = lines.length > 100 ? `\n... (showing first 100 lines of ${lines.length} total)` : '';
            hintMsg = `\n\nNo close match found. Here is the current content of the file (with line numbers) to help you construct the correct old_string:\n${'─'.repeat(40)}\n${showLines}${suffix}\n${'─'.repeat(40)}\nModify your old_string to match the exact lines above.`;
          }
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

    const finalNormalized = hasCRLF ? patched.replace(/\n/g, '\r\n') : patched;

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
        recordRevert(targetPath, context);
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
      recordRevert(targetPath, context);
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