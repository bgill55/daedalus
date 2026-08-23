import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { initProjectMemDb, getSigmaMemories } from './sqlite.js';
import { SigmaMemEngine } from './sigma-mem.js';
import { evaluatePatchOutcome, maxPatchFailureStreak } from '../model.js';
import type { PatchEntry } from '../types.js';

describe('Σ-Mem single-agent feedback proxy', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-sigma-agent-test-'));
    dbPath = path.join(tmpDir, 'project-mem.sqlite');
    db = initProjectMemDb(dbPath);
  });

  afterEach(() => {
    if (db) db.close();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rewards active memories when a turn applied new patches', () => {
    const mem = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder',
      category: 'code_pattern',
      tags: [],
      summary: 'Export named only',
      content: 'Use named exports per AGENTS.md.',
    });

    const patchHistory: PatchEntry[] = [{ filePath: 'a.ts', oldContent: '', newContent: 'x', description: 'test' }];
    const patchFailureStreak = new Map<string, number>();
    const before = { patches: 0, maxStreak: maxPatchFailureStreak(patchFailureStreak) };
    const after = { patches: patchHistory.length, maxStreak: maxPatchFailureStreak(patchFailureStreak) };

    expect(evaluatePatchOutcome(before, after)).toBe('success');

    SigmaMemEngine.rewardSuccessfulPass(db, [mem.id]);
    expect(getSigmaMemories(db, 0.0)[0].sigma_score).toBe(0.80);
  });

  it('penalizes active memories when a turn worsened patch failures without applying patches', () => {
    const mem = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder',
      category: 'code_pattern',
      tags: [],
      summary: 'Flaky pattern',
      content: 'Unstable snippet',
      initialScore: 0.50,
    });

    const patchHistory: PatchEntry[] = [];
    const patchFailureStreak = new Map<string, number>();
    const before = { patches: 0, maxStreak: maxPatchFailureStreak(patchFailureStreak) };
    patchFailureStreak.set('a.ts', 3);
    const after = { patches: patchHistory.length, maxStreak: maxPatchFailureStreak(patchFailureStreak) };

    expect(after.patches).toBe(before.patches);
    expect(after.maxStreak).toBeGreaterThan(before.maxStreak);
    expect(evaluatePatchOutcome(before, after)).toBe('failure');

    SigmaMemEngine.penalizeFailedAttempt(db, [mem.id]);
    expect(getSigmaMemories(db, 0.0)[0].sigma_score).toBeCloseTo(0.50 * 0.70);
  });

  it('reports none when patch state is unchanged', () => {
    const before = { patches: 2, maxStreak: 1 };
    expect(evaluatePatchOutcome(before, { ...before })).toBe('none');
  });
});
