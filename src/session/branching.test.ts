import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initBranchingDatabase,
  createSessionBranch,
  checkoutSessionBranch,
  listSessionBranches,
  mergeSessionBranch,
} from './branching.js';
import { saveTurn } from './sqlite.js';

describe('Session Branching System', () => {
  let db: Database.Database;
  let tempDir: string;
  let sessionDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-branch-test-'));
    sessionDir = path.join(tempDir, 'sessions');
    db = new Database(':memory:');

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
        created_at INTEGER
      );
    `);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('initializes session_branches table', () => {
    initBranchingDatabase(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_branches'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it('creates a session branch and copies trajectory turns to JSONL', () => {
    saveTurn(db, { role: 'user', content: 'Step 1' });
    saveTurn(db, { role: 'assistant', content: 'Step 2' });

    const branch = createSessionBranch(db, 'main-session', 'feature-a', tempDir, sessionDir);

    expect(branch.name).toBe('feature-a');
    expect(branch.parent_id).toBe('main-session');
    expect(branch.branch_point_step).toBe(2);
    expect(branch.status).toBe('active');

    const jsonlPath = path.join(sessionDir, `${branch.id}.jsonl`);
    expect(fs.existsSync(jsonlPath)).toBe(true);

    const content = fs.readFileSync(jsonlPath, 'utf8').trim().split('\n');
    expect(content).toHaveLength(2);
    expect(JSON.parse(content[0]).content).toBe('Step 1');
  });

  it('throws error when creating duplicate branch name', () => {
    createSessionBranch(db, 'main-session', 'feature-dup', tempDir, sessionDir);
    expect(() =>
      createSessionBranch(db, 'main-session', 'feature-dup', tempDir, sessionDir)
    ).toThrow("Session branch with name 'feature-dup' already exists.");
  });

  it('checks out an existing session branch', () => {
    const created = createSessionBranch(db, 'main-session', 'checkout-test', tempDir, sessionDir);
    const found = checkoutSessionBranch(db, 'checkout-test');
    expect(found.id).toBe(created.id);
    expect(found.name).toBe('checkout-test');
  });

  it('lists session branches in a formatted tree string', () => {
    const b1 = createSessionBranch(db, 'main', 'branch-1', tempDir, sessionDir);
    createSessionBranch(db, b1.id, 'sub-branch-1', tempDir, sessionDir);

    const listStr = listSessionBranches(db);
    expect(listStr).toContain('branch-1 (active)');
    expect(listStr).toContain('sub-branch-1 (active)');
  });

  it('merges a branch and appends turns', async () => {
    saveTurn(db, { role: 'user', content: 'Initial User Request' });
    const b1 = createSessionBranch(db, 'main-session', 'branch-merge-test', tempDir, sessionDir);

    const jsonlPath = path.join(sessionDir, `${b1.id}.jsonl`);
    const newTurns = [
      JSON.stringify({ step: 1, role: 'user', content: 'Initial User Request' }),
      JSON.stringify({ step: 2, role: 'assistant', content: 'Branch Edit Response' }),
    ].join('\n');
    fs.writeFileSync(jsonlPath, newTurns, 'utf8');

    const result = await mergeSessionBranch(db, 'branch-merge-test', tempDir, sessionDir);
    expect(result.success).toBe(true);

    const updatedFound = checkoutSessionBranch(db, 'branch-merge-test');
    expect(updatedFound.status).toBe('merged');
  });
});
