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

  it('syncs models from an endpoint via /model sync', async () => {
    // Write a config that has a freellmapi endpoint entry.
    const configDir = path.join(TEST_DIR, '.daedalus');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
      router: {
        strategy: 'priority',
        chain: [
          { name: 'freellmapi', endpoint: 'http://localhost:3001/v1', model: 'auto', priority: 0, enabled: true, provider: 'freellmapi' },
        ],
      },
    }));

    const catalog = [
      { id: 'auto', context_window: 128000, available: 1, display_name: 'Auto', intelligence_rank: 0, platform: 'cf' },
      { id: 'gemini-2.5-flash', context_window: 1000000, available: 1, display_name: 'Gemini 2.5 Flash', intelligence_rank: 5, platform: 'google' },
      { id: 'llama-3.3-70b', context_window: 128000, available: 0, display_name: 'Llama 3.3 70B', intelligence_rank: 20, platform: 'cf' },
    ];
    const syncCtx: Partial<CommandContext> = {
      ...dummyCtx,
      router: {
        reloadConfig: vi.fn(),
        syncCatalog: vi.fn().mockResolvedValue(catalog.map(c => ({
          id: c.id,
          displayName: c.display_name,
          contextWindow: c.context_window ?? null,
          available: c.available === 1,
          intelligenceRank: c.intelligence_rank ?? null,
          platform: c.platform ?? null,
        }))),
      } as any,
    };
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await modelManagerCommand.execute('sync freellmapi', syncCtx as CommandContext);
    spy.mockRestore();

    // Read the saved config back and verify entries were added (auto kept, 2 added).
    const saved = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
    const names = saved.router.chain.map((m: any) => m.name);
    expect(names).toContain('freellmapi');
    expect(names).toContain('freellmapi:gemini-2.5-flash');
    expect(names).toContain('freellmapi:llama-3.3-70b');
    const gemini = saved.router.chain.find((m: any) => m.name === 'freellmapi:gemini-2.5-flash');
    expect(gemini.enabled).toBe(true);
    const llama = saved.router.chain.find((m: any) => m.name === 'freellmapi:llama-3.3-70b');
    expect(llama.enabled).toBe(false); // unavailable -> disabled
    expect(syncCtx.router?.reloadConfig).toHaveBeenCalled();
  });
});
