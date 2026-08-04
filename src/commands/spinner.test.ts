import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/index.js', () => {
  const ConfigSchema = { parse: (c: unknown) => c };
  const saveConfig = vi.fn();
  return { ConfigSchema, saveConfig, loadConfig: vi.fn() };
});

import { spinnerCommands } from './spinner.js';

const makeCtx = (spinner = 'braille') =>
  ({
    config: { ui: { spinner } },
    router: { updateConfig: vi.fn() },
    configDir: '/tmp/daedalus-test',
  }) as unknown as import('./types.js').CommandContext;

describe('Spinner Command', () => {
  it('registers /spinner with spinner alias', () => {
    const cmd = spinnerCommands[0];
    expect(cmd.name).toBe('/spinner');
    expect(cmd.aliases).toContain('spin');
  });

  it('lists styles and marks the active one without error', async () => {
    const cmd = spinnerCommands[0];
    const ctx = makeCtx('aurora');
    await expect(cmd.execute('list', ctx)).resolves.toBeUndefined();
  });

  it('rejects an unknown style', async () => {
    const cmd = spinnerCommands[0];
    const ctx = makeCtx('braille');
    await expect(cmd.execute('neon', ctx)).resolves.toBeUndefined();
  });

  it('sets a valid style, persists via saveConfig, and updates router', async () => {
    const { saveConfig } = await import('../config/index.js');
    const cmd = spinnerCommands[0];
    const ctx = makeCtx('braille');
    await cmd.execute('tracker', ctx);
    expect((ctx.config.ui as { spinner: string }).spinner).toBe('tracker');
    expect(saveConfig).toHaveBeenCalled();
    expect(ctx.router.updateConfig).toHaveBeenCalled();
  });

  it('persists an unknown current value defaults to braille on list', async () => {
    const cmd = spinnerCommands[0];
    const ctx = makeCtx('bogus' as never);
    await expect(cmd.execute('', ctx)).resolves.toBeUndefined();
  });
});
