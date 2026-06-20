import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { initSessionDb, saveTurn, getTurns } from './sqlite.js';
import { exportToJsonl, importFromJsonl } from './jsonl.js';

describe('JSONL import/export', () => {
  let db: Database.Database;
  let dbPath: string;
  let jsonlPath: string;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-jsonl-test-'));
    dbPath = path.join(dir, 'session.sqlite');
    jsonlPath = path.join(dir, 'export.jsonl');
    db = initSessionDb(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it('exports turns to JSONL format', () => {
    saveTurn(db, { role: 'user', content: 'hello' });
    saveTurn(db, { role: 'assistant', content: 'world', model: 'gpt-4', tokens_input: 10, tokens_output: 20 });

    exportToJsonl(db, jsonlPath);
    const lines = fs.readFileSync(jsonlPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.turn).toBe(1);
    expect(first.role).toBe('user');
    expect(first.content).toBe('hello');
  });

  it('exports includes token info', () => {
    saveTurn(db, { role: 'user', content: 'hi', tokens_input: 5 });
    exportToJsonl(db, jsonlPath);
    const line = JSON.parse(fs.readFileSync(jsonlPath, 'utf8').trim());
    expect(line.tokens).toEqual({ in: 5, out: undefined });
  });

  it('imports from JSONL file', () => {
    const lines = [
      JSON.stringify({ turn: 1, role: 'user', content: 'question' }),
      JSON.stringify({ turn: 2, role: 'assistant', content: 'answer', model: 'gpt-4' }),
    ].join('\n');
    fs.writeFileSync(jsonlPath, lines, 'utf8');

    importFromJsonl(db, jsonlPath);
    const turns = getTurns(db);
    expect(turns).toHaveLength(2);
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].model).toBe('gpt-4');
  });

  it('importFromJsonl throws for missing file', () => {
    expect(() => importFromJsonl(db, '/nonexistent/file.jsonl')).toThrow('JSONL file not found');
  });

  it('clears existing turns before import', () => {
    saveTurn(db, { role: 'user', content: 'old' });
    const data = JSON.stringify({ turn: 1, role: 'assistant', content: 'new' });
    fs.writeFileSync(jsonlPath, data, 'utf8');

    importFromJsonl(db, jsonlPath);
    expect(getTurns(db)).toHaveLength(1);
    expect(getTurns(db)[0].content).toBe('new');
  });

  it('handles empty JSONL gracefully', () => {
    fs.writeFileSync(jsonlPath, '', 'utf8');
    importFromJsonl(db, jsonlPath);
    expect(getTurns(db)).toHaveLength(0);
  });

  it('preserves tool_calls and tokens during round-trip', () => {
    saveTurn(db, {
      role: 'assistant',
      content: 'let me search',
      tool_calls: JSON.stringify([{ id: 'call_1', type: 'function', function: { name: 'search', arguments: '{}' } }]),
      tokens_input: 50,
      tokens_output: 30,
    });

    exportToJsonl(db, jsonlPath);
    const freshDb = initSessionDb(dbPath.replace('.sqlite', '-2.sqlite'));
    importFromJsonl(freshDb, jsonlPath);

    const turns = getTurns(freshDb);
    expect(turns).toHaveLength(1);
    expect(turns[0].tool_calls).toContain('search');
    expect(turns[0].tokens_input).toBe(50);

    freshDb.close();
    try { fs.unlinkSync(freshDb.name); } catch {}
  });

});
