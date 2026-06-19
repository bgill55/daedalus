// File operation tools

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import { ToolContext, ToolResult } from '../../types.js';
import { runDiffWorkflow, DiffOptions } from './diff-ui.js';

/** Ask the user a yes/no/all/skip question — writes to stdout, reads one line from stdin. */
function askUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      // Handle backspace, enter, etc. — just take the first line
      const line = text.replace(/\r?\n/g, '').trim().toLowerCase();
      if (line) {
        process.stdin.off('data', onData);
        resolve(line);
      }
    };
    process.stdin.on('data', onData);
    // Resume stdin if paused (e.g. after spinner stopped)
    if (process.stdin.isPaused()) process.stdin.resume();
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePath(p: string, projectRoot: string): string {
  const resolved = path.isAbsolute(p) ? p : path.resolve(projectRoot, p);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path traversal blocked: ${p} is outside the project directory`);
  }
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

export async function writeFile(args: { path: string; content: string }, context: ToolContext): Promise<ToolResult> {
  try {
    const targetPath = resolvePath(args.path, context.projectRoot);
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(targetPath, args.content, 'utf8');
    return { toolCallId: '', name: 'write_file', success: true, content: `Written ${args.content.length} chars to ${args.path}` };
  } catch (err: any) {
    return formatError(`Failed to write file: ${err.message}`);
  }
}

export async function patchFile(args: { path: string; old_string: string; new_string: string; replace_all?: boolean }, context: ToolContext): Promise<ToolResult> {
  try {
    const targetPath = resolvePath(args.path, context.projectRoot);
    if (!fs.existsSync(targetPath)) {
      return formatError(`File not found: ${args.path}`);
    }

    const rawContent = fs.readFileSync(targetPath, 'utf8');
    const hasCRLF = rawContent.includes('\r\n');
    const content = hasCRLF ? rawContent.replace(/\r\n/g, '\n') : rawContent;

    const oldStr = args.old_string.replace(/\r\n/g, '\n');
    const newStr = (args.new_string ?? '').replace(/\r\n/g, '\n');
    const replaceAll = args.replace_all ?? false;

    let patched: string;
    if (replaceAll) {
      if (!content.includes(oldStr)) {
        return formatError(`Old string not found in file (checked with CRLF normalization)`);
      }
      patched = content.split(oldStr).join(newStr);
    } else {
      const idx = content.indexOf(oldStr);
      if (idx === -1) {
        const fileLines = content.split('\n').length;
        return formatError(
          `Old string not found in ${args.path} (${fileLines} lines, CRLF normalized). ` +
          `Tip: use read_file to verify exact whitespace/indentation before patching.`
        );
      }
      const secondIdx = content.indexOf(oldStr, idx + oldStr.length);
      if (secondIdx !== -1) {
        return formatError(`Old string matches multiple locations; use replace_all: true or add more surrounding context`);
      }
      patched = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
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
      fs.writeFileSync(targetPath, finalNormalized, 'utf8');
      if (context.patchHistory) {
        context.patchHistory.push({
          filePath: targetPath,
          oldContent: content,
          newContent: finalNormalized,
          timestamp: Date.now(),
          description: args.old_string.split('\n')[0].slice(0, 60),
        });
      }
      return { toolCallId: '', name: 'patch', success: true, content: `Patched ${args.path}${hasCRLF ? ' (CRLF preserved)' : ''}` };
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

    return { toolCallId: '', name: 'patch', success: true, content: `Patched ${args.path}${hasCRLF ? ' (CRLF preserved)' : ''}` };
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
        if (e.isDirectory()) { if (e.name !== '.' && e.name !== '..' && e.name !== 'node_modules' && e.name !== '.git') walk(full, depth + 1); }
        else if (e.isFile()) {
          if (fileGlob && !e.name.endsWith(fileGlob.replace('*', ''))) continue;
          try {
            const content = fs.readFileSync(full, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) results.push(`${full}:${i + 1}:${lines[i].trim().slice(0, 200)}`);
            }
          } catch {}
        }
      }
    } catch {}
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
        let errorOutput = '';

        child.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
        child.stderr?.on('data', (data: Buffer) => { errorOutput += data.toString(); });

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

export async function listFiles(args: { path?: string; depth?: number; glob?: string }, context: ToolContext): Promise<ToolResult> {
  try {
    const targetPath = args.path ? resolvePath(args.path, context.projectRoot) : context.projectRoot;
    const depth = args.depth ?? 3;
    const glob = args.glob;

    const files = walkDir(targetPath, targetPath, depth, glob);
    const content = files.length > 0
      ? files.sort().join('\n')
      : '(empty)';

    return { toolCallId: '', name: 'list_files', success: true, content };
  } catch (err: any) {
    return formatError(`List files failed: ${err.message}`);
  }
}