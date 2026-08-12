import { describe, it, expect } from 'vitest';
import { TOKEN_TIERS, tierFor, emit, emitPrompt } from './emit.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(__dirname, '..', '..');

// Walk src/ and collect every non-test source file so we can statically assert
// that no CURATED token is ever painted in a color that disagrees with
// TOKEN_TIERS. App-specific section labels ([INFO], [AGENT], [HUNT],
// [AUTOPILOT], [VERIFY], [TUI], ...) are intentionally NOT in TOKEN_TIERS and
// are exempt — they keep their own conventions. This test makes the
// mis-coloring class of bug non-mergeable: a future edit that writes
// pc.red('[WARN] ...') fails CI.
function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectTsFiles(full, acc);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) acc.push(full);
  }
  return acc;
}

const COLOR_FN: Record<string, 'info' | 'progress' | 'prompt' | 'warn' | 'error'> = {
  'pc.dim': 'info',
  'pc.cyan': 'progress',
  'pc.blue': 'prompt',
  'pc.yellow': 'warn',
  'pc.red': 'error',
};

// Matches: pc.<color>( `<text> [TOKEN]`  — captures the color, the text before
// the token (which may itself contain a [TOKEN]), and the final [TOKEN].
const TOKEN_RE = /(?:pc\.(dim|cyan|blue|yellow|red))\(\s*[`']((?:[^`'"]|\\.)*?)(\[[A-Z ]+\])/g;

describe('curated token color tiers (contract)', () => {
  const files = collectTsFiles(SRC_ROOT);
  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const rel = file.replace(SRC_ROOT, 'src');
    it(`respects curated token tiers in ${rel}`, () => {
      const bad: string[] = [];
      let m: RegExpExecArray | null;
      TOKEN_RE.lastIndex = 0;
      while ((m = TOKEN_RE.exec(src)) !== null) {
        const fn = m[1];
        const token = m[3];
        // Only enforce tokens that are part of the calm contract.
        if (!(token in TOKEN_TIERS)) continue;
        const paintedTier = COLOR_FN[`pc.${fn}`];
        const expectedTier = tierFor(token);
        if (paintedTier !== expectedTier) {
          bad.push(`${fn} -> ${token} (expected ${expectedTier})`);
        }
      }
      expect(bad, `mis-colored curated tokens in ${rel}: ${bad.join(', ')}`).toEqual([]);
    });
  }
});

describe('emit', () => {
  it('resolves unknown tokens to info tier (never an alarm)', () => {
    expect(tierFor('[NEWTHING]')).toBe('info');
  });
  it('keeps [WARN] as warn and [ERROR] as error', () => {
    expect(tierFor('[WARN]')).toBe('warn');
    expect(tierFor('[ERROR]')).toBe('error');
  });
  it('maps routine tokens ([RETRY]/[CHECK]/[ROLLBACK]) to info', () => {
    expect(tierFor('[RETRY]')).toBe('info');
    expect(tierFor('[CHECK]')).toBe('info');
    expect(tierFor('[ROLLBACK]')).toBe('info');
  });
  it('emit prints the token + message', () => {
    const out: string[] = [];
    const orig = console.log;
    console.log = (s: string) => out.push(s);
    try {
      emit('[CHECK]', 'verification held');
    } finally {
      console.log = orig;
    }
    expect(out[0]).toContain('[CHECK]');
    expect(out[0]).toContain('verification held');
  });
  it('emitPrompt writes the token without a trailing newline', () => {
    const out: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout.write as unknown) = (s: string) => {
      out.push(s);
      return true;
    };
    try {
      emitPrompt('[TEST SUITE LOCK]', 'allow? (y/N): ');
    } finally {
      (process.stdout.write as unknown) = orig;
    }
    expect(out[0]).toContain('[TEST SUITE LOCK]');
  });
});
