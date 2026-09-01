import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { initIndexDb, findDefinitions, findReferences } from './fts.js';
import { watchCodebase } from './watcher.js';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(fn: () => boolean | Promise<boolean>, timeout = 5000, interval = 50): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) {
      return;
    }
    await sleep(interval);
  }
  if (await fn()) {
    return;
  }
  throw new Error('Timeout waiting for condition');
}

describe.skipIf(process.platform === 'win32')('Watcher - Incremental Indexing', () => {
  let rootTmpDir: string;
  let tmpDir: string;
  let dbPath: string;
  let db: Database.Database;
  let watcher: { close: () => Promise<void> } | undefined;
  const projectHash = 'watchertest';
  let testCounter = 0;

  beforeAll(() => {
    rootTmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-watcher-suite-')));
  });

  afterAll(async () => {
    if (process.platform === 'win32') {
      await sleep(500);
    }
    try {
      fs.rmSync(rootTmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  beforeEach(() => {
    testCounter++;
    tmpDir = path.join(rootTmpDir, `test-${testCounter}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(rootTmpDir, `index-${testCounter}.sqlite`);
    db = initIndexDb(dbPath);
  });

  afterEach(async () => {
    if (watcher) {
      await watcher.close();
      watcher = undefined;
    }
    if (process.platform === 'win32') {
      await sleep(500);
    }
    db.close();
    try {
      const entries = fs.readdirSync(tmpDir);
      for (const entry of entries) {
        fs.rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  });

  it('indexes a newly created file and ignores excluded paths or non-matching extensions', async () => {
    watcher = watchCodebase(db, tmpDir, projectHash);
    await sleep(200);

    fs.writeFileSync(path.join(tmpDir, 'test.ts'), 'export function testFunc() {}');

    fs.mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'ignored.ts'), 'export function ignoredFunc() {}');

    fs.writeFileSync(path.join(tmpDir, 'readme.md'), 'export function docFunc() {}');

    await waitFor(() => findDefinitions(db, 'testFunc', projectHash).length === 1);

    const testFuncDefs = findDefinitions(db, 'testFunc', projectHash);
    expect(testFuncDefs).toHaveLength(1);
    expect(testFuncDefs[0].file_path).toBe('test.ts');

    const ignoredFuncDefs = findDefinitions(db, 'ignoredFunc', projectHash);
    expect(ignoredFuncDefs).toHaveLength(0);

    const docFuncDefs = findDefinitions(db, 'docFunc', projectHash);
    expect(docFuncDefs).toHaveLength(0);
  });

  it('updates index when a file is modified', async () => {
    watcher = watchCodebase(db, tmpDir, projectHash);
    await sleep(200);

    fs.writeFileSync(path.join(tmpDir, 'modify.ts'), 'export function firstFunc() {}');
    await waitFor(() => findDefinitions(db, 'firstFunc', projectHash).length === 1);

    const defs1 = findDefinitions(db, 'firstFunc', projectHash);
    expect(defs1).toHaveLength(1);

    fs.writeFileSync(path.join(tmpDir, 'modify.ts'), 'export function secondFunc() {}');
    await waitFor(() => findDefinitions(db, 'secondFunc', projectHash).length === 1);

    const defsAfterOld = findDefinitions(db, 'firstFunc', projectHash);
    expect(defsAfterOld).toHaveLength(0);

    const defsAfterNew = findDefinitions(db, 'secondFunc', projectHash);
    expect(defsAfterNew).toHaveLength(1);
    expect(defsAfterNew[0].file_path).toBe('modify.ts');
  });

  it('debounces rapid consecutive writes so only the final version is indexed', async () => {
    watcher = watchCodebase(db, tmpDir, projectHash);
    await sleep(200);

    const targetFile = path.join(tmpDir, 'rapid.ts');
    fs.writeFileSync(targetFile, 'export function rapidV1() {}');
    await sleep(50);
    fs.writeFileSync(targetFile, 'export function rapidV2() {}');
    await sleep(50);
    fs.writeFileSync(targetFile, 'export function rapidFinal() {}');

    await waitFor(() => findDefinitions(db, 'rapidFinal', projectHash).length === 1);

    expect(findDefinitions(db, 'rapidV1', projectHash)).toHaveLength(0);
    expect(findDefinitions(db, 'rapidV2', projectHash)).toHaveLength(0);
    expect(findDefinitions(db, 'rapidFinal', projectHash)).toHaveLength(1);
  });

  it('removes symbols when a file is deleted', async () => {
    watcher = watchCodebase(db, tmpDir, projectHash);
    await sleep(200);

    fs.writeFileSync(path.join(tmpDir, 'delete.ts'), 'export function byeFunc() {}');
    await waitFor(() => findDefinitions(db, 'byeFunc', projectHash).length === 1);

    const defs = findDefinitions(db, 'byeFunc', projectHash);
    expect(defs).toHaveLength(1);

    fs.unlinkSync(path.join(tmpDir, 'delete.ts'));
    await waitFor(() => findDefinitions(db, 'byeFunc', projectHash).length === 0);

    const defsAfter = findDefinitions(db, 'byeFunc', projectHash);
    expect(defsAfter).toHaveLength(0);
  });

  it('removes symbols recursively when a directory is deleted', async () => {
    watcher = watchCodebase(db, tmpDir, projectHash);
    await sleep(200);

    fs.mkdirSync(path.join(tmpDir, 'subfolder'), { recursive: true });
    await sleep(200);
    fs.writeFileSync(path.join(tmpDir, 'subfolder', 'subfile.ts'), 'export function subFunc() {}');
    await waitFor(() => findDefinitions(db, 'subFunc', projectHash).length === 1);

    const defs = findDefinitions(db, 'subFunc', projectHash);
    expect(defs).toHaveLength(1);

    fs.rmSync(path.join(tmpDir, 'subfolder'), { recursive: true, force: true });
    await waitFor(() => findDefinitions(db, 'subFunc', projectHash).length === 0);

    const defsAfter = findDefinitions(db, 'subFunc', projectHash);
    expect(defsAfter).toHaveLength(0);
  });

  it('indexes and cleans up function call references', async () => {
    watcher = watchCodebase(db, tmpDir, projectHash);
    await sleep(200);

    fs.writeFileSync(
      path.join(tmpDir, 'refs.ts'),
      'export function callerFn() {\n  helperFn();\n}'
    );

    await waitFor(() => findReferences(db, 'helperFn', projectHash).length >= 1);

    const refs = findReferences(db, 'helperFn', projectHash);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].caller_name).toBe('callerFn');

    fs.unlinkSync(path.join(tmpDir, 'refs.ts'));
    await waitFor(() => findReferences(db, 'helperFn', projectHash).length === 0);

    expect(findReferences(db, 'helperFn', projectHash)).toHaveLength(0);
  });

  it('respects custom options for exclude patterns and allowed extensions', async () => {
    watcher = watchCodebase(db, tmpDir, projectHash, {
      exclude: ['custom_ignore'],
      extensions: ['.py'],
    });
    await sleep(200);

    fs.mkdirSync(path.join(tmpDir, 'custom_ignore'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'custom_ignore', 'test.py'), 'def custom_ignore_func():\n    pass');
    fs.writeFileSync(path.join(tmpDir, 'valid.py'), 'def valid_custom_func():\n    pass');
    fs.writeFileSync(path.join(tmpDir, 'standard.ts'), 'export function standardFunc() {}');

    await waitFor(() => findDefinitions(db, 'valid_custom_func', projectHash).length === 1);

    expect(findDefinitions(db, 'valid_custom_func', projectHash)).toHaveLength(1);
    expect(findDefinitions(db, 'custom_ignore_func', projectHash)).toHaveLength(0);
    expect(findDefinitions(db, 'standardFunc', projectHash)).toHaveLength(0);
  });

  it('closes cleanly without leaving active debounce timers or watchers', async () => {
    watcher = watchCodebase(db, tmpDir, projectHash);
    await expect(watcher.close()).resolves.toBeUndefined();
    watcher = undefined;
  });

});
