import { describe, it, expect } from 'vitest';
import { ReadStallDetector, isGreenBuildTestClaim, isVerifyRunReport, fabricatedTestCountCorrection } from './loop-guards.js';

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
