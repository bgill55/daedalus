import { describe, it, expect, vi } from 'vitest';
import { presetCommand, modelManagerCommand } from './config.js';
import type { CommandContext } from './types.js';

describe('config slash commands', () => {
  const dummyCtx: Partial<CommandContext> = {
    configDir: process.cwd(),
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
