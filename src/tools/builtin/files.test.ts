import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { patchFile, writeFile } from './files.js';
import type { ToolContext } from '../../types.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-test-'));
}

function makeContext(projectRoot: string): ToolContext {
  return {
    projectRoot,
    autoApplyEdits: 'all',
    patchHistory: [],
  } as unknown as ToolContext;
}

describe('patchFile — fuzzy whitespace matching', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('applies patch when indentation differs by extra spaces', async () => {
    const file = path.join(tmpDir, 'test.js');
    fs.writeFileSync(file, 'function foo() {\n  return 1;\n}\n');
    const ctx = makeContext(tmpDir);

    const result = await patchFile(
      { path: file, old_string: 'function foo() {\n   return 1;\n}', new_string: 'function foo() {\n  return 2;\n}' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('return 2');
  });

  it('rejects ambiguous fuzzy match with multiple candidates', async () => {
    const file = path.join(tmpDir, 'test.js');
    fs.writeFileSync(file, 'const a = 1;\nconst b = 1;\n');
    const ctx = makeContext(tmpDir);

    const result = await patchFile(
      { path: file, old_string: 'const x = 1;', new_string: 'const x = 2;' },
      ctx,
    );

    expect(result.success).toBe(false);
  });
});

describe('patchFile — context-aware hint on failure', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns a closest-match hint when old_string is close but not exact', async () => {
    const file = path.join(tmpDir, 'hint.js');
    fs.writeFileSync(file, 'function greet(name) {\n  return "Hello " + name;\n}\n');
    const ctx = makeContext(tmpDir);

    const result = await patchFile(
      { path: file, old_string: 'function greet(user) {\n  return "Hello " + user;\n}', new_string: 'function greet(name) {\n  return `Hello ${name}`;\n}' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Closest match found at line/);
    expect(result.error).toMatch(/greet/);
  });

  it('returns no-close-match message when old_string is completely unrelated', async () => {
    const file = path.join(tmpDir, 'nohint.js');
    fs.writeFileSync(file, 'const x = 42;\n');
    const ctx = makeContext(tmpDir);

    const result = await patchFile(
      { path: file, old_string: 'zzz_completely_unrelated_zzz', new_string: '' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No close match found/);
  });
});

describe('writeFile — syntax validation', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('rejects and reverts a JS file with a syntax error', async () => {
    const file = path.join(tmpDir, 'broken.js');
    const original = 'const x = 1;\n';
    fs.writeFileSync(file, original);
    const ctx = makeContext(tmpDir);

    const result = await writeFile(
      { path: file, content: 'const x = {\n  // missing closing brace\n' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Syntax error/);
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });

  it('accepts a valid JS file', async () => {
    const file = path.join(tmpDir, 'valid.js');
    const ctx = makeContext(tmpDir);

    const result = await writeFile(
      { path: file, content: 'const x = 1;\nexport { x };\n' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('rejects and removes a new JSON file with invalid content', async () => {
    const file = path.join(tmpDir, 'bad.json');
    const ctx = makeContext(tmpDir);

    const result = await writeFile(
      { path: file, content: '{ "key": "value", }' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/JSON syntax error/);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('accepts valid JSON', async () => {
    const file = path.join(tmpDir, 'good.json');
    const ctx = makeContext(tmpDir);

    const result = await writeFile(
      { path: file, content: '{ "key": "value" }' },
      ctx,
    );

    expect(result.success).toBe(true);
  });
});
