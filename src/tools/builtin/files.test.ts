import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { patchFile, writeFile, listFiles, searchFiles, readFile } from './files.js';

vi.mock('../../config/index.js', () => ({
  loadConfig: vi.fn(),
}));

import { loadConfig } from '../../config/index.js';

vi.mock('pdf-parse', () => {
  return {
    PDFParse: class {
      getText() {
        return Promise.resolve({
          text: 'Mocked PDF Content Line 1\nMocked PDF Content Line 2'
        });
      }
    }
  };
});
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

describe('patchFile — Unicode punctuation normalization', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('matches old_string using a hyphen against a file containing an en-dash', async () => {
    // The file uses an en-dash (U+2013) in the comment; the agent's old_string uses a
    // regular hyphen. Previously this failed with "Old string not found"; now it should
    // match and apply, preserving the original en-dash byte in untouched regions.
    const file = path.join(tmpDir, 'test.js');
    fs.writeFileSync(file, '// Start listening (optional \u2013 caller may also listen)\nconst x = 1;\n');
    const ctx = makeContext(tmpDir);

    const result = await patchFile(
      { path: file, old_string: '// Start listening (optional - caller may also listen)\nconst x = 1;', new_string: '// Start listening (optional \u2013 caller may also listen)\nconst x = 2;' },
      ctx,
    );

    expect(result.success).toBe(true);
    const after = fs.readFileSync(file, 'utf8');
    expect(after).toContain('const x = 2;');
    expect(after).toContain('\u2013'); // original en-dash preserved
  });

  it('matches straight quotes against smart quotes in old_string', async () => {
    const file = path.join(tmpDir, 'test.js');
    fs.writeFileSync(file, 'const msg = \u201Chello\u201D;\n');
    const ctx = makeContext(tmpDir);

    const result = await patchFile(
      { path: file, old_string: 'const msg = "hello";', new_string: 'const msg = "hi";' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('const msg = "hi";');
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

  it('updates cache after successful write to allow consecutive edits without stale read', async () => {
    const file = path.join(tmpDir, 'consecutive.js');
    fs.writeFileSync(file, 'const x = 1;\n');
    const ctx = makeContextWithRead(tmpDir, [file]);

    const r1 = await patchFile(
      { path: file, old_string: 'const x = 1;', new_string: 'const x = 2;' },
      ctx,
    );
    expect(r1.success).toBe(true);

    const r2 = await patchFile(
      { path: file, old_string: 'const x = 2;', new_string: 'const x = 3;' },
      ctx,
    );
    expect(r2.success).toBe(true);
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
    expect(result.error).toMatch(/CIRCUIT BREAKER|PAUSED/);
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

  it('resets streak after calling readFile', async () => {
    const file = path.join(tmpDir, 'cb_reset_read.js');
    fs.writeFileSync(file, 'const x = 1;\n');
    const ctx = makeContextWithRead(tmpDir, [file]);

    await patchFile({ path: file, old_string: 'MISSING_1', new_string: '' }, ctx);
    await patchFile({ path: file, old_string: 'MISSING_2', new_string: '' }, ctx);

    const blocked = await patchFile({ path: file, old_string: 'const x = 1;', new_string: 'const x = 2;' }, ctx);
    expect(blocked.success).toBe(false);
    expect(blocked.error).toMatch(/CIRCUIT BREAKER|PAUSED/);

    await readFile({ path: file }, ctx);

    const ok = await patchFile({ path: file, old_string: 'const x = 1;', new_string: 'const x = 2;' }, ctx);
    expect(ok.success).toBe(true);
  });

  it('refuses to read .env / credential files', async () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n');
    const ctx = makeContextWithRead(tmpDir, []);
    const result = await readFile({ path: '.env' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/credential file/i);
  });

  it('refuses to write .env / credential files', async () => {
    const ctx = makeContextWithRead(tmpDir, []);
    const result = await writeFile({ path: '.env', content: 'GITHUB_TOKEN=github_pat_xxx' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/credential file/i);
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

  it('does not warn when ESM .js import resolves to a .ts file', async () => {
    const dep = path.join(tmpDir, 'types.ts');
    fs.writeFileSync(dep, 'export interface Foo { bar: string; }\n');
    const file = path.join(tmpDir, 'consumer.ts');
    const ctx = makeContext(tmpDir);

    const result = await writeFile(
      { path: file, content: "import type { Foo } from './types.js';\nexport const x: Foo = { bar: '1' };\n" },
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

describe('readFile — PDF support', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('correctly reads and parses a PDF file', async () => {
    const file = path.join(tmpDir, 'test.pdf');
    // Write mock binary PDF content
    fs.writeFileSync(file, '%PDF-1.4 mock binary content');
    const ctx = makeContext(tmpDir);

    const result = await readFile({ path: file }, ctx);
    expect(result.success).toBe(true);
    expect(result.content).toContain('1|Mocked PDF Content Line 1');
    expect(result.content).toContain('2|Mocked PDF Content Line 2');
  });
});

describe('readFile — Image support', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('correctly reads an image file and returns base64 vision payload', async () => {
    const file = path.join(tmpDir, 'test.png');
    fs.writeFileSync(file, 'mock image bytes');
    const ctx = makeContext(tmpDir);

    const result = await readFile({ path: file }, ctx);
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed.type).toBe('vision');
    expect(parsed.mimeType).toBe('image/png');
    expect(parsed.base64).toBe(Buffer.from('mock image bytes').toString('base64'));
  });
});

describe('writeFile — Absolute path cross-project support', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('allows writing new files to an absolute path when parent directory exists', async () => {
    const subDir = path.join(tmpDir, 'other-project');
    fs.mkdirSync(subDir, { recursive: true });
    const newFile = path.join(subDir, 'new-file.txt');

    const ctx = makeContext(tmpDir);
    const result = await writeFile({ path: newFile, content: 'hello world' }, ctx);
    expect(result.success).toBe(true);
    expect(fs.readFileSync(newFile, 'utf8')).toBe('hello world');
  });
});

describe('dependency manifest checkpoint', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    (loadConfig as any).mockReturnValue({ safety: { protectGit: true } });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function initGitRepo(): void {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.email test@daedalus.local', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.name "Daedalus Test"', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config core.autocrlf false', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'seed.txt'), 'seed\n');
    execSync('git add .', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'seed.txt'), 'changed\n');
  }

  it('appends a checkpoint note when writing package.json in a git repo', async () => {
    initGitRepo();
    const file = path.join(tmpDir, 'package.json');
    const ctx = makeContext(tmpDir);

    const result = await writeFile({ path: file, content: '{ "name": "x", "version": "1.0.0" }' }, ctx);

    expect(result.success).toBe(true);
    expect(result.content).toMatch(/\[CHECKPOINT\] Git snapshot created before install:/);
    expect(result.content).toContain('roll back with: git checkout');
  });

  it('does not append a checkpoint note for non-manifest files', async () => {
    initGitRepo();
    const file = path.join(tmpDir, 'notes.txt');
    const ctx = makeContext(tmpDir);

    const result = await writeFile({ path: file, content: 'hello' }, ctx);

    expect(result.success).toBe(true);
    expect(result.content).not.toContain('[CHECKPOINT]');
  });

  it('appends a checkpoint note when patching a manifest file in a git repo', async () => {
    initGitRepo();
    const file = path.join(tmpDir, 'package.json');
    fs.writeFileSync(file, '{ "name": "x", "version": "1.0.0" }\n');
    execSync('git add package.json', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m pkg', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(file, '{ "name": "x", "version": "2.0.0" }\n');
    const ctx = makeContext(tmpDir);

    const result = await patchFile(
      { path: file, old_string: '"version": "2.0.0"', new_string: '"version": "3.0.0"' },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain('[CHECKPOINT]');
  });
});

describe('actionable error guidance', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('patch suggests read_file or write_file when old_string not found', async () => {
    const file = path.join(tmpDir, 'mismatch.js');
    fs.writeFileSync(file, 'const x = 42;\n');
    const ctx = makeContext(tmpDir);

    const result = await patchFile(
      { path: file, old_string: 'zzz_completely_unrelated_zzz', new_string: '' },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Old string not found");
    expect(result.error).toContain("Hint: Use read_file to inspect the exact current lines, or use write_file if replacing the entire file.");
  });

  it('write_file suggests read_file when the stale-read guard fires', async () => {
    const file = path.join(tmpDir, 'stale.js');
    fs.writeFileSync(file, 'const a = 1;\n');
    // Seed the read cache with an old mtime so the write-without-read guard trips.
    const ctx = makeContextWithRead(tmpDir, [file]);
    // Force a stale read: the cache holds mtime 0 while the file was just rewritten.
    ctx.sessionReadCache!.set(file, 0);
    // Mutate the file on disk (simulating external change) after the cached read.
    fs.writeFileSync(file, 'const a = 2;\n');

    const result = await writeFile({ path: file, content: 'const a = 3;\n' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('[STALE READ]');
    expect(result.error).toContain('Hint: Call read_file on this file first to update your context before writing.');
  });
});


