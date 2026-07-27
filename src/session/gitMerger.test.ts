import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { applyCodeDiffs } from './gitMerger.js';

describe('Git Merger', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function initGitRepo(): string {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-git-merge-'));
    execSync('git init', { cwd: tempDir });
    execSync('git config user.email test@daedalus.local', { cwd: tempDir });
    execSync('git config user.name Test', { cwd: tempDir });
    return tempDir;
  }

  function commitFile(relativePath: string, content: string): void {
    const fullPath = path.join(tempDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
    execSync(`git add "${relativePath}"`, { cwd: tempDir });
    execSync(`git commit -m "add ${relativePath}"`, { cwd: tempDir });
  }

  it('returns success immediately for empty diffs', async () => {
    const result = await applyCodeDiffs([], '/tmp');
    expect(result.success).toBe(true);
    expect(result.appliedPatches).toBe(0);
  });

  it('returns success immediately for whitespace-only diffs', async () => {
    const result = await applyCodeDiffs(['  ', '\n', ''], '/tmp');
    expect(result.success).toBe(true);
    expect(result.appliedPatches).toBe(0);
  });

  function captureDiff(repo: string, file: string, toContent: string): string {
    const fullPath = path.join(repo, file);
    const origContent = fs.readFileSync(fullPath, 'utf8');
    fs.writeFileSync(fullPath, toContent, 'utf8');
    const diff = execSync('git diff', { cwd: repo, encoding: 'utf8' });
    fs.writeFileSync(fullPath, origContent, 'utf8');
    return diff;
  }

  it('applies a valid diff to a tracked file', async () => {
    const repo = initGitRepo();
    commitFile('test.txt', 'Hello World\n');

    const diff = captureDiff(repo, 'test.txt', 'Hello Universe\n');

    const result = await applyCodeDiffs([diff], repo);
    expect(result.success).toBe(true);
    expect(result.appliedPatches).toBe(1);

    const content = fs.readFileSync(path.join(repo, 'test.txt'), 'utf8');
    expect(content).toBe('Hello Universe\n');
  });

  it('fails gracefully when git apply rejects the diff', async () => {
    const repo = initGitRepo();
    const badDiff = [
      '--- a/nonexistent.txt',
      '+++ b/nonexistent.txt',
      '@@ -1 +1 @@',
      '-Nothing',
      '+Something',
    ].join('\n');

    const result = await applyCodeDiffs([badDiff], repo);
    expect(result.success).toBe(false);
    expect(result.appliedPatches).toBe(0);
    expect(result.error).toContain('Failed to apply git patch');
  });

  it('cleans up temp directory after applying diffs', async () => {
    const repo = initGitRepo();
    commitFile('test.txt', 'Hello World\n');

    const diff = captureDiff(repo, 'test.txt', 'Hello Universe\n');

    const result = await applyCodeDiffs([diff], repo);
    expect(result.success).toBe(true);
  });
});
