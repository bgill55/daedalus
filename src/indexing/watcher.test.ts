import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { initIndexDb, findDefinitions } from './fts.js';
import { watchCodebase } from './watcher.js';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(fn: () => boolean | Promise<boolean>, timeout = 3000, interval = 50): Promise<void> {
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

describe('Watcher - Incremental Indexing', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: Database.Database;
  const projectHash = 'watchertest';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-watcher-test-'));
    dbPath = path.join(tmpDir, 'index.sqlite');
    db = initIndexDb(dbPath);
  });

  afterEach(async () => {
    db.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      await sleep(100);
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('indexes a newly created file and ignores excluded paths or non-matching extensions', async () => {
    const watcher = watchCodebase(db, tmpDir, projectHash);
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

    watcher.close();
  });

  it('updates index when a file is modified', async () => {
    const watcher = watchCodebase(db, tmpDir, projectHash);
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

    watcher.close();
  });

  it('removes symbols when a file is deleted', async () => {
    const watcher = watchCodebase(db, tmpDir, projectHash);
    await sleep(200);

    fs.writeFileSync(path.join(tmpDir, 'delete.ts'), 'export function byeFunc() {}');
    await waitFor(() => findDefinitions(db, 'byeFunc', projectHash).length === 1);

    const defs = findDefinitions(db, 'byeFunc', projectHash);
    expect(defs).toHaveLength(1);

    fs.unlinkSync(path.join(tmpDir, 'delete.ts'));
    await waitFor(() => findDefinitions(db, 'byeFunc', projectHash).length === 0);

    const defsAfter = findDefinitions(db, 'byeFunc', projectHash);
    expect(defsAfter).toHaveLength(0);

    watcher.close();
  });

  it('removes symbols recursively when a directory is deleted', async () => {
    const watcher = watchCodebase(db, tmpDir, projectHash);
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

    watcher.close();
  });
});
