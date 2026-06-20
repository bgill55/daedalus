import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { diff, status } from './git.js';
import type { ToolContext } from '../../types.js';

describe('Git tools', () => {
  let tmpDir: string;
  let context: ToolContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-git-test-'));

    context = {
      projectRoot: tmpDir,
    } as ToolContext;

    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.email test@test.com', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.name Test', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# Test', 'utf8');
    execSync('git add . && git commit -m "init"', { cwd: tmpDir, stdio: 'ignore' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('git_status shows clean status', async () => {
    const result = await status({}, context);
    expect(result.success).toBe(true);
  });

  it('git_diff shows working tree changes', async () => {
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# Modified', 'utf8');
    const result = await diff({}, context);
    expect(result.success).toBe(true);
    expect(result.content).toContain('Modified');
  });

  it('git_diff --staged shows staged changes', async () => {
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'content', 'utf8');
    execSync('git add new.txt', { cwd: tmpDir, stdio: 'ignore' });
    const result = await diff({ staged: true }, context);
    expect(result.success).toBe(true);
    expect(result.content).toContain('new.txt');
  });

  it('git_diff with path filters to that file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), 'Changed', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'other.txt'), 'also changed', 'utf8');
    const result = await diff({ path: 'readme.md' }, context);
    expect(result.content).toContain('readme.md');
    expect(result.content).not.toContain('other.txt');
  });

});

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
