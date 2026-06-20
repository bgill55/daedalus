import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import {
  initIndexDb,
  clearFileIndex,
  saveFileHash,
  getFileHash,
  insertSymbols,
  insertReferences,
  SymbolRow,
  ReferenceRow
} from './fts.js';

interface IndexerOptions {
  exclude?: string[];
  extensions?: string[];
  onProgress?: (progress: { current: number; total: number; file: string }) => void;
}

const DEFAULT_EXCLUDE = ['node_modules', 'dist', 'build', '.git', 'target', 'coverage'];
const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'];

/** Compute SHA256 of string content */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Crawl directory recursively and collect code files */
export function collectFiles(
  dir: string,
  root: string,
  exclude: Set<string>,
  extensions: Set<string>,
  fileList: string[] = []
): string[] {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const relPath = path.relative(root, fullPath);
    
    // Ignore excluded dirs
    if (exclude.has(file) || exclude.has(relPath)) {
      continue;
    }

    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        collectFiles(fullPath, root, exclude, extensions, fileList);
      } else if (stat.isFile()) {
        const ext = path.extname(file).toLowerCase();
        if (extensions.has(ext)) {
          fileList.push(fullPath);
        }
      }
    } catch {
      // Ignored (unreadable files/dirs)
    }
  }

  return fileList;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/** Extract symbols and references from TypeScript/JavaScript file */
export function parseTypeScript(content: string, relPath: string, projectHash: string): { symbols: SymbolRow[]; references: ReferenceRow[] } {
  const symbols: SymbolRow[] = [];
  const references: ReferenceRow[] = [];
  const lines = content.split(/\r?\n/);
  
  let currentCaller: string | null = null;
  let callerStartLine = 0;
  let callerBraceCount = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    
    // Track braces to see when a function body ends
    if (currentCaller) {
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;
      callerBraceCount += openBraces - closeBraces;
      
      if (callerBraceCount <= 0) {
        // Find the index of the symbol and update line_end
        const sym = symbols.find(s => s.name === currentCaller && s.file_path === relPath && s.line_start === callerStartLine);
        if (sym) sym.line_end = lineNum;
        currentCaller = null;
      }
    }

    // Class definition
    let match = line.match(/(?:export\s+)?(?:default\s+)?class\s+(\w+)/);
    if (match) {
      symbols.push({
        name: match[1],
        kind: 'class',
        file_path: relPath,
        line_start: lineNum,
        line_end: lineNum,
        signature: line.trim().replace(/\s*\{.*$/, ''),
        project_hash: projectHash,
      });
      continue;
    }

    // Interface definition
    match = line.match(/(?:export\s+)?interface\s+(\w+)/);
    if (match) {
      symbols.push({
        name: match[1],
        kind: 'interface',
        file_path: relPath,
        line_start: lineNum,
        line_end: lineNum,
        signature: line.trim().replace(/\s*\{.*$/, ''),
        project_hash: projectHash,
      });
      continue;
    }

    // Type definition
    match = line.match(/(?:export\s+)?type\s+(\w+)\s*=/);
    if (match) {
      symbols.push({
        name: match[1],
        kind: 'type',
        file_path: relPath,
        line_start: lineNum,
        line_end: lineNum,
        signature: line.trim().replace(/\s*=.*$/, ''),
        project_hash: projectHash,
      });
      continue;
    }

    // Normal Function definition
    match = line.match(/(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*\(/);
    if (match) {
      const funcName = match[1];
      symbols.push({
        name: funcName,
        kind: 'function',
        file_path: relPath,
        line_start: lineNum,
        line_end: lineNum,
        signature: line.trim().replace(/\s*\{.*$/, ''),
        project_hash: projectHash,
      });
      currentCaller = funcName;
      callerStartLine = lineNum;
      callerBraceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      continue;
    }

    // Arrow Function / Variable assignment function definition
    match = line.match(/(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*[^=]+)?\s*=>/);
    if (match) {
      const funcName = match[1];
      symbols.push({
        name: funcName,
        kind: 'function',
        file_path: relPath,
        line_start: lineNum,
        line_end: lineNum,
        signature: line.trim().replace(/\s*=>.*$/, ''),
        project_hash: projectHash,
      });
      currentCaller = funcName;
      callerStartLine = lineNum;
      callerBraceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      continue;
    }

    // Extract references (calls)
    if (currentCaller) {
      // Find patterns like calleeName(arguments)
      const callMatches = line.matchAll(/\b([a-zA-Z0-9_$]+)\s*\(/g);
      for (const m of callMatches) {
        const callee = m[1];
        // Ignore language control structures
        const reserved = ['if', 'for', 'while', 'catch', 'switch', 'require', 'super', 'import', 'expect', 'describe', 'it', 'beforeEach', 'afterEach'];
        if (!reserved.includes(callee) && callee !== currentCaller) {
          references.push({
            caller_name: currentCaller,
            caller_file: relPath,
            caller_line: lineNum,
            callee_name: callee,
            callee_file: relPath,
            callee_line: lineNum,
            project_hash: projectHash,
          });
        }
      }
    }
  }

  return { symbols, references };
}

/** Extract symbols and references from Python file */
export function parsePython(content: string, relPath: string, projectHash: string): { symbols: SymbolRow[]; references: ReferenceRow[] } {
  const symbols: SymbolRow[] = [];
  const references: ReferenceRow[] = [];
  const lines = content.split(/\r?\n/);

  let currentCaller: string | null = null;
  let callerStartLine = 0;
  let callerIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    if (line.trim().startsWith('#') || !line.trim()) continue;

    const indent = line.length - line.trimStart().length;

    // Track indentation to see when a function body ends
    if (currentCaller && indent <= callerIndent && line.trim()) {
      const sym = symbols.find(s => s.name === currentCaller && s.file_path === relPath && s.line_start === callerStartLine);
      if (sym) sym.line_end = lineNum - 1;
      currentCaller = null;
      callerIndent = -1;
    }

    // Class definition
    let match = line.match(/^(\s*)class\s+(\w+)/);
    if (match) {
      symbols.push({
        name: match[2],
        kind: 'class',
        file_path: relPath,
        line_start: lineNum,
        line_end: lineNum,
        signature: line.trim().replace(/:.*$/, ''),
        project_hash: projectHash,
      });
      continue;
    }

    // Function definition
    match = line.match(/^(\s*)def\s+(\w+)/);
    if (match) {
      const funcName = match[2];
      symbols.push({
        name: funcName,
        kind: funcName.startsWith('__') ? 'method' : 'function',
        file_path: relPath,
        line_start: lineNum,
        line_end: lineNum,
        signature: line.trim().replace(/:.*$/, ''),
        project_hash: projectHash,
      });
      currentCaller = funcName;
      callerStartLine = lineNum;
      callerIndent = match[1].length;
      continue;
    }

    // Extract references
    if (currentCaller) {
      const callMatches = line.matchAll(/\b([a-zA-Z0-9_]+)\s*\(/g);
      for (const m of callMatches) {
        const callee = m[1];
        const reserved = ['def', 'class', 'if', 'elif', 'while', 'for', 'print', 'len', 'range', 'enumerate', 'zip', 'str', 'int', 'dict', 'list', 'set', 'super'];
        if (!reserved.includes(callee) && callee !== currentCaller) {
          references.push({
            caller_name: currentCaller,
            caller_file: relPath,
            caller_line: lineNum,
            callee_name: callee,
            callee_file: relPath,
            callee_line: lineNum,
            project_hash: projectHash,
          });
        }
      }
    }
  }

  return { symbols, references };
}

/** Extract symbols and references from Go file */
export function parseGo(content: string, relPath: string, projectHash: string): { symbols: SymbolRow[]; references: ReferenceRow[] } {
  const symbols: SymbolRow[] = [];
  const references: ReferenceRow[] = [];
  const lines = content.split(/\r?\n/);

  let currentCaller: string | null = null;
  let callerStartLine = 0;
  let callerBraceCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (currentCaller) {
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;
      callerBraceCount += openBraces - closeBraces;
      
      if (callerBraceCount <= 0) {
        const sym = symbols.find(s => s.name === currentCaller && s.file_path === relPath && s.line_start === callerStartLine);
        if (sym) sym.line_end = lineNum;
        currentCaller = null;
      }
    }

    // Struct definition
    let match = line.match(/type\s+(\w+)\s+struct/);
    if (match) {
      symbols.push({
        name: match[1],
        kind: 'struct',
        file_path: relPath,
        line_start: lineNum,
        line_end: lineNum,
        signature: line.trim().replace(/\s*\{.*$/, ''),
        project_hash: projectHash,
      });
      continue;
    }

    // Interface definition
    match = line.match(/type\s+(\w+)\s+interface/);
    if (match) {
      symbols.push({
        name: match[1],
        kind: 'interface',
        file_path: relPath,
        line_start: lineNum,
        line_end: lineNum,
        signature: line.trim().replace(/\s*\{.*$/, ''),
        project_hash: projectHash,
      });
      continue;
    }

    // Method definition: func (r *Receiver) MethodName()
    match = line.match(/func\s*\(\s*\w+\s+\*?(\w+)\s*\)\s*(\w+)\s*\(/);
    if (match) {
      const methodName = `${match[1]}.${match[2]}`;
      symbols.push({
        name: methodName,
        kind: 'method',
        file_path: relPath,
        line_start: lineNum,
        line_end: lineNum,
        signature: line.trim().replace(/\s*\{.*$/, ''),
        project_hash: projectHash,
      });
      currentCaller = methodName;
      callerStartLine = lineNum;
      callerBraceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      continue;
    }

    // Function definition: func FunctionName()
    match = line.match(/func\s+(\w+)\s*\(/);
    if (match) {
      const funcName = match[1];
      symbols.push({
        name: funcName,
        kind: 'function',
        file_path: relPath,
        line_start: lineNum,
        line_end: lineNum,
        signature: line.trim().replace(/\s*\{.*$/, ''),
        project_hash: projectHash,
      });
      currentCaller = funcName;
      callerStartLine = lineNum;
      callerBraceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      continue;
    }

    // Extract references
    if (currentCaller) {
      const callMatches = line.matchAll(/\b([a-zA-Z0-9_]+)\s*\(/g);
      for (const m of callMatches) {
        const callee = m[1];
        const reserved = ['func', 'if', 'for', 'switch', 'panic', 'recover', 'append', 'make', 'new', 'close', 'len', 'cap', 'copy', 'delete'];
        if (!reserved.includes(callee) && callee !== currentCaller) {
          references.push({
            caller_name: currentCaller,
            caller_file: relPath,
            caller_line: lineNum,
            callee_name: callee,
            callee_file: relPath,
            callee_line: lineNum,
            project_hash: projectHash,
          });
        }
      }
    }
  }

  return { symbols, references };
}

/** Extract symbols and references from Rust file */
export function parseRust(content: string, relPath: string, projectHash: string): { symbols: SymbolRow[]; references: ReferenceRow[] } {
  const symbols: SymbolRow[] = [];
  const references: ReferenceRow[] = [];
  const lines = content.split(/\r?\n/);

  let currentCaller: string | null = null;
  let callerStartLine = 0;
  let callerBraceCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (currentCaller) {
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;
      callerBraceCount += openBraces - closeBraces;
      
      if (callerBraceCount <= 0) {
        const sym = symbols.find(s => s.name === currentCaller && s.file_path === relPath && s.line_start === callerStartLine);
        if (sym) sym.line_end = lineNum;
        currentCaller = null;
      }
    }

    // Struct definition
    let match = line.match(/(?:pub\s+)?struct\s+(\w+)/);
    if (match) {
      symbols.push({
        name: match[1],
        kind: 'struct',
        file_path: relPath,
        line_start: lineNum,
        line_end: lineNum,
        signature: line.trim().replace(/\s*\{.*$/, '').replace(/;$/, ''),
        project_hash: projectHash,
      });
      continue;
    }

    // Enum definition
    match = line.match(/(?:pub\s+)?enum\s+(\w+)/);
    if (match) {
      symbols.push({
        name: match[1],
        kind: 'enum',
        file_path: relPath,
        line_start: lineNum,
        line_end: lineNum,
        signature: line.trim().replace(/\s*\{.*$/, ''),
        project_hash: projectHash,
      });
      continue;
    }

    // Trait definition
    match = line.match(/(?:pub\s+)?trait\s+(\w+)/);
    if (match) {
      symbols.push({
        name: match[1],
        kind: 'trait',
        file_path: relPath,
        line_start: lineNum,
        line_end: lineNum,
        signature: line.trim().replace(/\s*\{.*$/, ''),
        project_hash: projectHash,
      });
      continue;
    }

    // Function definition
    match = line.match(/(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
    if (match) {
      const funcName = match[1];
      symbols.push({
        name: funcName,
        kind: 'function',
        file_path: relPath,
        line_start: lineNum,
        line_end: lineNum,
        signature: line.trim().replace(/\s*\{.*$/, '').replace(/;$/, ''),
        project_hash: projectHash,
      });
      currentCaller = funcName;
      callerStartLine = lineNum;
      callerBraceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      continue;
    }

    // Extract references (matches calls or macro invocations)
    if (currentCaller) {
      const callMatches = line.matchAll(/\b([a-zA-Z0-9_]+)!(?:\s*\(|\s*\{)?|\b([a-zA-Z0-9_]+)\s*\(/g);
      for (const m of callMatches) {
        const callee = m[1] || m[2];
        const reserved = ['fn', 'struct', 'enum', 'trait', 'impl', 'if', 'else', 'match', 'for', 'while', 'loop', 'return', 'println', 'format', 'vec', 'panic'];
        if (!reserved.includes(callee) && callee !== currentCaller) {
          references.push({
            caller_name: currentCaller,
            caller_file: relPath,
            caller_line: lineNum,
            callee_name: callee,
            callee_file: relPath,
            callee_line: lineNum,
            project_hash: projectHash,
          });
        }
      }
    }
  }

  return { symbols, references };
}

/** Language parser dispatch */
export function parseFile(content: string, relPath: string, projectHash: string): { symbols: SymbolRow[]; references: ReferenceRow[] } {
  const ext = path.extname(relPath).toLowerCase();
  
  switch (ext) {
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
      return parseTypeScript(content, relPath, projectHash);
    case '.py':
      return parsePython(content, relPath, projectHash);
    case '.go':
      return parseGo(content, relPath, projectHash);
    case '.rs':
      return parseRust(content, relPath, projectHash);
    default:
      return { symbols: [], references: [] };
  }
}

export interface IndexResult {
  totalFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  errors: string[];
}

/** Main indexing function - crawls codebase and indexes symbols/references */
export async function indexCodebase(
  db: Database.Database,
  root: string,
  projectHash: string,
  options: IndexerOptions = {}
): Promise<IndexResult> {
  const exclude = new Set([...DEFAULT_EXCLUDE, ...(options.exclude || [])]);
  const extensions = new Set([...DEFAULT_EXTENSIONS, ...(options.extensions || [])]);

  const files = collectFiles(root, root, exclude, extensions, []);
  
  let indexedFiles = 0;
  let skippedFiles = 0;
  const errors: string[] = [];

  for (const [i, file] of files.entries()) {
    try {
      const relPath = path.relative(root, file);
      options.onProgress?.({ current: i + 1, total: files.length, file: relPath });
      const content = fs.readFileSync(file, 'utf8');
      const hash = hashContent(content);

      // Skip if already indexed with same hash
      const existingHash = getFileHash(db, relPath);
      if (existingHash === hash) {
        skippedFiles++;
        continue;
      }

      // Parse file
      const { symbols, references } = parseFile(content, relPath, projectHash);

      if (symbols.length > 0 || references.length > 0) {
        // Clear old index for this file
        clearFileIndex(db, relPath, projectHash);
        
        // Insert new data
        if (symbols.length > 0) insertSymbols(db, symbols);
        if (references.length > 0) insertReferences(db, references);
        
        // Save hash
        saveFileHash(db, relPath, hash);
      }

      indexedFiles++;
    } catch (err: any) {
      errors.push(`${path.relative(root, file) || file}: ${err.message}`);
    }
    // Yield every file so the event loop stays responsive for keyboard input
    await yieldToEventLoop();
  }

  return {
    totalFiles: files.length,
    indexedFiles,
    skippedFiles,
    errors,
  };
}