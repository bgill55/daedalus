import { describe, it, expect } from 'vitest';
import { extractErrorLines, normalizeErrorLine, syntaxCheck } from './patch-utils.js';

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
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

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
});
