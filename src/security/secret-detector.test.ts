import { describe, it, expect } from 'vitest';
import { maskSecrets, findSecrets, scanDiffForSecrets, REDACTED_SECRET } from './secret-detector.js';

// Fixtures are built at runtime by concatenating a provider prefix with a
// filler so no scannable token literal exists in this source file (GitHub
// secret scanning inspects committed text, not runtime strings). The filler
// is low-entropy and clearly fake; it only needs to satisfy the detector's
// length/shape rules.
const filler = (n: number): string => 'A'.repeat(n);
const tok = (prefix: string, n: number): string => prefix + filler(n);

describe('secret-detector', () => {
  it('masks github tokens', () => {
    const t = tok('ghp_', 36);
    expect(maskSecrets(`token ${t} end`)).toBe(`token ${REDACTED_SECRET} end`);
  });

  it('masks openai sk- and sk-proj- keys', () => {
    expect(maskSecrets(`key ${tok('sk-proj-', 28)}`)).toBe(`key ${REDACTED_SECRET}`);
    expect(maskSecrets(`key ${tok('sk-', 22)}`)).toBe(`key ${REDACTED_SECRET}`);
  });

  it('masks stripe keys', () => {
    expect(maskSecrets(tok('rk_live_', 24))).toBe(REDACTED_SECRET);
    expect(maskSecrets(tok('sk_test_', 24))).toBe(REDACTED_SECRET);
  });

  it('masks anthropic keys', () => {
    expect(maskSecrets(tok('sk-ant-', 28))).toBe(REDACTED_SECRET);
  });

  it('masks aws access key ids', () => {
    expect(maskSecrets(tok('AKIA', 16))).toBe(REDACTED_SECRET);
  });

  it('masks bearer tokens', () => {
    expect(maskSecrets(`Authorization: Bearer ${filler(36)}`)).toBe(
      `Authorization: ${REDACTED_SECRET}`
    );
  });

  it('masks private key blocks', () => {
    const out = maskSecrets('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----');
    expect(out).toContain(REDACTED_SECRET);
    expect(out).toContain('-----END RSA PRIVATE KEY-----');
  });

  it('leaves benign text untouched', () => {
    const text = 'const x = 123; console.log("hello world");';
    expect(maskSecrets(text)).toBe(text);
  });

  it('does not mask inside ordinary variable names', () => {
    expect(maskSecrets('let skillCount = 5;')).toBe('let skillCount = 5;');
  });

  it('findSecrets detects presence', () => {
    expect(findSecrets(tok('ghp_', 36))).toBe(true);
    expect(findSecrets('nothing here')).toBe(false);
  });

  it('scanDiffForSecrets only flags added lines', () => {
    const secret = tok('sk-proj-', 28);
    const diff = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      `+const key = "${secret}";`,
      '-const key = "old-removed-secret-sk-AAAAAAAAAAAAAAAAAAAA";',
      ' context line with sk-AAAAAAAAAAAAAAAAAAAA unchanged',
    ].join('\n');
    const hits = scanDiffForSecrets(diff);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('sk-proj-');
  });

  it('scanDiffForSecrets returns [] on empty diff', () => {
    expect(scanDiffForSecrets('')).toEqual([]);
  });
});
