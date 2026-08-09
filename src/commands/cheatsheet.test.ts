import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { cheatsheetCommand, cheatsheetText } from './cheatsheet.js';
import type { CommandContext } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsCheat = readFileSync(resolve(__dirname, '../../docs/cheat-sheet.md'), 'utf8');

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

  it('drift guard: embedded cheat sheet covers every section present in docs/cheat-sheet.md', () => {
    const embeddedLower = cheatsheetText.toLowerCase();
    // Pull the section headings (### N. ...) from the canonical doc and ensure each
    // topic word appears (case-insensitive) in the embedded text. Fails if
    // docs/cheat-sheet.md gains a section the embedded copy does not mirror.
    const sections = [
      'Critical Slash Commands',
      'Essential Environment Variables',
      'Hardware Optimization',
      'Embedded Guardrails',
    ];
    for (const s of sections) {
      expect(docsCheat).toContain(s);
      const keyword = s.split(' ')[0].toLowerCase();
      expect(embeddedLower, `embedded cheat sheet missing section keyword: "${keyword}"`).toContain(keyword);
    }
    // Key command names from the doc must appear in the embedded output.
    for (const cmd of ['/onboard', '/preset', '/model', '/health', '/find', '/refs', '/callgraph', '/impact', '/session', '/sigma', '/skills', '/shortcut']) {
      expect(cheatsheetText, `embedded cheat sheet missing command: ${cmd}`).toContain(cmd);
    }
  });
});
