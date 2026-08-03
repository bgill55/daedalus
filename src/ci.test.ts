import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the terminal tool so npm test / lint / tsc don't actually run
vi.mock('./tools/builtin/terminal.js', () => ({
  execute: vi.fn(async ({ command }: { command: string }) => {
    if (command.includes('tsc')) return { success: true, content: '', error: '' };
    if (command.includes('lint')) return { success: true, content: '', error: '' };
    if (command.includes('npm test')) return { success: true, content: 'All tests passed', error: '' };
    if (command.includes('git diff')) return { success: true, content: '', error: '' };
    return { success: true, content: '', error: '' };
  }),
}));

// Mock the router so the AI semantic analysis doesn't make real API calls
vi.mock('./router/index.js', () => ({
  createRouter: vi.fn(() => ({
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: 'No semantic issues found.' } }],
        })),
      },
    },
  })),
}));

vi.mock('./config/index.js', () => ({
  loadConfig: vi.fn(() => ({ router: { chain: [] } })),
}));

import { runHeadlessCiReview, runHeadlessCiFix } from './ci.js';
import { runStaticChecks } from './review/static-checks.js';

describe('Headless CI Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runHeadlessCiReview returns structured review result', async () => {
    const result = await runHeadlessCiReview(process.cwd());
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('typeCheckPassed');
    expect(result).toHaveProperty('lintPassed');
    expect(result).toHaveProperty('testsPassed');
    expect(result).toHaveProperty('staticPassed');
    expect(result).toHaveProperty('markdownReport');
    expect(result.markdownReport).toContain('Daedalus Automated PR Review');
  });

  it('runHeadlessCiReview passes when all checks succeed', async () => {
    const result = await runHeadlessCiReview(process.cwd());
    expect(result.typeCheckPassed).toBe(true);
    expect(result.lintPassed).toBe(true);
    expect(result.testsPassed).toBe(true);
    expect(result.staticPassed).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('runHeadlessCiReview report includes all check sections', async () => {
    const result = await runHeadlessCiReview(process.cwd());
    expect(result.markdownReport).toContain('Type Check');
    expect(result.markdownReport).toContain('Linter');
    expect(result.markdownReport).toContain('Test Suite');
    expect(result.markdownReport).toContain('Static Analysis');
  });

  it('runHeadlessCiFix handles auto-fix check cleanly', async () => {
    const fixResult = await runHeadlessCiFix(process.cwd());
    expect(fixResult).toHaveProperty('success');
    expect(fixResult).toHaveProperty('message');
    expect(typeof fixResult.success).toBe('boolean');
    expect(typeof fixResult.message).toBe('string');
  });
});

describe('Daedalus Static Checks', () => {
  const diffFor = (file: string, added: string[]) => {
    const lines = [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, `@@ -1,1 +1,${added.length} @@`];
    added.forEach((a) => lines.push(`+${a}`));
    return lines.join('\n');
  };

  it('flags an empty catch block as an error (no-silent-catch)', () => {
    const diff = diffFor('scripts/sync-docs.ts', [
      'function copy() {',
      '  try { doThing(); } catch { }',
      '}',
    ]);
    const res = runStaticChecks(diff);
    expect(res.passed).toBe(false);
    expect(res.findings.some(f => f.rule === 'no-silent-catch' && f.severity === 'error')).toBe(true);
  });

  it('flags a default export as a warning', () => {
    const diff = diffFor('src/foo.ts', ['export default function foo() {}']);
    const res = runStaticChecks(diff);
    expect(res.passed).toBe(true);
    expect(res.findings.some(f => f.rule === 'no-default-export')).toBe(true);
  });

  it('flags explicit any in added lines as a warning', () => {
    const diff = diffFor('src/bar.ts', ['const x: any = {};']);
    const res = runStaticChecks(diff);
    expect(res.findings.some(f => f.rule === 'no-explicit-any')).toBe(true);
  });

  it('flags a missing .js extension on a relative ESM import as a warning', () => {
    const diff = diffFor('src/baz.ts', ["import { thing } from './thing';"]);
    const res = runStaticChecks(diff);
    expect(res.findings.some(f => f.rule === 'esm-import-extension')).toBe(true);
  });

  it('passes a clean diff with no anti-patterns', () => {
    const diff = diffFor('src/qux.ts', [
      "import { thing } from './thing.js';",
      'export function run(): void {',
      '  try { thing(); } catch (err) { console.error(err); }',
      '}',
    ]);
    const res = runStaticChecks(diff);
    expect(res.passed).toBe(true);
    expect(res.findings).toHaveLength(0);
  });

  it('skips test files so the review never flags its own specs', () => {
    const diff = diffFor('src/ci.test.ts', [
      'export default function foo() {}',
      'const x: any = {};',
      'try { a(); } catch { }',
    ]);
    const res = runStaticChecks(diff);
    expect(res.findings).toHaveLength(0);
    expect(res.passed).toBe(true);
  });

  it('flags a missing .js extension in a .js file (not just .ts)', () => {
    const diff = diffFor('scripts/tool.js', ["import { x } from './x';"]);
    const res = runStaticChecks(diff);
    const f = res.findings.find(f => f.rule === 'esm-import-extension');
    expect(f).toBeDefined();
    expect(f?.message).toContain("'./x'");
  });

  it('reports the correct captured import path (no undefined)', () => {
    const diff = diffFor('src/baz.ts', ["import { thing } from './thing';"]);
    const res = runStaticChecks(diff);
    const f = res.findings.find(f => f.rule === 'esm-import-extension');
    expect(f?.message).toContain("'./thing'");
    expect(f?.message).not.toContain('undefined');
  });

  it('returns no findings for an empty diff', () => {
    const res = runStaticChecks('');
    expect(res.passed).toBe(true);
    expect(res.findings).toHaveLength(0);
  });
});
