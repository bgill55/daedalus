import { describe, it, expect } from 'vitest';
import { DAEDALUS_CONSTITUTION, getConstitutionSummary } from './constitution.js';

describe('Daedalus Constitution', () => {
  it('defines required core constitutional principles', () => {
    expect(DAEDALUS_CONSTITUTION.length).toBeGreaterThanOrEqual(5);
    const ids = DAEDALUS_CONSTITUTION.map(p => p.id);
    expect(ids).toContain('TEST_SUITE_INTEGRITY');
    expect(ids).toContain('PREFLIGHT_DEPENDENCY_VERIFICATION');
    expect(ids).toContain('DETERMINISTIC_VERIFICATION');
    expect(ids).toContain('NON_DESTRUCTIVE_ROLLBACK');
    expect(ids).toContain('DIFF_IMMUNITY_AUDIT');
  });

  it('generates a human-readable constitution summary', () => {
    const summary = getConstitutionSummary();
    expect(summary).toContain('Test Suite Integrity');
    expect(summary).toContain('Diff Immunity Audit');
  });
});
