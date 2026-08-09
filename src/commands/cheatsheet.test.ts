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

  it('matches docs/cheat-sheet.md: full /preset options, /model disable+sync, and guardrail names', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await cheatsheetCommand.execute('', {} as CommandContext);
    const output = consoleSpy.mock.calls[0][0] as string;
    consoleSpy.mockRestore();

    // /preset must list every preset from docs/cheat-sheet.md
    expect(output).toContain('local-free');
    expect(output).toContain('cloud-power');
    expect(output).toContain('hybrid');
    expect(output).toContain('privacy-strict');

    // /model must include disable and sync (not just list/add/remove/enable)
    expect(output).toContain('disable');
    expect(output).toContain('/model sync');

    // Guardrail names must be fully spelled out (no abbreviated/incorrect variants)
    expect(output).toContain('Command Circuit Breaker');
    expect(output).toContain('Batch Short-Circuit');
    expect(output).toContain('Pre-Flight Codebase Auditing (Task 0)');
  });
});
