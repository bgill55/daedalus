import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getImpact } from './impact.js';
import type { ToolContext } from '../../types.js';

describe('Impact analysis tool', () => {
  let tmpDir: string;
  let context: ToolContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-impact-test-'));
    context = {
      projectRoot: tmpDir,
      sessionId: 'test',
      projectHash: 'test',
      activeFiles: new Map(),
      abortSignal: new AbortController().signal,
    } as ToolContext;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns no impact for isolated file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'isolated.ts'), 'export const x = 1;\n');
    const result = await getImpact({ target: 'isolated.ts' }, context);
    expect(result.success).toBe(true);
    expect(result.content).toContain('No files import');
  });

  it('detects direct importers', async () => {
    fs.writeFileSync(path.join(tmpDir, 'dep.ts'), 'export const helper = () => {};\n');
    fs.writeFileSync(path.join(tmpDir, 'user.ts'), "import { helper } from './dep';\nhelper();\n");

    const result = await getImpact({ target: 'dep.ts' }, context);
    expect(result.success).toBe(true);
    expect(result.content).toContain('user.ts');
  });

  it('detects transitive importers', async () => {
    fs.writeFileSync(path.join(tmpDir, 'lib.ts'), 'export const util = () => {};\n');
    fs.writeFileSync(path.join(tmpDir, 'middle.ts'), "import { util } from './lib';\nexport const mid = () => util();\n");
    fs.writeFileSync(path.join(tmpDir, 'top.ts'), "import { mid } from './middle';\nmid();\n");

    const result = await getImpact({ target: 'lib.ts' }, context);
    expect(result.success).toBe(true);
    expect(result.content).toContain('Depth 1');
    expect(result.content).toContain('Depth 2');
  });

  it('returns error when project has no source files', async () => {
    const result = await getImpact({ target: 'test.ts' }, context);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No source files found');
  });

});
