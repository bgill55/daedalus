import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { initSessionDb, getSigmaMemories } from './sqlite.js';
import { SigmaMemEngine } from './sigma-mem.js';

describe('SigmaMemEngine (Σ-Mem)', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-sigma-test-'));
    dbPath = path.join(tmpDir, 'session.sqlite');
    db = initSessionDb(dbPath);
  });

  afterEach(() => {
    if (db) db.close();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('records verified knowledge with initial Σ-Score (0.70)', () => {
    const mem = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder',
      category: 'code_pattern',
      tags: ['css', 'svg'],
      summary: 'SVG layout protection rule',
      content: 'Always set max-width: 24px on raw svg tags.',
    });

    expect(mem.id).toBeDefined();
    expect(mem.sigma_score).toBe(0.70);

    const memories = getSigmaMemories(db, 0.50);
    expect(memories.length).toBe(1);
    expect(memories[0].summary).toBe('SVG layout protection rule');
  });

  it('rewards successful task pass by increasing Σ-Score (+0.10)', () => {
    const mem = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'debugger',
      category: 'fix_resolution',
      tags: ['express'],
      summary: 'Express static path fix',
      content: 'Use path.join(process.cwd(), "public")',
    });

    SigmaMemEngine.rewardSuccessfulPass(db, [mem.id]);

    const memories = getSigmaMemories(db, 0.50);
    expect(memories[0].sigma_score).toBe(0.80);
    expect(memories[0].usefulness_count).toBe(2);
  });

  it('penalizes failed attempts by decaying Σ-Score and pruning low items (< 0.20)', () => {
    const mem = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder',
      category: 'code_pattern',
      tags: ['flaky'],
      summary: 'Flaky pattern',
      content: 'Unstable code snippet',
      initialScore: 0.25,
    });

    // 0.25 * 0.70 = 0.175 (< 0.20 threshold) -> should auto-prune
    SigmaMemEngine.penalizeFailedAttempt(db, [mem.id]);

    const memories = getSigmaMemories(db, 0.0);
    expect(memories.length).toBe(0);
  });

  it('generates formatted system prompt context block for sub-agents', () => {
    SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder',
      category: 'build_rule',
      tags: ['ts'],
      summary: 'Always export named exports',
      content: 'No default exports per AGENTS.md.',
    });

    const { prompt, activeMemoryIds } = SigmaMemEngine.getPromptContext(db, 'coder', 0.50);

    expect(prompt).toContain('Σ-Mem Verified Team Memory');
    expect(prompt).toContain('No default exports per AGENTS.md.');
    expect(activeMemoryIds.length).toBe(1);
  });
});
