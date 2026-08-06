import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { presetCommand, modelManagerCommand } from './config.js';
import type { CommandContext } from './types.js';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-cmd-config-test-'));

describe('config slash commands', () => {
  beforeEach(() => {
    vi.stubEnv('HOME', TEST_DIR);
    vi.stubEnv('USERPROFILE', TEST_DIR);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    const configDir = path.join(TEST_DIR, '.daedalus');
    try { fs.rmSync(configDir, { recursive: true, force: true }); } catch { /* ignored */ }
  });

  const dummyCtx: Partial<CommandContext> = {
    configDir: TEST_DIR,
    router: {
      reloadConfig: vi.fn(),
    } as any,
  };

  it('runs /preset list without error', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await presetCommand.execute('list', dummyCtx as CommandContext);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('applies /preset local-free', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await presetCommand.execute('apply local-free', dummyCtx as CommandContext);
    expect(dummyCtx.router?.reloadConfig).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('runs /model list without error', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await modelManagerCommand.execute('list', dummyCtx as CommandContext);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('adds a model with /model add', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await modelManagerCommand.execute('add test-model http://localhost:1234/v1 test-id', dummyCtx as CommandContext);
    expect(dummyCtx.router?.reloadConfig).toHaveBeenCalled();
    spy.mockRestore();
  });
});
