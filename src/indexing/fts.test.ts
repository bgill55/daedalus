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
  findCallees,
  getCallGraph,
  getImpactAnalysis,
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

  it('migrates legacy user_version 0 database: drops stale tables, recreates file_hashes and trigram tables, sets user_version 1', () => {
    db.close();
    // Simulate legacy DB without user_version
    const rawDb = new Database(dbPath);
    rawDb.pragma('user_version = 0');
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS file_hashes (file_path TEXT PRIMARY KEY, hash TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS symbols USING fts5(name, kind, file_path UNINDEXED, line_start UNINDEXED, line_end UNINDEXED, signature, project_hash UNINDEXED);
      INSERT INTO file_hashes (file_path, hash, updated_at) VALUES ('legacy.ts', 'old_hash', 100);
    `);
    rawDb.close();

    // Reopen via initIndexDb
    db = initIndexDb(dbPath);
    const version = db.pragma('user_version', { simple: true });
    expect(version).toBe(1);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    expect(tables).toContain('file_hashes');
    expect(tables).toContain('symbols');
    expect(tables).toContain('references');

    // file_hashes is recreated empty, so old hash is wiped and triggers full re-index
    expect(getFileHash(db, 'legacy.ts')).toBeNull();

    // file_hashes is fully functional for new saves
    saveFileHash(db, 'legacy.ts', 'new_hash');
    expect(getFileHash(db, 'legacy.ts')).toBe('new_hash');
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
      { name: 'Func1', kind: 'function', file_path: 'file1.ts', line_start: 1, line_end: 2, signature: '', project_hash: projectHash },
      { name: 'Func2', kind: 'function', file_path: 'file2.ts', line_start: 1, line_end: 2, signature: '', project_hash: projectHash },
    ]);

    clearFileIndex(db, 'file1.ts', projectHash);
    expect(searchSymbols(db, 'Func1', projectHash)).toEqual([]);
    expect(searchSymbols(db, 'Func2', projectHash)).toHaveLength(1);
  });

  it('saveFileHash and getFileHash round-trip', () => {
    saveFileHash(db, 'src/main.ts', 'abc123');
    expect(getFileHash(db, 'src/main.ts')).toBe('abc123');
  });

  it('getFileHash returns null for unknown file', () => {
    expect(getFileHash(db, 'nonexistent.ts')).toBeNull();
  });

  it('findCallees returns outgoing calls from caller', () => {
    insertReferences(db, [
      { caller_name: 'main', caller_file: 'src/main.ts', caller_line: 10, callee_name: 'initDB', callee_file: 'src/db.ts', callee_line: 5, project_hash: projectHash },
      { caller_name: 'main', caller_file: 'src/main.ts', caller_line: 15, callee_name: 'runApp', callee_file: 'src/app.ts', callee_line: 1, project_hash: projectHash },
    ]);

    const callees = findCallees(db, 'main', projectHash);
    expect(callees).toHaveLength(2);
    expect(callees.map(c => c.callee_name)).toEqual(['initDB', 'runApp']);
  });

  it('getCallGraph builds bidirectional call tree and impact analysis', () => {
    insertSymbols(db, [
      { name: 'TargetFunc', kind: 'function', file_path: 'src/core.ts', line_start: 10, line_end: 25, signature: 'function TargetFunc()', project_hash: projectHash },
    ]);
    insertReferences(db, [
      { caller_name: 'CallerA', caller_file: 'src/a.ts', caller_line: 5, callee_name: 'TargetFunc', callee_file: 'src/core.ts', callee_line: 10, project_hash: projectHash },
      { caller_name: 'TargetFunc', caller_file: 'src/core.ts', caller_line: 12, callee_name: 'CalleeB', callee_file: 'src/b.ts', callee_line: 2, project_hash: projectHash },
    ]);

    const graph = getCallGraph(db, 'TargetFunc', projectHash, 2);
    expect(graph.symbol).toBe('TargetFunc');
    expect(graph.definitions).toHaveLength(1);
    expect(graph.inbound).toHaveLength(1);
    expect(graph.inbound[0].caller_name).toBe('CallerA');
    expect(graph.outbound).toHaveLength(1);
    expect(graph.outbound[0].callee_name).toBe('CalleeB');

    const impact = getImpactAnalysis(db, 'TargetFunc', projectHash);
    expect(impact.symbol).toBe('TargetFunc');
    expect(impact.totalDirectCallers).toBe(1);
    expect(impact.riskScore).toBe('MEDIUM');
    expect(impact.affectedFiles).toContain('src/a.ts');
    expect(impact.affectedFiles).toContain('src/core.ts');
  });
});
