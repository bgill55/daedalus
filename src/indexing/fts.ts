import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export interface SymbolRow {
  name: string;
  kind: string;
  file_path: string;
  line_start: number;
  line_end: number;
  signature: string;
  project_hash: string;
}

export interface ReferenceRow {
  caller_name: string;
  caller_file: string;
  caller_line: number;
  callee_name: string;
  callee_file: string;
  callee_line: number;
  project_hash: string;
}

/** Initialize the codebase index database */
export function initIndexDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  
  // Create virtual FTS5 tables for fast symbol & reference search
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_hashes (
      file_path TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS symbols USING fts5(
      name,
      kind,
      file_path UNINDEXED,
      line_start UNINDEXED,
      line_end UNINDEXED,
      signature,
      project_hash UNINDEXED
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS "references" USING fts5(
      caller_name,
      caller_file UNINDEXED,
      caller_line UNINDEXED,
      callee_name,
      callee_file UNINDEXED,
      callee_line UNINDEXED,
      project_hash UNINDEXED
    );
  `);
  return db;
}

/** Clear all indexed data for a specific project */
export function clearProjectIndex(db: Database.Database, projectHash: string): void {
  db.prepare('DELETE FROM file_hashes').run();
  db.prepare('DELETE FROM symbols WHERE project_hash = ?').run(projectHash);
  db.prepare('DELETE FROM "references" WHERE project_hash = ?').run(projectHash);
}

/** Clear a specific file's index data */
export function clearFileIndex(db: Database.Database, filePath: string, projectHash: string): void {
  db.prepare('DELETE FROM file_hashes WHERE file_path = ?').run(filePath);
  db.prepare('DELETE FROM symbols WHERE file_path = ? AND project_hash = ?').run(filePath, projectHash);
  db.prepare('DELETE FROM "references" WHERE caller_file = ? AND project_hash = ?').run(filePath, projectHash);
}

/** Save file hash for incremental updates */
export function saveFileHash(db: Database.Database, filePath: string, hash: string): void {
  db.prepare(`
    INSERT INTO file_hashes (file_path, hash, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET hash = excluded.hash, updated_at = excluded.updated_at
  `).run(filePath, hash, Date.now());
}

/** Get stored file hash */
export function getFileHash(db: Database.Database, filePath: string): string | null {
  const row = db.prepare('SELECT hash FROM file_hashes WHERE file_path = ?').get(filePath) as { hash: string } | undefined;
  return row?.hash || null;
}

/** Bulk insert symbols */
export function insertSymbols(db: Database.Database, rows: SymbolRow[]): void {
  const insert = db.prepare(`
    INSERT INTO symbols (name, kind, file_path, line_start, line_end, signature, project_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const r of rows) {
      insert.run(r.name, r.kind, r.file_path, r.line_start, r.line_end, r.signature, r.project_hash);
    }
  })();
}

/** Search symbols by fuzzy query */
export function searchSymbols(db: Database.Database, query: string, projectHash: string, limit: number = 30): SymbolRow[] {
  // SQLite FTS5 uses MATCH query
  // Escape search query for FTS5 (surround search terms with quotes or clean up special chars)
  const escapedQuery = query.replace(/[^\w\s]/g, ' ').trim();
  if (!escapedQuery) return [];

  // Match against name and signature columns
  return db.prepare(`
    SELECT name, kind, file_path, line_start, line_end, signature, project_hash
    FROM symbols
    WHERE project_hash = ? AND symbols MATCH ?
    LIMIT ?
  `).all(projectHash, `${escapedQuery}*`, limit) as SymbolRow[];
}

/** Bulk insert references */
export function insertReferences(db: Database.Database, rows: ReferenceRow[]): void {
  const insert = db.prepare(`
    INSERT INTO "references" (caller_name, caller_file, caller_line, callee_name, callee_file, callee_line, project_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const r of rows) {
      insert.run(r.caller_name, r.caller_file, r.caller_line, r.callee_name, r.callee_file, r.callee_line, r.project_hash);
    }
  })();
}

/** Find definitions for a symbol */
export function findDefinitions(db: Database.Database, name: string, projectHash: string): SymbolRow[] {
  return db.prepare(`
    SELECT name, kind, file_path, line_start, line_end, signature, project_hash
    FROM symbols
    WHERE project_hash = ? AND name = ?
  `).all(projectHash, name) as SymbolRow[];
}

/** Find callers of a function name */
export function findReferences(db: Database.Database, calleeName: string, projectHash: string): ReferenceRow[] {
  return db.prepare(`
    SELECT caller_name, caller_file, caller_line, callee_name, callee_file, callee_line, project_hash
    FROM "references"
    WHERE project_hash = ? AND callee_name = ?
  `).all(projectHash, calleeName) as ReferenceRow[];
}