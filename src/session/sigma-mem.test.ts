import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { initProjectMemDb, getSigmaMemories } from './sqlite.js';
import { SigmaMemEngine } from './sigma-mem.js';

describe('SigmaMemEngine (Σ-Mem)', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-sigma-test-'));
    dbPath = path.join(tmpDir, 'project-mem.sqlite');
    db = initProjectMemDb(dbPath);
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

  it('deduplicates identical knowledge on content hash (no second row, usefulness_count increments)', () => {
    const first = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder',
      category: 'code_pattern',
      tags: ['css'],
      summary: 'SVG sizing rule',
      content: 'Set max-width on raw svg.',
    });

    const second = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder',
      category: 'code_pattern',
      tags: ['css', 'svg'],
      summary: 'SVG sizing rule',
      content: 'Set max-width: 24px on raw svg.',
    });

    expect(second.id).toBe(first.id);
    expect(second.usefulness_count).toBe(2);
    expect(second.sigma_score).toBe(0.75);
    expect(second.content).toBe('Set max-width: 24px on raw svg.');

    const memories = getSigmaMemories(db, 0.0);
    expect(memories.length).toBe(1);
    expect(memories[0].content).toBe('Set max-width: 24px on raw svg.');
  });

  it('matchTags prioritizes memories with overlapping tags, then falls back to best global', () => {
    const a = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder', category: 'code_pattern', tags: ['ts'],
      summary: 'TS type guard rule', content: 'Prefer user-defined type guards.',
      initialScore: 0.65,
    });
    const b = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder', category: 'code_pattern', tags: ['css'],
      summary: 'CSS flexbox fix', content: 'Use flexbox for centering.',
      initialScore: 0.95,
    });
    const c = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder', category: 'code_pattern', tags: ['ts', 'node'],
      summary: 'Node ESM import rule', content: 'Always use ESM imports.',
      initialScore: 0.80,
    });

    const { prompt, activeMemoryIds } = SigmaMemEngine.getPromptContext(db, 'coder', 0.50, 6, ['ts']);

    expect(activeMemoryIds[0]).toBe(c.id);
    expect(activeMemoryIds[1]).toBe(a.id);
    expect(activeMemoryIds[2]).toBe(b.id);
    expect(prompt.indexOf('Node ESM import rule')).toBeLessThan(prompt.indexOf('CSS flexbox fix'));
  });

  it('time decay reduces the score of an old memory and increments decay_count', () => {
    const mem = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder',
      category: 'code_pattern',
      tags: ['legacy'],
      summary: 'Legacy build rule',
      content: 'Old content that has gone stale.',
    });

    db.prepare('UPDATE sigma_memories SET updated_at = ? WHERE id = ?').run(
      Date.now() - 60 * 24 * 60 * 60 * 1000,
      mem.id
    );

    const memories = getSigmaMemories(db, 0.0);
    expect(memories.length).toBe(1);
    expect(memories[0].sigma_score).toBeLessThan(0.70);
    expect(memories[0].sigma_score).toBeCloseTo(0.20, 2);
    expect(memories[0].decay_count).toBe(1);
  });

  // REGRESSION: the day-one bug set the consolidateAndPruneMemories default
  // threshold to 1.0, which deleted EVERY memory every turn (nothing scores
  // exactly 1.0), so /sigma showed empty and Daedalus never learned. This pins
  // that memories survive consolidation at the corrected 0.20 default and are
  // still retrievable for the prompt context.
  it('REGRESSION: memories survive consolidateAndPruneMemories at default 0.20 (not wiped)', () => {
    SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder', category: 'code_pattern', tags: ['ts'],
      summary: 'TS type guard rule', content: 'Prefer user-defined type guards.',
      initialScore: 0.70,
    });
    SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'debugger', category: 'fix_resolution', tags: ['express'],
      summary: 'Express static path fix', content: 'Use path.join(process.cwd(), "public")',
      initialScore: 0.85,
    });

    // Run the SAME maintenance call the REPL invokes each turn (no explicit threshold).
    const removed = SigmaMemEngine.consolidateAndPruneMemories(db);
    expect(removed).toBe(0);

    const surviving = getSigmaMemories(db, 0.0);
    expect(surviving.length).toBe(2);

    // And it must still surface in the prompt context for the agent.
    const { activeMemoryIds } = SigmaMemEngine.getPromptContext(db, undefined, 0.50, 6);
    expect(activeMemoryIds.length).toBe(2);
  });

  it('REGRESSION: a 1.0 prune threshold would wipe real memories (guards the fix)', () => {
    SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder', category: 'code_pattern', tags: ['ts'],
      summary: 'TS type guard rule', content: 'Prefer user-defined type guards.',
      initialScore: 0.95, // highest possible real score, still < 1.0
    });
    // The buggy default would call this with 1.0 and delete everything.
    const removed = SigmaMemEngine.consolidateAndPruneMemories(db, 1.0);
    expect(removed).toBe(1);
    expect(getSigmaMemories(db, 0.0).length).toBe(0);
  });

  // REGRESSION: sigma memory must persist at the PROJECT level, not per-session,
  // so knowledge carries across sessions for the same project. Reopening the
  // project-mem DB (as SessionManager does per projectHash) must show prior memories.
  it('REGRESSION: memories persist across reopened project-mem DB (project-level, not session)', () => {
    SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder', category: 'build_rule', tags: ['lint'],
      summary: 'Always run lint before commit', content: 'Run npm run lint.',
      initialScore: 0.80,
    });
    db.close();

    // Simulate a new session opening the same project's mem DB.
    const db2 = initProjectMemDb(dbPath);
    const memories = getSigmaMemories(db2, 0.0);
    expect(memories.length).toBe(1);
    expect(memories[0].summary).toBe('Always run lint before commit');
    db2.close();
  });
});
