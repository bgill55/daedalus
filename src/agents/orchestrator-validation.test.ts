import { describe, it, expect } from 'vitest';
import { planNamesTestFiles } from './orchestrator-validation.js';

describe('planNamesTestFiles (spec-contract test intent)', () => {
  it('arms the lock when the goal explicitly names a test file', () => {
    expect(planNamesTestFiles('create tests/ui/debounce.test.ts')).toBe(true);
    expect(planNamesTestFiles('implement src/__tests__/loader.spec.js')).toBe(true);
    expect(planNamesTestFiles('add src/components/Button.test.tsx')).toBe(true);
    expect(planNamesTestFiles('fix tests/api/user.test.mjs')).toBe(true);
    expect(planNamesTestFiles('write test/integration.spec.cjs')).toBe(true);
  });

  it('does NOT arm the lock when the goal only mentions "tests" generically', () => {
    // These were the false-arms that let an empty test file through.
    expect(planNamesTestFiles('Implement the feature and add tests')).toBe(false);
    expect(planNamesTestFiles('Build the frontend and update tests')).toBe(false);
    expect(planNamesTestFiles('Write unit tests for the new logic')).toBe(false);
    expect(planNamesTestFiles('Implement src/ui/loading.ts')).toBe(false);
  });

  it('requires a concrete file, not just a directory name', () => {
    expect(planNamesTestFiles('refactor the tests directory')).toBe(false);
  });
});
