import { describe, it, expect } from 'vitest';
import { extractErrorLines, normalizeErrorLine, syntaxCheck, preflightDependencyCheck, recordRevert, recordWriteSuccess, checkGlobalPatchBreaker, buildRemovedSymbolHint } from './patch-utils.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('extractErrorLines', () => {
  it('extracts TS error lines and drops deprecation errors', () => {
    const output = [
      'src/a.ts(10,5): error TS2322: Type "A" is not assignable to type "B".',
      'src/b.ts(2,1): error TS2375: blah',
      'tsconfig.json(3,8): error TS5023: Unknown compiler option.',
      'some noise',
      '',
    ].join('\n');
    const errors = extractErrorLines(output);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('TS2322');
    expect(errors[1]).toContain('TS2375');
  });

  it('returns empty for clean output', () => {
    expect(extractErrorLines('Compilation complete.')).toEqual([]);
  });
});

describe('normalizeErrorLine', () => {
  it('strips line/column so shifted pre-existing errors still match', () => {
    const a = normalizeErrorLine('src/db.ts(50,1): error TS2322: Type "X" is not assignable to type "Y".');
    const b = normalizeErrorLine('src/db.ts(60,1): error TS2322: Type "X" is not assignable to type "Y".');
    expect(a).toBe(b);
  });

  it('keeps distinct errors distinct', () => {
    const a = normalizeErrorLine('src/db.ts(50,1): error TS2322: Type "X" is not assignable to type "Y".');
    const b = normalizeErrorLine('src/db.ts(50,1): error TS2322: Type "X" is not assignable to type "Z".');
    expect(a).not.toBe(b);
  });
});

describe('syntaxCheck file-scoping', () => {
  function makeProject() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-syntax-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
    }));
    // broken.ts has a pre-existing error; good.ts is clean
    fs.writeFileSync(path.join(dir, 'broken.ts'), 'export const x: number = "not a number";\n');
    fs.writeFileSync(path.join(dir, 'good.ts'), 'export const y: number = 1;\n');
    return dir;
  }

  it('does not revert a valid edit to a clean file in a project with another broken file', async () => {
    const dir = makeProject();
    const good = path.join(dir, 'good.ts');
    const orig = fs.readFileSync(good, 'utf8');
    fs.writeFileSync(good, orig + 'export const z: number = 2;\n');
    const err = await syntaxCheck(good, dir, orig + 'export const z: number = 2;\n', orig);
    fs.writeFileSync(good, orig);
    expect(err).toBeNull();
  });

  it('catches a genuinely broken edit and reports it scoped to the file', async () => {
    const dir = makeProject();
    const good = path.join(dir, 'good.ts');
    const orig = fs.readFileSync(good, 'utf8');
    fs.writeFileSync(good, orig + 'export const z: number = ;\n');
    const err = await syntaxCheck(good, dir, orig + 'export const z: number = ;\n', orig);
    fs.writeFileSync(good, orig);
    expect(err).not.toBeNull();
    expect(err).toContain('good.ts');
  });

  it('does NOT false-revert a valid edit that imports a module tsc cannot resolve', async () => {
    // Reproduces the helmet incident: npm install succeeds, the import +
    // usage is correct, but the in-process tsc can't resolve the package's types
    // (TS2307). A correct edit must NOT be reverted just because of an
    // environment/module-resolution quirk.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-syntax-mod-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true },
    }));
    const file = path.join(dir, 'app.ts');
    const orig = "import express from 'express';\nexport const app = express();\n";
    // Valid edit: add an import of a module that does NOT exist in node_modules.
    const edited = "import express from 'express';\nimport helmet from 'helmet-that-does-not-exist';\nexport const app = express();\napp.use(helmet());\n";
    fs.writeFileSync(file, edited);
    const err = await syntaxCheck(file, dir, edited, orig);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(err).toBeNull();
  });

  it('still reverts a genuine syntax-error edit (not a resolution quirk)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-syntax-real-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true },
    }));
    const file = path.join(dir, 'app.ts');
    const orig = 'export const x = 1;\n';
    // Real syntax break: stray token / unbalanced bracket.
    const edited = 'export const x = 1;\nconst broken = (;\n';
    fs.writeFileSync(file, edited);
    const err = await syntaxCheck(file, dir, edited, orig);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(err).not.toBeNull();
    expect(err).toContain('app.ts');
  });

  it('blocks a NEWLY introduced type error but not a pre-existing one', async () => {
    // Pre-existing file has a type error (unused var). The agent fixes a DIFFERENT
    // line but accidentally introduces a NEW type error. Only the new one blocks.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-syntax-new-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noUnusedLocals: true, noEmit: true, skipLibCheck: true },
    }));
    const file = path.join(dir, 'thing.ts');
    const orig = 'const unused = 1;\nexport const ok = 2;\n';
    // Edit introduces a NEW error on line 2 (assigns string to number) while the
    // pre-existing unused-var on line 1 remains.
    const edited = 'const unused = 1;\nexport const ok: number = "not a number";\n';
    fs.writeFileSync(file, edited);
    const err = await syntaxCheck(file, dir, edited, orig);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(err).not.toBeNull();
    expect(err).toContain('thing.ts');
  });

  it('does NOT block when the only errors are pre-existing (valid edit, nothing new)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-syntax-pre-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noUnusedLocals: true, noEmit: true, skipLibCheck: true },
    }));
    const file = path.join(dir, 'thing.ts');
    const orig = 'const unused = 1;\nexport const ok = 2;\n';
    // Valid edit on line 2; pre-existing unused-var on line 1 stays untouched.
    const edited = 'const unused = 1;\nexport const ok = 3;\n';
    fs.writeFileSync(file, edited);
    const err = await syntaxCheck(file, dir, edited, orig);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(err).toBeNull();
  });

  it('reports ALL newly-introduced diagnostics, not just the first', async () => {
    // A single edit that introduces TWO new type errors. The agent should see
    // both at once so it can fix them atomically instead of looping one-at-a-time.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-syntax-all-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
    }));
    const file = path.join(dir, 'thing.ts');
    const orig = 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n';
    const edited =
      'export const a: number = "x";\n' +   // TS2322: type 'string' not assignable to number
      'export const b: number = "y";\n' +   // TS2322: second distinct new error
      'export const c = 3;\n';
    fs.writeFileSync(file, edited);
    const err = await syntaxCheck(file, dir, edited, orig);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(err).not.toBeNull();
    // Both distinct TS2322 errors must be present in the message.
    const matches = (err ?? '').match(/TS2322/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('hints when an import is nested inside a function body (TS1128)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-syntax-nested-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, module: 'esnext', moduleResolution: 'bundler' },
    }));
    const file = path.join(dir, 'thing.ts');
    const orig = 'export function go(): void {\n  console.log("hi");\n}\n';
    // Agent mistakenly places the import INSIDE the function (illegal in ES modules).
    const edited =
      'export function go(): void {\n  import { x } from "./x";\n  console.log("hi");\n}\n';
    fs.writeFileSync(file, edited);
    const err = await syntaxCheck(file, dir, edited, orig);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(err).not.toBeNull();
    expect(err).toContain('imports must be at the TOP LEVEL');
  });
});

describe('global patch-failure loop breaker', () => {
  function blankContext(): any {
    return { patchFailureStreak: new Map<string, number>() };
  }

  it('does not trip below the limit', () => {
    const ctx = blankContext();
    recordRevert('/p/a.ts', ctx);
    recordRevert('/p/a.ts', ctx);
    expect(checkGlobalPatchBreaker(ctx)).toBeNull();
    expect(ctx.patchFailureTotal).toBe(2);
  });

  it('trips at 3 total reverts regardless of file or intervening reads', () => {
    const ctx = blankContext();
    recordRevert('/p/a.ts', ctx);
    recordRevert('/p/b.ts', ctx); // different file — per-path breaker would miss this
    recordRevert('/p/a.ts', ctx);
    const msg = checkGlobalPatchBreaker(ctx);
    expect(msg).not.toBeNull();
    expect(msg).toContain('[PATCH CIRCUIT BREAKER]');
    expect(ctx.patchFailureTotal).toBe(3);
  });

  it('resets the total on a successful write', () => {
    const ctx = blankContext();
    recordRevert('/p/a.ts', ctx);
    recordRevert('/p/a.ts', ctx);
    recordWriteSuccess('/p/a.ts', ctx);
    expect(ctx.patchFailureTotal).toBe(0);
    expect(checkGlobalPatchBreaker(ctx)).toBeNull();
  });
});

describe('buildRemovedSymbolHint', () => {
  function diag(message: string): any {
    return { code: 2304, messageText: message };
  }

  it('points at still-referenced lines when the patch removed a symbol', () => {
    const original = 'function foo(port: number) {\n  app.listen(port);\n}\ncreateApp(DEFAULT_PORT);';
    const proposed = 'function foo() {\n  app.listen(port);\n}\ncreateApp(DEFAULT_PORT);';
    const hint = buildRemovedSymbolHint([diag("Cannot find name 'port'.")], proposed, original);
    expect(hint).toContain("'port' was removed by this patch");
    expect(hint).toContain('line(s) 2'); // app.listen(port) is on line 2 of proposed
    expect(hint).toContain('do not re-propose the same partial change');
  });

  it('returns empty when no TS2304 errors', () => {
    expect(buildRemovedSymbolHint([diag('Something else')], 'x', 'x')).toBe('');
  });

  it('returns empty when the name was not removed by the patch', () => {
    const both = 'const port = 1;\nconsole.log(port);';
    expect(buildRemovedSymbolHint([diag("Cannot find name 'port'.")], both, both)).toBe('');
  });
});

describe('preflightDependencyCheck (pre-write prevention gate)', () => {
  function makeProject(withTypes: boolean): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-preflight-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true },
    }));
    // A resolvable package (express) + its types always present in the daemon's own node_modules
    // is not what we test; instead we simulate a package present in node_modules with/without types.
    const modDir = path.join(dir, 'node_modules', 'goodpkg');
    fs.mkdirSync(modDir, { recursive: true });
    fs.writeFileSync(path.join(modDir, 'package.json'), JSON.stringify(
      withTypes ? { name: 'goodpkg', types: './index.d.ts' } : { name: 'goodpkg' },
    ));
    if (withTypes) fs.writeFileSync(path.join(modDir, 'index.d.ts'), 'export const ok = 1;\n');
    return dir;
  }

  it('returns null when all imported packages resolve to types', () => {
    const dir = makeProject(true);
    const file = path.join(dir, 'app.ts');
    const content = "import { ok } from 'goodpkg';\nexport const x = ok;\n";
    const res = preflightDependencyCheck(file, dir, content);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(res).toBeNull();
  });

  it('flags a package with no bundled types and no @types companion BEFORE write', () => {
    // Simulates the helmet incident: package installed, but @types/helmet missing.
    const dir = makeProject(false); // goodpkg has no types and no @types/goodpkg
    const file = path.join(dir, 'app.ts');
    const content = "import thing from 'goodpkg';\nexport const x = thing;\n";
    const res = preflightDependencyCheck(file, dir, content);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(res).not.toBeNull();
    expect(res).toContain('goodpkg');
    expect(res).toContain('npm install --save-dev @types/goodpkg');
    expect(res).toContain('Resolve BEFORE patching');
  });

  it('passes when an @types/<pkg> companion exists', () => {
    const dir = makeProject(false);
    const typesDir = path.join(dir, 'node_modules', '@types', 'goodpkg');
    fs.mkdirSync(typesDir, { recursive: true });
    fs.writeFileSync(path.join(typesDir, 'index.d.ts'), 'export const ok: number;\n');
    const file = path.join(dir, 'app.ts');
    const content = "import { ok } from 'goodpkg';\nexport const x = ok;\n";
    const res = preflightDependencyCheck(file, dir, content);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(res).toBeNull();
  });

  it('ignores relative imports (scoped to the edit, not resolvable here)', () => {
    const dir = makeProject(true);
    const file = path.join(dir, 'app.ts');
    const content = "import { x } from './local';\nexport const y = x;\n";
    const res = preflightDependencyCheck(file, dir, content);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(res).toBeNull();
  });
});

