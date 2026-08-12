import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recipeCommand } from './recipe.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('/recipe slash command', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-recipe-cmd-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a new recipe template file', async () => {
    const mockCtx: any = {
      toolContext: { projectRoot: tmpDir },
      configDir: tmpDir,
    };

    await recipeCommand.execute('create audit', mockCtx);
    const target = path.join(tmpDir, '.daedalus', 'recipes', 'audit.yaml');
    expect(fs.existsSync(target)).toBe(true);
    const content = fs.readFileSync(target, 'utf8');
    expect(content).toContain('name: audit');
  });

  it('runs an existing recipe', async () => {
    const dir = path.join(tmpDir, '.daedalus', 'recipes');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'test.yaml'), 'name: test\nprompt: Run test prompt\n', 'utf8');

    const callModelWithTools = vi.fn().mockResolvedValue(undefined);
    const mockCtx: any = {
      toolContext: { projectRoot: tmpDir, agentRole: 'coder' },
      configDir: tmpDir,
      sessionManager: { sessionId: 's1' },
      buildTodoContext: () => '',
      buildFileContext: () => '',
      callModelWithTools,
    };

    await recipeCommand.execute('run test', mockCtx);
    expect(callModelWithTools).toHaveBeenCalledTimes(1);
    const callArg = callModelWithTools.mock.calls[0][0];
    expect(callArg).toContain('Recipe Prompt: Run test prompt');
  });
});
