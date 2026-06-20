import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import {
  initIndexDb,
  initSessionDb,
  registerSession,
  listSessionsForProject,
  deleteSessionFromIndex,
  saveTurn,
  getTurns,
  clearTurns,
  saveActiveFiles,
  getActiveFiles,
  saveTodos,
  getTodos,
  saveState,
  getState,
} from './sqlite.js';

describe('SQLite session database (index)', () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-sqlite-test-'));
    dbPath = path.join(dir, 'index.sqlite');
    db = initIndexDb(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it('creates sessions table on init', () => {
    const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
    expect(result).toBeTruthy();
  });

  it('registers a session', () => {
    registerSession(db, {
      id: 'test-1', project_path: '/test', project_hash: 'abc123',
      title: 'Test Session', created_at: 1000, updated_at: 1000,
    });
    const rows = db.prepare('SELECT * FROM sessions').all();
    expect(rows).toHaveLength(1);
  });

  it('upserts session on duplicate id', () => {
    registerSession(db, {
      id: 'test-1', project_path: '/test', project_hash: 'abc123',
      title: 'Original', created_at: 1000, updated_at: 1000,
    });
    registerSession(db, {
      id: 'test-1', project_path: '/test', project_hash: 'abc123',
      title: 'Updated', created_at: 1000, updated_at: 2000,
    });
    const rows = db.prepare('SELECT * FROM sessions').all();
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).title).toBe('Updated');
  });

  it('lists sessions for a project ordered by updated_at desc', () => {
    registerSession(db, { id: 'a', project_path: '/p', project_hash: 'abc', title: 'A', created_at: 1, updated_at: 3 });
    registerSession(db, { id: 'b', project_path: '/p', project_hash: 'abc', title: 'B', created_at: 2, updated_at: 1 });
    registerSession(db, { id: 'c', project_path: '/p2', project_hash: 'xyz', title: 'C', created_at: 3, updated_at: 3 });

    const result = listSessionsForProject(db, 'abc');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('b');
  });

  it('deletes a session from index', () => {
    registerSession(db, { id: 'del', project_path: '/p', project_hash: 'abc', title: 'Del', created_at: 1, updated_at: 1 });
    deleteSessionFromIndex(db, 'del');
    expect(listSessionsForProject(db, 'abc')).toHaveLength(0);
  });
});

describe('SQLite session database (session)', () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-sqlite-test-'));
    dbPath = path.join(dir, 'session.sqlite');
    db = initSessionDb(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it('creates all tables on init', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    expect(tables).toContain('turns');
    expect(tables).toContain('agent_state');
    expect(tables).toContain('active_files');
    expect(tables).toContain('todos');
  });

  it('saves and retrieves turns', () => {
    saveTurn(db, { role: 'user', content: 'hello' });
    saveTurn(db, { role: 'assistant', content: 'world' });
    const turns = getTurns(db);
    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe('user');
    expect(turns[1].content).toBe('world');
  });

  it('clearTurns removes all turns', () => {
    saveTurn(db, { role: 'user', content: 'test' });
    clearTurns(db);
    expect(getTurns(db)).toHaveLength(0);
  });

  it('saves and retrieves active files', () => {
    const files = new Map<string, string>([
      ['/path/to/file.ts', 'file.ts'],
      ['/path/to/other.ts', 'other.ts'],
    ]);
    saveActiveFiles(db, files);

    const loaded = getActiveFiles(db);
    expect(loaded.size).toBe(2);
    expect(loaded.get('/path/to/file.ts')).toBe('file.ts');
  });

  it('replaces active files on save', () => {
    saveActiveFiles(db, new Map([['/a.ts', 'a.ts']]));
    saveActiveFiles(db, new Map([['/b.ts', 'b.ts']]));
    expect(getActiveFiles(db).size).toBe(1);
    expect(getActiveFiles(db).get('/a.ts')).toBeUndefined();
  });

  it('saves and retrieves todos', () => {
    const todos = [
      { id: '1', content: 'Task 1', status: 'pending', created_at: 100, updated_at: 100 },
      { id: '2', content: 'Task 2', status: 'completed', created_at: 200, updated_at: 200 },
    ];
    saveTodos(db, todos);
    const loaded = getTodos(db);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].status).toBe('pending');
  });

  it('replaces all todos on save', () => {
    saveTodos(db, [{ id: '1', content: 'old', status: 'pending', created_at: 1, updated_at: 1 }]);
    saveTodos(db, [{ id: '2', content: 'new', status: 'completed', created_at: 2, updated_at: 2 }]);
    expect(getTodos(db)).toHaveLength(1);
  });

  it('saves and retrieves agent state', () => {
    saveState(db, 'myKey', { nested: { value: 42 } });
    expect(getState(db, 'myKey')).toEqual({ nested: { value: 42 } });
  });

  it('returns null for missing state key', () => {
    expect(getState(db, 'nonexistent')).toBeNull();
  });

  it('overwrites existing state key', () => {
    saveState(db, 'key', 'original');
    saveState(db, 'key', 'updated');
    expect(getState(db, 'key')).toBe('updated');
  });

  it('saves turn with all optional fields', () => {
    saveTurn(db, {
      role: 'assistant',
      content: 'response',
      tool_calls: JSON.stringify([{ id: 'call_1', type: 'function', function: { name: 'test', arguments: '{}' } }]),
      tool_call_id: 'call_1',
      name: 'test',
      model: 'gpt-4',
      tokens_input: 100,
      tokens_output: 50,
      latency_ms: 500,
    });
    const turns = getTurns(db);
    expect(turns).toHaveLength(1);
    expect(turns[0].tool_calls).toContain('call_1');
    expect(turns[0].model).toBe('gpt-4');
  });

});
