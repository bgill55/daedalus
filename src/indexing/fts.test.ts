import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import {
  initIndexDb,
  clearProjectIndex,
  clearFileIndex,
  saveFileHash,
  getFileHash,
  insertSymbols,
  insertReferences,
  searchSymbols,
  findDefinitions,
  findReferences,
  SymbolRow,
  ReferenceRow,
} from './fts.js';

describe('FTS5 codebase index', () => {
  let db: Database.Database;
  let dbPath: string;
  const projectHash = 'testhash123';

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-fts-test-'));
    dbPath = path.join(dir, 'index.sqlite');
    db = initIndexDb(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it('creates tables on init', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    expect(tables).toContain('file_hashes');
    expect(tables).toContain('symbols');
    expect(tables).toContain('references');
  });

  it('insertSymbols stores and searchSymbols finds them', () => {
    const symbols: SymbolRow[] = [
      { name: 'FooBar', kind: 'function', file_path: 'src/index.ts', line_start: 10, line_end: 20, signature: 'function FooBar()', project_hash: projectHash },
      { name: 'BazQux', kind: 'class', file_path: 'src/types.ts', line_start: 1, line_end: 50, signature: 'class BazQux', project_hash: projectHash },
    ];
    insertSymbols(db, symbols);

    const results = searchSymbols(db, 'Foo', projectHash, 10);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('FooBar');
  });

  it('searchSymbols returns empty for unmatched query', () => {
    const results = searchSymbols(db, 'NonExistentSymbol', projectHash);
    expect(results).toEqual([]);
  });

  it('searchSymbols respects project hash isolation', () => {
    insertSymbols(db, [
      { name: 'FuncA', kind: 'function', file_path: 'a.ts', line_start: 1, line_end: 5, signature: 'FuncA', project_hash: 'hash1' },
      { name: 'FuncB', kind: 'function', file_path: 'b.ts', line_start: 1, line_end: 5, signature: 'FuncB', project_hash: 'hash2' },
    ]);

    expect(searchSymbols(db, 'Func', 'hash1', 10)).toHaveLength(1);
    expect(searchSymbols(db, 'Func', 'hash2', 10)).toHaveLength(1);
  });

  it('findDefinitions returns exact match by name', () => {
    insertSymbols(db, [
      { name: 'MyFunction', kind: 'function', file_path: 'src/main.ts', line_start: 5, line_end: 15, signature: 'MyFunction()', project_hash: projectHash },
    ]);

    const defs = findDefinitions(db, 'MyFunction', projectHash);
    expect(defs).toHaveLength(1);
    expect(defs[0].file_path).toBe('src/main.ts');
  });

  it('findDefinitions returns empty for non-matching name', () => {
    expect(findDefinitions(db, 'NoMatch', projectHash)).toEqual([]);
  });

  it('insertReferences and findReferences round-trip', () => {
    const refs: ReferenceRow[] = [
      { caller_name: 'main', caller_file: 'src/main.ts', caller_line: 10, callee_name: 'helper', callee_file: 'src/helper.ts', callee_line: 5, project_hash: projectHash },
      { caller_name: 'init', caller_file: 'src/init.ts', caller_line: 3, callee_name: 'helper', callee_file: 'src/helper.ts', callee_line: 5, project_hash: projectHash },
    ];
    insertReferences(db, refs);

    const results = findReferences(db, 'helper', projectHash);
    expect(results).toHaveLength(2);
    expect(results[0].caller_name).toBe('main');
  });

  it('findReferences respects project hash', () => {
    insertReferences(db, [
      { caller_name: 'a', caller_file: 'a.ts', caller_line: 1, callee_name: 'fn', callee_file: 'fn.ts', callee_line: 1, project_hash: projectHash },
      { caller_name: 'b', caller_file: 'b.ts', caller_line: 1, callee_name: 'fn', callee_file: 'fn.ts', callee_line: 1, project_hash: 'other' },
    ]);

    expect(findReferences(db, 'fn', projectHash)).toHaveLength(1);
  });

  it('clearProjectIndex removes all data', () => {
    insertSymbols(db, [{ name: 'F', kind: 'function', file_path: 'f.ts', line_start: 1, line_end: 2, signature: 'F', project_hash: projectHash }]);
    insertReferences(db, [{ caller_name: 'a', caller_file: 'a.ts', caller_line: 1, callee_name: 'F', callee_file: 'f.ts', callee_line: 1, project_hash: projectHash }]);

    clearProjectIndex(db, projectHash);
    expect(searchSymbols(db, 'F', projectHash)).toEqual([]);
    expect(findReferences(db, 'F', projectHash)).toEqual([]);
  });

  it('clearFileIndex removes data for a specific file', () => {
    insertSymbols(db, [
      { name: 'F1', kind: 'function', file_path: 'file1.ts', line_start: 1, line_end: 2, signature: '', project_hash: projectHash },
      { name: 'F2', kind: 'function', file_path: 'file2.ts', line_start: 1, line_end: 2, signature: '', project_hash: projectHash },
    ]);

    clearFileIndex(db, 'file1.ts', projectHash);
    expect(searchSymbols(db, 'F1', projectHash)).toEqual([]);
    expect(searchSymbols(db, 'F2', projectHash)).toHaveLength(1);
  });

  it('saveFileHash and getFileHash round-trip', () => {
    saveFileHash(db, 'src/main.ts', 'abc123');
    expect(getFileHash(db, 'src/main.ts')).toBe('abc123');
  });

  it('getFileHash returns null for unknown file', () => {
    expect(getFileHash(db, 'nonexistent.ts')).toBeNull();
  });

  it('saveFileHash overwrites existing hash', () => {
    saveFileHash(db, 'src/main.ts', 'oldhash');
    saveFileHash(db, 'src/main.ts', 'newhash');
    expect(getFileHash(db, 'src/main.ts')).toBe('newhash');
  });

});
