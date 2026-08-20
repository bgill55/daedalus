import { describe, it, expect } from 'vitest';
import { ReadStallDetector, isGreenBuildTestClaim, isVerifyRunReport, fabricatedTestCountCorrection, DivergenceDetector, isStaleReadFailure } from './loop-guards.js';

describe('ReadStallDetector', () => {
  it('does not flag a few reads of the same file', () => {
    const d = new ReadStallDetector(15);
    for (let i = 0; i < 5; i++) expect(d.registerRead('/repo/src/db.ts')).toBe(false);
    expect(d.readCount).toBe(5);
  });

  it('flags once a single file is read >= threshold times with no write', () => {
    const d = new ReadStallDetector(15);
    let stalled = false;
    for (let i = 0; i < 15; i++) {
      if (d.registerRead('/repo/src/db.ts')) stalled = true;
    }
    expect(stalled).toBe(true);
    expect(d.readCount).toBe(15);
  });

  it('counts different files separately (no false stall)', () => {
    const d = new ReadStallDetector(3);
    expect(d.registerRead('/a.ts')).toBe(false);
    expect(d.registerRead('/b.ts')).toBe(false);
    expect(d.registerRead('/c.ts')).toBe(false);
    expect(d.registerRead('/a.ts')).toBe(false);
    expect(d.registerRead('/b.ts')).toBe(false);
  });

  it('a successful write resets the stall assumption', () => {
    const d = new ReadStallDetector(3);
    expect(d.registerRead('/a.ts')).toBe(false);
    expect(d.registerRead('/a.ts')).toBe(false);
    d.registerWrite();
    // Repeated reads while actively editing are fine — no stall.
    expect(d.registerRead('/a.ts')).toBe(false);
    expect(d.registerRead('/a.ts')).toBe(false);
    expect(d.registerRead('/a.ts')).toBe(false);
  });

  it('ignores reads with no path', () => {
    const d = new ReadStallDetector(2);
    expect(d.registerRead(undefined)).toBe(false);
    expect(d.registerRead(undefined)).toBe(false);
  });
});

describe('isGreenBuildTestClaim', () => {
  it('true for a green build claim', () => {
    expect(isGreenBuildTestClaim('Build: ✅ Passes (tsc --noEmit)')).toBe(true);
    expect(isGreenBuildTestClaim('Tests: ✅ 9/9 passing')).toBe(true);
    expect(isGreenBuildTestClaim('Both the build and tests are green.')).toBe(true);
  });

  it('false when no verify command is mentioned', () => {
    expect(isGreenBuildTestClaim('All tasks are complete and the code is clean.')).toBe(false);
  });

  it('false when a verify command is mentioned but no green outcome', () => {
    expect(isGreenBuildTestClaim('I ran npm run build and got errors.')).toBe(false);
  });
});

describe('isVerifyRunReport', () => {
  it('true for a successful verify run report', () => {
    expect(isVerifyRunReport('> npm run test\n ✓ 16 passed')).toBe(true);
  });

  it('false for a verify command with failures', () => {
    expect(isVerifyRunReport('> npm run build\nerror TS2375')).toBe(false);
  });
});

describe('fabricatedTestCountCorrection', () => {
  it('returns null when no actual count is known', () => {
    expect(fabricatedTestCountCorrection('All 21 tests passing', undefined)).toBeNull();
  });

  it('returns null when the claimed count matches the real run', () => {
    expect(fabricatedTestCountCorrection('All 9 tests passing', 9)).toBeNull();
  });

  it('flags a fabricated count that exceeds the real run', () => {
    const c = fabricatedTestCountCorrection('All 21 tests passing (9 validation + 3 greet + 9 validation.test.ts)', 9);
    expect(c).not.toBeNull();
    expect(c).toContain('21');
    expect(c).toContain('9');
  });

  it('flags a fabricated X/Y passing count', () => {
    const c = fabricatedTestCountCorrection('Tests: 35/35 passing', 9);
    expect(c).not.toBeNull();
  });

  it('does not flag a green claim without a concrete number', () => {
    expect(fabricatedTestCountCorrection('All tests are green and passing', 9)).toBeNull();
  });
});

describe('DivergenceDetector', () => {
  const reviewA =
    '#### 1. Project Architecture & Tech Stack Overview\n' +
    '| Layer | Technology | File Location(s) | Responsibilities |\n' +
    '| Frontend | Vanilla JS | public/script.js | client UI |\n' +
    '| Backend API | Express | src/server.ts | REST endpoints |\n' +
    '| Database | better-sqlite3 | data/prompts.db | persistence |';
  const reviewB = reviewA
    .replace('client UI', 'client UI.');

  it('does not flag the first block (no history)', () => {
    const d = new DivergenceDetector();
    expect(d.register(reviewA)).toBe(false);
  });

  it('flags a near-identical repeat of a prior block', () => {
    const d = new DivergenceDetector();
    d.register(reviewA);
    // Tiny wording tweaks should still be caught as a near-duplicate.
    expect(d.register(reviewB)).toBe(true);
  });

  it('does not flag a substantially different block', () => {
    const d = new DivergenceDetector();
    d.register(reviewA);
    const different =
      'Here is a short status note: I fixed the validation middleware and the tests now pass. ' +
      'The cache layer needs a reset hook. Next I will add the resetDbForTest call.';
    expect(d.register(different)).toBe(false);
  });

  it('ignores very short blocks (< 40 chars)', () => {
    const d = new DivergenceDetector();
    d.register('Done.');
    expect(d.register('Done.')).toBe(false);
  });

  it('resets its window on reset()', () => {
    const d = new DivergenceDetector();
    d.register(reviewA);
    d.reset();
    expect(d.register(reviewB)).toBe(false);
  });
});

describe('isStaleReadFailure', () => {
  it('detects a stale-read error from a patch failure', () => {
    const err = 'patch did not apply — [STALE READ] package.json was modified after you last read it. Use read_file to get the current content before patching.';
    const r = isStaleReadFailure('patch', err);
    expect(r.stale).toBe(true);
    expect(r.path).toContain('package.json');
  });

  it('detects old-string-not-found from write_file', () => {
    const err = 'Error: The string to replace was not found in D:/repo/src/server.ts';
    const r = isStaleReadFailure('write_file', err);
    expect(r.stale).toBe(true);
    expect(r.path).toContain('server.ts');
  });

  it('returns stale:false for a syntax error (not a stale read)', () => {
    const err = 'SyntaxError: Unexpected token (reverted to last-good state)';
    expect(isStaleReadFailure('patch', err).stale).toBe(false);
  });

  it('returns stale:false for non-write tools', () => {
    expect(isStaleReadFailure('read_file', 'old string not found').stale).toBe(false);
  });
});
