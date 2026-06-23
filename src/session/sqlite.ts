// SQLite session database helpers for Daedalus

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export interface SqliteTurn {
  id?: number;
  role: string;
  content: string;
  tool_calls?: string; // JSON string
  tool_call_id?: string;
  name?: string;
  model?: string;
  tokens_input?: number;
  tokens_output?: number;
  latency_ms?: number;
  created_at?: number;
}

export interface SqliteTodo {
  id: string;
  content: string;
  status: string;
  agent_role?: string;
  created_at?: number;
  updated_at?: number;
}

export interface SessionMeta {
  id: string;
  project_path: string;
  project_hash: string;
  title: string;
  created_at: number;
  updated_at: number;
}

/** Initialize the global sessions index database */
export function initIndexDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      project_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_project_hash ON sessions(project_hash);
  `);
  return db;
}

/** Register a session in the global index */
export function registerSession(db: Database.Database, meta: SessionMeta): void {
  db.prepare(`
    INSERT INTO sessions (id, project_path, project_hash, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      updated_at = excluded.updated_at
  `).run(meta.id, meta.project_path, meta.project_hash, meta.title, meta.created_at, meta.updated_at);
}

/** List all sessions for a specific project */
export function listSessionsForProject(db: Database.Database, projectHash: string): SessionMeta[] {
  return db.prepare(`
    SELECT id, project_path, project_hash, title, created_at, updated_at
    FROM sessions
    WHERE project_hash = ?
    ORDER BY updated_at DESC
  `).all(projectHash) as SessionMeta[];
}

/** Delete a session from the index */
export function deleteSessionFromIndex(db: Database.Database, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

/** Initialize a specific session database */
export function initSessionDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      tool_call_id TEXT,
      name TEXT,
      model TEXT,
      tokens_input INTEGER,
      tokens_output INTEGER,
      latency_ms INTEGER,
      created_at INTEGER DEFAULT (strftime('%s','now')*1000)
    );

    CREATE TABLE IF NOT EXISTS agent_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS active_files (
      path TEXT PRIMARY KEY,
      alias TEXT NOT NULL,
      added_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      agent_role TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_status (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      build_status TEXT,
      test_status TEXT,
      key_concerns TEXT,
      last_reviewed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS failure_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_role TEXT,
      goal_keywords TEXT,
      error_snippet TEXT,
      resolution TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')*1000),
      used_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_failure_lessons_role ON failure_lessons(task_role);
  `);
  return db;
}

/** Save a turn to the session database */
export function saveTurn(db: Database.Database, turn: SqliteTurn): void {
  db.prepare(`
    INSERT INTO turns (role, content, tool_calls, tool_call_id, name, model, tokens_input, tokens_output, latency_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    turn.role,
    turn.content,
    turn.tool_calls || null,
    turn.tool_call_id || null,
    turn.name || null,
    turn.model || null,
    turn.tokens_input || null,
    turn.tokens_output || null,
    turn.latency_ms || null
  );
}

/** Get all turns from the session database */
export function getTurns(db: Database.Database): SqliteTurn[] {
  return db.prepare(`
    SELECT id, role, content, tool_calls, tool_call_id, name, model, tokens_input, tokens_output, latency_ms, created_at
    FROM turns
    ORDER BY id ASC
  `).all() as SqliteTurn[];
}

/** Clear all turns in the session database */
export function clearTurns(db: Database.Database): void {
  db.prepare('DELETE FROM turns').run();
}

/** Save active files context */
export function saveActiveFiles(db: Database.Database, files: Map<string, string>): void {
  db.transaction(() => {
    db.prepare('DELETE FROM active_files').run();
    const insert = db.prepare('INSERT INTO active_files (path, alias, added_at) VALUES (?, ?, ?)');
    const now = Date.now();
    for (const [absPath, alias] of Array.from(files.entries())) {
      insert.run(absPath, alias, now);
    }
  })();
}

/** Get active files context */
export function getActiveFiles(db: Database.Database): Map<string, string> {
  const rows = db.prepare('SELECT path, alias FROM active_files').all() as Array<{ path: string; alias: string }>;
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(r.path, r.alias);
  }
  return map;
}

/** Save todos list */
export function saveTodos(db: Database.Database, todos: SqliteTodo[]): void {
  db.transaction(() => {
    db.prepare('DELETE FROM todos').run();
    const insert = db.prepare(`
      INSERT INTO todos (id, content, status, agent_role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    for (const t of todos) {
      insert.run(t.id, t.content, t.status, t.agent_role || null, t.created_at || now, t.updated_at || now);
    }
  })();
}

/** Get todos list */
export function getTodos(db: Database.Database): SqliteTodo[] {
  return db.prepare(`
    SELECT id, content, status, agent_role, created_at, updated_at
    FROM todos
    ORDER BY created_at ASC
  `).all() as SqliteTodo[];
}

/** Save state key-value */
export function saveState(db: Database.Database, key: string, val: any): void {
  db.prepare(`
    INSERT INTO agent_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(val), Date.now());
}

/** Get state value */
export function getState(db: Database.Database, key: string): any | null {
  const row = db.prepare('SELECT value FROM agent_state WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

export interface FailureLesson {
  id?: number;
  task_role: string;
  goal_keywords: string;
  error_snippet: string;
  resolution: string;
  created_at?: number;
  used_count?: number;
}

export interface ProjectStatus {
  build_status?: string;
  test_status?: string;
  key_concerns?: string;
  last_reviewed_at?: number;
}

export function saveFailureLesson(db: Database.Database, lesson: FailureLesson): void {
  db.prepare(`INSERT INTO failure_lessons (task_role, goal_keywords, error_snippet, resolution) VALUES (?, ?, ?, ?)`).run(
    lesson.task_role, lesson.goal_keywords, lesson.error_snippet, lesson.resolution
  );
}

export function getFailureLessons(db: Database.Database, role?: string): FailureLesson[] {
  if (role) {
    return db.prepare('SELECT * FROM failure_lessons WHERE task_role = ? ORDER BY used_count ASC, created_at DESC LIMIT 5').all(role) as FailureLesson[];
  }
  return db.prepare('SELECT * FROM failure_lessons ORDER BY used_count ASC, created_at DESC LIMIT 10').all() as FailureLesson[];
}

export function incrementLessonUsed(db: Database.Database, lessonId: number): void {
  db.prepare('UPDATE failure_lessons SET used_count = used_count + 1 WHERE id = ?').run(lessonId);
}

export function saveProjectStatus(db: Database.Database, status: ProjectStatus): void {
  db.prepare(`INSERT INTO project_status (id, build_status, test_status, key_concerns, last_reviewed_at) VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET build_status = excluded.build_status, test_status = excluded.test_status,
    key_concerns = excluded.key_concerns, last_reviewed_at = excluded.last_reviewed_at`).run(
    status.build_status || null, status.test_status || null, status.key_concerns || null, status.last_reviewed_at || Date.now()
  );
}

export function getProjectStatus(db: Database.Database): ProjectStatus | null {
  const row = db.prepare('SELECT * FROM project_status WHERE id = 1').get() as ProjectStatus | undefined;
  return row || null;
}
