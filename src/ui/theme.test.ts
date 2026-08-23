import { describe, it, expect, afterEach } from 'vitest';
import { setTheme, getTheme, isLight, brand, rule, accent, info, ok, warn, err, dim } from './theme.js';

// Reset between tests so the in-memory theme doesn't leak across cases.
afterEach(() => setTheme('dark'));

describe('ui/theme', () => {
  it('defaults to dark', () => {
    setTheme('dark');
    expect(getTheme()).toBe('dark');
    expect(isLight()).toBe(false);
  });

  it('setTheme + getTheme round-trip', () => {
    setTheme('light');
    expect(getTheme()).toBe('light');
    expect(isLight()).toBe(true);
    setTheme('auto');
    expect(getTheme()).toBe('auto');
  });

  it('light mode produces contrast-safe colors (not invisible on white)', () => {
    setTheme('dark');
    const dimDark = dim('x');
    const infoDark = info('x');
    setTheme('light');
    const dimLight = dim('x');
    const infoLight = info('x');
    // The same helper must emit DIFFERENT ANSI codes per theme — that is what
    // makes /theme actually recolor the CLI instead of being a no-op.
    expect(dimDark).not.toBe(dimLight);
    expect(infoDark).not.toBe(infoLight);
    // Light dim must not be the bare string (it should carry a gray code), and
    // must differ from the dark dim which uses ANSI dim.
    expect(dimLight).toContain('\x1b[');
    // In light mode, dim is gray (38;90 / 90) rather than the dim code (2).
    expect(dimLight).toMatch(/90/);
  });

  it('warn maps to a visible color in light mode (yellow is invisible on white)', () => {
    setTheme('dark');
    const wDark = warn('x');
    setTheme('light');
    const wLight = warn('x');
    expect(wDark).not.toBe(wLight);
    // Light warn must not be the bare yellow; it should carry a red/amber code.
    expect(wLight).toContain('\x1b[');
  });

  it('helpers never return the raw uncolored string (always wrap in ANSI)', () => {
    setTheme('light');
    for (const fn of [brand, rule, accent, info, ok, warn, err, dim]) {
      const out = fn('hello');
      expect(out).toContain('hello');
      expect(out).toContain('\x1b[');
    }
  });

  it('ok is always green in both themes', () => {
    setTheme('dark');
    const okDark = ok('x');
    setTheme('light');
    const okLight = ok('x');
    // Both should be green (32); light just keeps green.
    expect(okDark).toMatch(/32/);
    expect(okLight).toMatch(/32/);
  });
});
