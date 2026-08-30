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
      content: 'Set max-width: 24px on raw svg.',
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
    // Re-recording identical knowledge must NOT inflate reliability — sigma_score
    // stays at its recorded value (0.70). Reliability rises only via rewardSuccessfulPass.
    expect(second.sigma_score).toBe(0.70);
    expect(second.content).toBe('Set max-width: 24px on raw svg.');

    const memories = getSigmaMemories(db, 0.0);
    expect(memories.length).toBe(1);
  });

  it('does NOT deduplicate memories with same summary but different content', () => {
    SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder',
      category: 'code_pattern',
      tags: ['css'],
      summary: 'SVG sizing rule',
      content: 'Set max-width on raw svg.',
    });

    SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder',
      category: 'code_pattern',
      tags: ['css'],
      summary: 'SVG sizing rule',
      content: 'Set max-width: 24px on raw svg.',
    });

    const memories = getSigmaMemories(db, 0.0);
    expect(memories.length).toBe(2);
  });

  it('re-recording knowledge many times raises usefulness_count but never sigma_score (reliability is outcome-gated only)', () => {
    const mem = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder',
      category: 'code_pattern',
      tags: ['ts'],
      summary: 'TS type guard rule',
      content: 'Prefer user-defined type guards.',
    });
    expect(mem.sigma_score).toBe(0.70);

    // Re-record the identical memory 5 more times (e.g. across failed retries).
    for (let i = 0; i < 5; i++) {
      const again = SigmaMemEngine.recordVerifiedKnowledge(db, {
        agentRole: 'coder',
        category: 'code_pattern',
        tags: ['ts'],
        summary: 'TS type guard rule',
        content: 'Prefer user-defined type guards.',
      });
      // Reliability must NOT climb from reuse — only rewardSuccessfulPass may raise it.
      expect(again.sigma_score).toBe(0.70);
      expect(again.usefulness_count).toBe(mem.usefulness_count + i + 1);
    }

    // A verified pass still raises it; a re-record alone does not.
    SigmaMemEngine.rewardSuccessfulPass(db, [mem.id]);
    const after = getSigmaMemories(db, 0.0).find((m) => m.id === mem.id)!;
    expect(after.sigma_score).toBe(0.80);
  });

  it('records verified_pass / verified_fail counts on reward and penalize (does NOT move sigma_score by them)', () => {
    const mem = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder', category: 'build_rule', tags: ['lint'],
      summary: 'Run lint before commit', content: 'Run npm run lint.',
    });
    expect(mem.verified_pass).toBe(0);
    expect(mem.verified_fail).toBe(0);

    SigmaMemEngine.rewardSuccessfulPass(db, [mem.id]);
    let after = getSigmaMemories(db, 0.0).find((m) => m.id === mem.id)!;
    expect(after.verified_pass).toBe(1);
    expect(after.verified_fail).toBe(0);
    expect(after.sigma_score).toBe(0.80);

    SigmaMemEngine.rewardSuccessfulPass(db, [mem.id]);
    after = getSigmaMemories(db, 0.0).find((m) => m.id === mem.id)!;
    expect(after.verified_pass).toBe(2);
    expect(after.sigma_score).toBe(0.90);

    SigmaMemEngine.penalizeFailedAttempt(db, [mem.id]);
    after = getSigmaMemories(db, 0.0).find((m) => m.id === mem.id)!;
    expect(after.verified_fail).toBe(1);
    // 0.90 * 0.70 = 0.63
    expect(after.sigma_score).toBeCloseTo(0.63, 4);
    // verified_pass is preserved across the failure (history, not a reset)
    expect(after.verified_pass).toBe(2);
  });

  it('re-recording carries verified counts forward (no reset on re-observation)', () => {
    const mem = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'debugger', category: 'fix_resolution', tags: ['express'],
      summary: 'Express static path fix', content: 'Use path.join(process.cwd(), "public")',
    });
    SigmaMemEngine.rewardSuccessfulPass(db, [mem.id]);
    SigmaMemEngine.rewardSuccessfulPass(db, [mem.id]);
    let after = getSigmaMemories(db, 0.0).find((m) => m.id === mem.id)!;
    expect(after.verified_pass).toBe(2);

    // Re-record (e.g. observed again in a later task) must NOT wipe the history.
    const again = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'debugger', category: 'fix_resolution', tags: ['express'],
      summary: 'Express static path fix', content: 'Use path.join(process.cwd(), "public")',
    });
    expect(again.verified_pass).toBe(2);
    expect(again.verified_fail).toBe(0);
    expect(again.usefulness_count).toBe(after.usefulness_count + 1);
    expect(again.sigma_score).toBe(after.sigma_score);
  });

  it('ranking breaks ties between equal Σ-Scores by verified pass-rate', () => {
    // Two memories with identical scores; the higher pass-rate should rank first.
    const highRate = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder', category: 'code_pattern', tags: ['ts'],
      summary: 'High-rate rule', content: 'Always prefer guards.', initialScore: 0.80,
    });
    const lowRate = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder', category: 'code_pattern', tags: ['ts'],
      summary: 'Low-rate rule', content: 'Avoid any().', initialScore: 0.80,
    });
    SigmaMemEngine.rewardSuccessfulPass(db, [highRate.id]);
    SigmaMemEngine.rewardSuccessfulPass(db, [highRate.id]);
    SigmaMemEngine.rewardSuccessfulPass(db, [highRate.id]);
    SigmaMemEngine.penalizeFailedAttempt(db, [lowRate.id]); // 0.80*0.70 = 0.56 -> below 0.60!

    // lowRate dropped to 0.56 (below default 0.60 min), so only highRate survives.
    const ctx = SigmaMemEngine.getPromptContext(db, 'coder', 0.60, 6, ['ts']);
    expect(ctx.activeMemoryIds).toContain(highRate.id);
    expect(ctx.activeMemoryIds).not.toContain(lowRate.id);

    // At a low minScore both survive; high-rate (3✓/0✗) must outrank low-rate (0✓/1✗)
    // despite identical starting sigma (the pass-rate tiebreaker).
    const ctx2 = SigmaMemEngine.getPromptContext(db, 'coder', 0.0, 6, ['ts']);
    expect(ctx2.activeMemoryIds[0]).toBe(highRate.id);
  });

  it('verified pass-rate is 0 (neutral) when no outcome has been recorded', () => {
    const mem = SigmaMemEngine.recordVerifiedKnowledge(db, {
      agentRole: 'coder', category: 'code_pattern', tags: ['ts'],
      summary: 'Neutral rule', content: 'Be consistent.',
    });
    const after = getSigmaMemories(db, 0.0).find((m) => m.id === mem.id)!;
    expect(after.verified_pass).toBe(0);
    expect(after.verified_fail).toBe(0);
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
