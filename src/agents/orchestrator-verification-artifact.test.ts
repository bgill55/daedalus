import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import {
  verifyArtifactsThoroughly,
  isRealFile,
  extractPromisedPaths,
} from './orchestrator-verification.js';
import type { ToolContext } from '../types.js';

const origCwd = process.cwd();
let dir: string;

function write(rel: string, content: string): string {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

function makeCtx(root: string, history: { filePath: string }[] = []): ToolContext {
  return { projectRoot: root, patchHistory: history as ToolContext['patchHistory'] } as ToolContext;
}

describe('artifact completeness gate', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'daedalus-artifact-'));
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(origCwd);
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('isRealFile: rejects missing, empty, and stub files', () => {
    expect(isRealFile(join(dir, 'nope.ts'))).toBe(false);
    write('empty.ts', '');
    expect(isRealFile(join(dir, 'empty.ts'))).toBe(false);
    write('stub.ts', '// TODO');
    expect(isRealFile(join(dir, 'stub.ts'))).toBe(false);
  });

  it('isRealFile: accepts a real non-trivial file', () => {
    write('real.ts', 'export const x = 1;\n// enough real content to clear the 100-byte floor used to reject stubs\nconsole.log(x);\n');
    expect(isRealFile(join(dir, 'real.ts'))).toBe(true);
  });

  it('extractPromisedPaths pulls file paths out of a goal', () => {
    const paths = extractPromisedPaths('create src/ui/loading.ts with a spinner');
    expect(paths).toContain('src/ui/loading.ts');
  });

  it('GATE: empty promised file -> task NOT verified (the debounce.test.ts bug)', () => {
    const f = write('tests/ui/debounce.test.ts', ''); // 0 bytes, like the real bug
    const ctx = makeCtx(dir, [{ filePath: f }]);
    const ok = verifyArtifactsThoroughly(
      ctx,
      'coder',
      'create tests/ui/debounce.test.ts with debounce tests',
      'I created tests/ui/debounce.test.ts',
      0,
    );
    expect(ok).toBe(false);
  });

  it('GATE: real promised file -> task verified', () => {
    const f = write('src/ui/loading.ts', 'export function loading() {\n  // real implementation, enough content to clear the 100-byte stub floor\n  return "loading";\n}\n');
    const ctx = makeCtx(dir, [{ filePath: f }]);
    const ok = verifyArtifactsThoroughly(
      ctx,
      'coder',
      'create src/ui/loading.ts',
      'I created src/ui/loading.ts',
      0,
    );
    expect(ok).toBe(true);
  });

  it('GATE: stub promised file -> task NOT verified', () => {
    const f = write('src/ui/loading.ts', '// add content here');
    const ctx = makeCtx(dir, [{ filePath: f }]);
    const ok = verifyArtifactsThoroughly(
      ctx,
      'coder',
      'create src/ui/loading.ts',
      'I created src/ui/loading.ts',
      0,
    );
    expect(ok).toBe(false);
  });

  it('non-coder roles are not gated', () => {
    const ok = verifyArtifactsThoroughly(makeCtx(dir), 'researcher', 'research the API', 'done', 0);
    expect(ok).toBe(true);
  });
});
