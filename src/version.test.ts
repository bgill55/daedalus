import { describe, it, expect } from 'vitest';
import { isValidSemver } from './version.js';

describe('isValidSemver', () => {
  it('accepts valid SemVer version strings', () => {
    expect(isValidSemver('0.0.0')).toBe(true);
    expect(isValidSemver('1.93.0')).toBe(true);
    expect(isValidSemver('2.0.1-beta.2')).toBe(true);
    expect(isValidSemver('1.93.0-canary')).toBe(true);
    expect(isValidSemver('1.0.0-alpha-1')).toBe(true);
  });

  it('rejects invalid version strings', () => {
    expect(isValidSemver('')).toBe(false);
    expect(isValidSemver('1.2')).toBe(false);
    expect(isValidSemver('1.2.3.4')).toBe(false);
    expect(isValidSemver('v1.0.0')).toBe(false);
    expect(isValidSemver('1.93.0+001')).toBe(false);
    expect(isValidSemver('01.2.3')).toBe(false);
  });
});
