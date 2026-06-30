import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { patchFile, writeFile, listFiles, searchFiles } from './files.js';
import type { ToolContext } from '../../types.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-test-'));
}

function makeContext(projectRoot: string, withReadCache = false): ToolContext {
  return {
    projectRoot,
    autoApplyEdits: 'all',
    patchHistory: [],
    sessionReadCache: withReadCache ? new Map() : undefined,
    patchFailureStreak: withReadCache ? new Map() : undefined,
  } as unknown as ToolContext;
}

function makeContextWithRead(projectRoot: string, readFiles: string[]): ToolContext {
  const cache = new Map<string, number>();
  for (const f of readFiles) {
    if (fs.existsSync(f)) cache.set(f, fs.statSync(f).mtimeMs);
  }
  return {
    projectRoot,
    autoApplyEdits: 'all',
    patchHistory: [],
    sessionReadCache: cache,
    patchFailureStreak: new Map(),
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

describe('patchFile — write-without-read guardrail', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('auto-reads and allows patch if file not read this session', async () => {
    const file = path.join(tmpDir, 'guard.js');
    fs.writeFileSync(file, 'const x = 1;\n');
    const ctx = makeContext(tmpDir, true);

    const result = await patchFile(
      { path: file, old_string: 'const x = 1;', new_string: 'const x = 2;' },
      ctx,
    );

    expect(result.success).toBe(true);
  });

  it('allows patch if file was read first', async () => {
    const file = path.join(tmpDir, 'guard2.js');
    fs.writeFileSync(file, 'const x = 1;\n');
    const ctx = makeContextWithRead(tmpDir, [file]);

    const result = await patchFile(
      { path: file, old_string: 'const x = 1;', new_string: 'const x = 2;' },
      ctx,
    );

    expect(result.success).toBe(true);
  });

  it('auto-reads and allows write_file on existing file not read this session', async () => {
    const file = path.join(tmpDir, 'guard3.js');
    fs.writeFileSync(file, 'const x = 1;\n');
    const ctx = makeContext(tmpDir, true);

    const result = await writeFile(
      { path: file, content: 'const x = 2;\n' },
      ctx,
    );

    expect(result.success).toBe(true);
  });
});

describe('patchFile — circuit breaker', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('blocks after 2 consecutive failures', async () => {
    const file = path.join(tmpDir, 'cb.js');
    fs.writeFileSync(file, 'const x = 1;\n');
    const ctx = makeContextWithRead(tmpDir, [file]);

    await patchFile({ path: file, old_string: 'MISSING_STRING_1', new_string: '' }, ctx);
    await patchFile({ path: file, old_string: 'MISSING_STRING_2', new_string: '' }, ctx);

    const result = await patchFile({ path: file, old_string: 'MISSING_STRING_3', new_string: '' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/CIRCUIT BREAKER/);
  });

  it('resets streak after a successful patch', async () => {
    const file = path.join(tmpDir, 'cb2.js');
    fs.writeFileSync(file, 'const x = 1;\n');
    const ctx = makeContextWithRead(tmpDir, [file]);

    await patchFile({ path: file, old_string: 'MISSING', new_string: '' }, ctx);
    const ok = await patchFile({ path: file, old_string: 'const x = 1;', new_string: 'const x = 99;' }, ctx);
    expect(ok.success).toBe(true);

    const result = await patchFile({ path: file, old_string: 'MISSING_AGAIN', new_string: '' }, ctx);
    expect(result.error).not.toMatch(/CIRCUIT BREAKER/);
  });
});

describe('writeFile — import existence validation', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('warns about a hallucinated local import', async () => {
    const file = path.join(tmpDir, 'importer.js');
    const ctx = makeContext(tmpDir);

    const result = await writeFile(
      { path: file, content: "import { foo } from './nonexistent-module.js';\nexport { foo };\n" },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.content).toMatch(/Local import not found/);
  });

  it('does not warn for valid local imports', async () => {
    const dep = path.join(tmpDir, 'real.js');
    fs.writeFileSync(dep, 'export const bar = 1;\n');
    const file = path.join(tmpDir, 'importer2.js');
    const ctx = makeContext(tmpDir);

    const result = await writeFile(
      { path: file, content: "import { bar } from './real.js';\nexport { bar };\n" },
      ctx,
    );

    expect(result.content).not.toMatch(/Local import not found/);
  });
});

describe('writeFile — export consistency check', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('warns when exporting a name not defined in the file', async () => {
    const file = path.join(tmpDir, 'exports.js');
    const ctx = makeContext(tmpDir);

    const result = await writeFile(
      { path: file, content: 'const x = 1;\nexport { x, ghostFunction };\n' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.content).toMatch(/ghostFunction.*is not defined/);
  });

  it('does not warn when all exported names are defined', async () => {
    const file = path.join(tmpDir, 'exports2.js');
    const ctx = makeContext(tmpDir);

    const result = await writeFile(
      { path: file, content: 'const x = 1;\nfunction doThing() {}\nexport { x, doThing };\n' },
      ctx,
    );

    expect(result.content).not.toMatch(/is not defined/);
  });
});

describe('listFiles and searchFiles — directory exclusions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    // Create some normal files
    fs.writeFileSync(path.join(tmpDir, 'allowed.txt'), 'hello world');
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'main.js'), 'console.log(1);');

    // Create some excluded directories and files inside them
    fs.mkdirSync(path.join(tmpDir, '.git'));
    fs.writeFileSync(path.join(tmpDir, '.git', 'COMMIT_EDITMSG'), 'fix everything');
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'dep.js'), 'module.exports = {}');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('excludes standard ignored folders from listFiles results', async () => {
    const ctx = makeContext(tmpDir);
    const result = await listFiles({ path: tmpDir }, ctx);
    expect(result.success).toBe(true);
    expect(result.content).toContain('allowed.txt');
    expect(result.content).toContain(path.join('src', 'main.js'));
    expect(result.content).not.toContain('.git');
    expect(result.content).not.toContain('node_modules');
  });

  it('excludes standard ignored folders from searchFiles (target=files) results', async () => {
    const ctx = makeContext(tmpDir);
    const result = await searchFiles({ pattern: '**', target: 'files', path: tmpDir }, ctx);
    expect(result.success).toBe(true);
    expect(result.content).toContain('allowed.txt');
    expect(result.content).toContain(path.join('src', 'main.js'));
    expect(result.content).not.toContain('.git');
    expect(result.content).not.toContain('node_modules');
  });

  it('excludes standard ignored folders from searchFiles content search', async () => {
    const ctx = makeContext(tmpDir);
    const resultAllowed = await searchFiles({ pattern: 'hello', path: tmpDir }, ctx);
    expect(resultAllowed.success).toBe(true);
    expect(resultAllowed.content).toContain('allowed.txt');

    const resultExcluded = await searchFiles({ pattern: 'fix everything', path: tmpDir }, ctx);
    expect(resultExcluded.success).toBe(true);
    expect(resultExcluded.content).toBe('(no matches)');
  });

  it('truncates file listing when output exceeds limit', async () => {
    const ctx = makeContext(tmpDir);
    // Create 5 temporary files
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(tmpDir, `file_${i}.txt`), 'test');
    }
    const result = await listFiles({ path: tmpDir, limit: 3 }, ctx);
    expect(result.success).toBe(true);
    expect(result.content).toContain('file_0.txt');
    expect(result.content).toContain('truncated');
    expect(result.content).toContain('more files found');
  });
});


