import { describe, it, expect } from 'vitest';
import { extractErrorLines, normalizeErrorLine, syntaxCheck, preflightDependencyCheck, recordRevert, recordWriteSuccess, checkGlobalPatchBreaker, checkCircuitBreaker, patchBreakerLevel, getPatchRepeatCount, buildRemovedSymbolHint, isTestFile, checkTestFileLock, guardTestWrite, isMissingNodeGlobal } from './patch-utils.js';
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

  it('localizes an unterminated template literal to its OPENING backtick, not the recovery point', async () => {
    // Reproduces the prompt-vault bug class: a template literal opened with ` but
    // closed with a " stays OPEN and swallows the rest of the file. tsc reports the
    // symptom at a far-away recovery point; the revert message must point the agent
    // at the OPENING backtick (line 2 here) so it fixes the one stray character
    // instead of blaming whitespace or the diff tool and re-proposing a reindent.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-syntax-tmpl-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true },
    }));
    const file = path.join(dir, 'server.ts');
    const orig = 'export const a = 1;\n';
    const edited =
      'export const a = 1;\n' +
      'const dup = `unterminated at line 2\n' +                 // opens a template literal, never closed
      '  name: ${prompt.name} (copy)\n' +                     // no closing backtick -> stays open
      'const b = 2;\n' +                                      // swallowed as template text
      'export const msg = count is ${count};\n';               // ${...} is the recovery-point symptom
    fs.writeFileSync(file, edited);
    const err = await syntaxCheck(file, dir, edited, orig);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(err).not.toBeNull();
    expect(err).toContain('Localized root cause');
    expect(err).toContain('Template literal opened with `');
    // The agent must be told to fix line 2 (the open backtick), not the recovery line.
    expect(err).toContain('line 2');
  });

  it('localizes an unclosed bracket to its opening position', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-syntax-brace-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
    }));
    const file = path.join(dir, 'thing.ts');
    const orig = 'export const a = 1;\n';
    const edited = 'export function go() {\n  return 1;\n'; // missing closing }
    fs.writeFileSync(file, edited);
    const err = await syntaxCheck(file, dir, edited, orig);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(err).not.toBeNull();
    expect(err).toContain('Localized root cause');
    expect(err).toContain('Unclosed delimiter');
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
    expect(msg).toContain('[PAUSED]');
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

describe('graduated patch circuit-breaker ladder', () => {
  function streakContext(target: string, n: number): any {
    const m = new Map<string, number>();
    m.set(target, n);
    return { patchFailureStreak: m, patchFailureTotal: n };
  }

  it('patchBreakerLevel maps streak to ladder rungs', () => {
    expect(patchBreakerLevel(0)).toBe('healthy');
    expect(patchBreakerLevel(1)).toBe('healthy');
    expect(patchBreakerLevel(2)).toBe('steering');
    expect(patchBreakerLevel(3)).toBe('constrained');
    expect(patchBreakerLevel(4)).toBe('stopped');
    expect(patchBreakerLevel(9)).toBe('stopped');
  });

  it('per-path breaker steers at streak 2 (re-read, no hard stop)', () => {
    const ctx = streakContext('/p/a.ts', 2);
    const msg = checkCircuitBreaker('/p/a.ts', ctx);
    expect(msg).not.toBeNull();
    expect(msg).toContain('[CIRCUIT BREAKER]');
    expect(msg).toContain('Re-read the current file');
    expect(msg).not.toContain('pausing to avoid a loop');
  });

  it('per-path breaker constrains at streak 3 (stop varying the same edit)', () => {
    const ctx = streakContext('/p/a.ts', 3);
    const msg = checkCircuitBreaker('/p/a.ts', ctx);
    expect(msg).toContain('variations of the same edit');
    expect(msg).not.toContain('pausing to avoid a loop');
  });

  it('per-path breaker stops at streak 4 (hard pause)', () => {
    const ctx = streakContext('/p/a.ts', 4);
    const msg = checkCircuitBreaker('/p/a.ts', ctx);
    expect(msg).toContain('pausing to avoid a loop');
  });

  it('global breaker escalates by total and keeps [PAUSED] at the limit', () => {
    const ctx = streakContext('/p/a.ts', 3);
    const msg = checkGlobalPatchBreaker(ctx);
    expect(msg).not.toBeNull();
    expect(msg).toContain('[PAUSED]');
    expect(msg).toContain('variations of the same edit');
  });

  it('global breaker stops at total >= 4', () => {
    const ctx = streakContext('/p/a.ts', 5);
    const msg = checkGlobalPatchBreaker(ctx);
    expect(msg).toContain('pausing to avoid a loop');
  });
});

describe('same-edit loop detector', () => {
  function ctxWithRepeat(): any {
    return {
      patchFailureStreak: new Map<string, number>(),
      patchRepeatKey: new Map<string, string>(),
      patchRepeatCount: new Map<string, number>(),
      patchFailureTotal: 0,
    };
  }

  it('bumps the repeat count when the same intent reverts twice', () => {
    const ctx = ctxWithNoMaps();
    recordRevert('/p/a.ts', ctx, 'const x = 1;');
    expect(getPatchRepeatCount('/p/a.ts', ctx)).toBe(1);
    recordRevert('/p/a.ts', ctx, 'const x = 1;');
    expect(getPatchRepeatCount('/p/a.ts', ctx)).toBe(2);
  });

  it('resets the repeat count when the intent changes', () => {
    const ctx = ctxWithRepeat();
    recordRevert('/p/a.ts', ctx, 'const x = 1;');
    recordRevert('/p/a.ts', ctx, 'const x = 1;');
    expect(getPatchRepeatCount('/p/a.ts', ctx)).toBe(2);
    recordRevert('/p/a.ts', ctx, 'const y = 2;');
    expect(getPatchRepeatCount('/p/a.ts', ctx)).toBe(1);
  });

  it('near-identical intents (whitespace-only) still collide as a loop', () => {
    const ctx = ctxWithRepeat();
    recordRevert('/p/a.ts', ctx, 'const x = 1;');
    recordRevert('/p/a.ts', ctx, '  const   x =   1;  ');
    expect(getPatchRepeatCount('/p/a.ts', ctx)).toBe(2);
  });

  it('names the loop in the circuit-breaker message when repeating', () => {
    const ctx = ctxWithRepeat();
    recordRevert('/p/a.ts', ctx, 'const x = 1;');
    recordRevert('/p/a.ts', ctx, 'const x = 1;');
    const map = ctx.patchFailureStreak as Map<string, number>;
    map.set('/p/a.ts', 2);
    const msg = checkCircuitBreaker('/p/a.ts', ctx);
    expect(msg).toContain('looping on the same broken approach');
  });

  it('clears the repeat signal on a successful write', () => {
    const ctx = ctxWithRepeat();
    recordRevert('/p/a.ts', ctx, 'const x = 1;');
    recordRevert('/p/a.ts', ctx, 'const x = 1;');
    expect(getPatchRepeatCount('/p/a.ts', ctx)).toBe(2);
    recordWriteSuccess('/p/a.ts', ctx);
    expect(getPatchRepeatCount('/p/a.ts', ctx)).toBe(0);
  });

  function ctxWithNoMaps(): any {
    return { patchFailureStreak: new Map<string, number>(), patchFailureTotal: 0 };
  }
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

  it('treats node: protocol built-ins (node:path, node:fs) as resolved, not missing types', () => {
    // Regression: node:path was being extracted as the package "node:path" and flagged as
    // "missing type declarations", which blocked every patch to a server file that imports
    // Node built-ins and sent the agent into a config-thrash death loop.
    const dir = makeProject(true);
    const file = path.join(dir, 'server.ts');
    const content = "import path from 'node:path';\nimport fs from 'node:fs';\nexport const x = path.join('a','b');\n";
    const res = preflightDependencyCheck(file, dir, content);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(res).toBeNull();
  });

  it('does NOT block a write in a fresh scaffold (no node_modules yet) for an uninstalled import', () => {
    // Regression: greenfield setup writes source files in a batch BEFORE running
    // `npm install`, so every third-party import (e.g. `config`) is "missing type
    // declarations" until deps install. Blocking the write then churns the agent
    // (write -> revert -> install -> re-write) and wastes model escalations. When
    // node_modules is absent, treat missing deps as environment noise and let the
    // write through; tsc surfaces real errors after install.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-preflight-fresh-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true },
    }));
    // Intentionally do NOT create node_modules.
    const file = path.join(dir, 'app.ts');
    const content = "import { load } from 'config';\nexport const x = load();\n";
    const res = preflightDependencyCheck(file, dir, content);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(res).toBeNull();
  });

  it('falls back to bare built-in name when node: prefix is absent', () => {
    const dir = makeProject(true);
    const file = path.join(dir, 'server.ts');
    const content = "import path from 'path';\nexport const x = path.join('a','b');\n";
    const res = preflightDependencyCheck(file, dir, content);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(res).toBeNull();
  });

  it('treats async_hooks as a node built-in (no @types/async_hooks suggestion)', () => {
    // Regression: async_hooks was missing from NODE_BUILTINS, so a patch importing it
    // was refused pre-write with "missing type declarations for: async_hooks" and the
    // agent tried `npm install @types/async_hooks` (404, does not exist) — a wasted
    // install + failed run. async_hooks resolves via @types/node like every other built-in.
    const dir = makeProject(true);
    const file = path.join(dir, 'logger.ts');
    const content = "import { AsyncLocalStorage } from 'async_hooks';\nexport const store = new AsyncLocalStorage();\n";
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

  it('does NOT flag Node built-in imports (path/crypto/fs) as missing types', () => {
    // Regression: Node built-ins resolve via @types/node, not node_modules/<name>.
    // The pre-flight gate must never block a patch solely because the file imports
    // 'path' or 'crypto' — that made every patch to a Node server file fail pre-write.
    const dir = makeProject(false);
    const file = path.join(dir, 'server.ts');
    const content =
      "import path from 'path';\nimport { randomUUID } from 'crypto';\nimport fs from 'fs';\nexport const x = path.join('a', 'b');\n";
    const res = preflightDependencyCheck(file, dir, content);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(res).toBeNull();
  });

  it('still flags a genuinely missing third-party package (not a built-in)', () => {
    const dir = makeProject(false);
    const file = path.join(dir, 'app.ts');
    const content = "import thing from 'totally-missing-pkg';\nexport const x = thing;\n";
    const res = preflightDependencyCheck(file, dir, content);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(res).not.toBeNull();
    expect(res).toContain('totally-missing-pkg');
  });
});

describe('isTestFile and checkTestFileLock', () => {
  it('identifies test files correctly', () => {
    expect(isTestFile('src/app.test.ts')).toBe(true);
    expect(isTestFile('src/app.spec.ts')).toBe(true);
    expect(isTestFile('tests/app.ts')).toBe(true);
    expect(isTestFile('src/__tests__/app.ts')).toBe(true);
    expect(isTestFile('.github/workflows/ci.yml')).toBe(true);
    // Runner config files are NOT test-assertion files — blocking them would stall
    // greenfield test setup (you cannot run tests without creating vitest.config.ts).
    expect(isTestFile('vitest.config.ts')).toBe(false);
    expect(isTestFile('jest.config.js')).toBe(false);
    expect(isTestFile('playwright.config.ts')).toBe(false);
    expect(isTestFile('cypress.config.ts')).toBe(false);
    expect(isTestFile('src/app.ts')).toBe(false);
  });

  it('allows creating a brand-new test file (does not exist on disk yet)', () => {
    // Regression: greenfield scaffold must be able to WRITE a first test
    // (GOAL.md requires >= 1 vitest test). The lock exists to block weakening an
    // EXISTING assertion, not to block first-time creation. A test path that does
    // not exist on disk is allowed; only an existing test file is locked.
    const mockCtx: any = {};
    const res = checkTestFileLock('/tmp/does-not-exist/scanner.test.ts', mockCtx);
    expect(res).toBeNull();
  });

  it('blocks modifying an EXISTING test file when allowTestEdits is not true', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-lock-'));
    const file = path.join(dir, 'app.test.ts');
    fs.writeFileSync(file, 'export const x = 1;\n');
    const mockCtx: any = {};
    const res = checkTestFileLock(file, mockCtx);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(res).not.toBeNull();
    expect(res).toContain('[TEST SUITE LOCK]');
  });

  it('allows non-test file modifications', () => {
    const mockCtx: any = {};
    const res = checkTestFileLock('src/app.ts', mockCtx);
    expect(res).toBeNull();
  });

  it('allows test file modifications when allowTestEdits is true', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-lock-'));
    const file = path.join(dir, 'app.test.ts');
    fs.writeFileSync(file, 'export const x = 1;\n');
    const mockCtx: any = { allowTestEdits: true };
    const res = checkTestFileLock(file, mockCtx);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(res).toBeNull();
  });

  it('hardens the lock message to forbid routing around via terminal/another tool', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-lock-'));
    const file = path.join(dir, 'app.test.ts');
    fs.writeFileSync(file, 'export const x = 1;\n');
    const mockCtx: any = {};
    const res = checkTestFileLock(file, mockCtx);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(res).toContain('[TEST SUITE LOCK]');
    expect(res).toContain('Do NOT attempt the write via the terminal or another tool');
  });

  it('records the blocked path and returns a stronger "already refused" message on retry', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-lock-'));
    const file = path.join(dir, 'app.test.ts');
    fs.writeFileSync(file, 'export const x = 1;\n');
    const mockCtx: any = {};
    const first = checkTestFileLock(file, mockCtx);
    expect(first).toContain('refused');
    expect(first).not.toContain('already refused');

    const second = checkTestFileLock(file, mockCtx);
    expect(second).toContain('already refused earlier this session');
    expect(second).toContain('Do NOT re-attempt it via another tool or the terminal');
    expect(mockCtx.blockedTestWrites.has(file)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('treats a second tool attempt in the same session as a bypass (cross-tool detection)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-lock-'));
    const file = path.join(dir, 'db.test.ts');
    fs.writeFileSync(file, 'export const x = 1;\n');
    // Simulate: write_file is blocked, then the agent retries via the terminal.
    // Both calls share the same context, so blockedTestWrites carries over.
    const mockCtx: any = {};
    const fileToolResult = checkTestFileLock(file, mockCtx);
    expect(fileToolResult).toContain('[TEST SUITE LOCK]');

    // Terminal-style retry hits the same lock with the same context.
    const terminalRetry = checkTestFileLock(file, mockCtx);
    expect(terminalRetry).toContain('already refused earlier this session');
    expect(terminalRetry).toContain('bypassing the lock');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('guardTestWrite (live user authorization)', () => {
  it('allows the write when the test lock does not apply', async () => {
    const mockCtx: any = {};
    const res = await guardTestWrite('src/app.ts', mockCtx);
    expect(res).toBeNull();
  });

  it('blocks (no askLine) when the user cannot be prompted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-lock-'));
    const file = path.join(dir, 'app.test.ts');
    fs.writeFileSync(file, 'export const x = 1;\n');
    const mockCtx: any = {};
    const res = await guardTestWrite(file, mockCtx);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(res).toContain('[TEST SUITE LOCK]');
    expect(mockCtx.allowTestEdits).toBeUndefined();
  });

  it('blocks when the user declines the authorization prompt', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-lock-'));
    const file = path.join(dir, 'app.test.ts');
    fs.writeFileSync(file, 'export const x = 1;\n');
    const askLine = async (_p: string) => 'no';
    const mockCtx: any = { askLine };
    const res = await guardTestWrite(file, mockCtx);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(res).toContain('[TEST SUITE LOCK]');
    expect(mockCtx.allowTestEdits).toBeUndefined();
  });

  it('allows and sets allowTestEdits when the user approves the prompt', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-lock-'));
    const file = path.join(dir, 'app.test.ts');
    fs.writeFileSync(file, 'export const x = 1;\n');
    const askLine = async (_p: string) => 'yes';
    const mockCtx: any = { askLine };
    const res = await guardTestWrite(file, mockCtx);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(res).toBeNull();
    expect(mockCtx.allowTestEdits).toBe(true);
  });

  it('does not prompt again once allowTestEdits is already set', async () => {
    let calls = 0;
    const askLine = async (_p: string) => { calls++; return 'yes'; };
    const mockCtx: any = { askLine, allowTestEdits: true };
    const res = await guardTestWrite('/tmp/does-not-exist/app.test.ts', mockCtx);
    expect(res).toBeNull();
    expect(calls).toBe(0);
  });

describe('isMissingNodeGlobal', () => {
  function diagOf(code: number, name: string): any {
    return {
      code,
      category: 1,
      messageText: "Cannot find name '" + name + "'.",
      file: null,
      start: undefined,
      length: undefined,
    };
  }

  it('flags a TS2304 on a Node global (missing @types/node) as env noise', () => {
    expect(isMissingNodeGlobal(diagOf(2304, 'process'))).toBe(true);
    expect(isMissingNodeGlobal(diagOf(2304, 'Buffer'))).toBe(true);
    expect(isMissingNodeGlobal(diagOf(2304, '__dirname'))).toBe(true);
  });

  it('does NOT flag a TS2304 on a real undefined symbol', () => {
    expect(isMissingNodeGlobal(diagOf(2304, 'someUntypedThing'))).toBe(false);
  });

  it('does NOT flag non-2304 codes', () => {
    expect(isMissingNodeGlobal(diagOf(2322, 'process'))).toBe(false);
  });
});
});


