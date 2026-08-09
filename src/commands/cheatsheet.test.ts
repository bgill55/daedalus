import { describe, it, expect, vi } from 'vitest';
import { cheatsheetCommand } from './cheatsheet.js';
import type { CommandContext } from './types.js';

describe('/cheatsheet command', () => {
  it('outputs the onboarding cheat sheet without throwing errors', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const dummyCtx = {} as CommandContext;

    await cheatsheetCommand.execute('', dummyCtx);

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('Daedalus Local-First Onboarding Cheat Sheet');
    expect(output).toContain('/onboard');
    expect(output).toContain('DAEDALUS_ALLOW_INSTALL');

    consoleSpy.mockRestore();
  });
});
