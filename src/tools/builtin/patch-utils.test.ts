import { describe, it, expect } from 'vitest';
import { extractErrorLines, normalizeErrorLine, syntaxCheck } from './patch-utils.js';
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
    const modifiedLine = orig.split('\n').length;
    const err = await syntaxCheck(good, dir, [modifiedLine]);
    fs.writeFileSync(good, orig);
    expect(err).toBeNull();
  });

  it('catches a genuinely broken edit and reports it scoped to the file', async () => {
    const dir = makeProject();
    const good = path.join(dir, 'good.ts');
    const orig = fs.readFileSync(good, 'utf8');
    fs.writeFileSync(good, orig + 'export const z: number = ;\n');
    const modifiedLine = orig.split('\n').length;
    const err = await syntaxCheck(good, dir, [modifiedLine]);
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
    const err = await syntaxCheck(file, dir, [2, 4], orig);
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
    const err = await syntaxCheck(file, dir, [2], orig);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(err).not.toBeNull();
    expect(err).toContain('app.ts');
  });
});
