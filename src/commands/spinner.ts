import pc from 'picocolors';
import type { Command, CommandContext } from './types.js';

// Styles must match the zod enum in src/config/index.ts (ui.spinner).
const SPINNER_STYLES = ['braille', 'tracker', 'aurora'] as const;
type SpinnerStyle = (typeof SPINNER_STYLES)[number];

// Tiny preview frames so the user can see the vibe of each style.
const PREVIEWS: Record<SpinnerStyle, string[]> = {
  braille: ['⠋', '⠙', '⠹', '⠸', '⠼'],
  tracker: ['▰▱▱▱▱▱▱▱ ▰', '▱▰▱▱▱▱▱▱ ▰▰', '▱▱▰▱▱▱▱▱ ▰▰▰', '▱▱▱▰▱▱▱▱ ▰▰▰▰'],
  aurora: ['▁▂▃▄▅▆▇▆▅▄▃▂▁', '▂▃▄▅▆▇▆▅▄▃▂▁▂', '▃▄▅▆▇▆▅▄▃▂▁▂▃', '▄▅▆▇▆▅▄▃▂▁▂▃▄'],
};

const COLORS: Record<SpinnerStyle, (s: string) => string> = {
  braille: (s) => pc.cyan(s),
  tracker: (s) => pc.cyan(s),
  aurora: (s) => pc.magenta(s),
};

function isSpinnerStyle(value: string): value is SpinnerStyle {
  return (SPINNER_STYLES as readonly string[]).includes(value);
}

function currentStyle(ctx: CommandContext): SpinnerStyle {
  const s = ctx.config.ui?.spinner;
  return isSpinnerStyle(s ?? '') ? s : 'braille';
}

function listSpinners(ctx: CommandContext): void {
  const active = currentStyle(ctx);
  console.log(pc.bold('\n=== Thinking Spinner Styles ==='));
  for (const style of SPINNER_STYLES) {
    const marker = style === active ? pc.green(' ●') : pc.gray(' ○');
    const preview = PREVIEWS[style].map((f) => COLORS[style](f)).join(' ');
    console.log(`  ${pc.bold(style.padEnd(9))}${marker}  ${preview}  Daedalus thinking...`);
  }
  console.log(pc.gray('\n  Switch: /spinner <braille|tracker|aurora>'));
  console.log(pc.gray('  Current: ') + pc.cyan(active));
  console.log();
}

export const spinnerCommands: Command[] = [
  {
    name: '/spinner',
    aliases: ['spin'],
    description: 'List or switch the "thinking" spinner style on the fly',
    usage: '/spinner [list | braille | tracker | aurora]',
    helpText:
      'Without arguments (or with "list") shows every available thinking-spinner style with a live preview and marks the active one.\n' +
      'Pass a style name to switch immediately and persist it to config.json — no restart or manual edit needed.\n' +
      'Styles:\n' +
      '  braille  – smooth braille dots (default)\n' +
      '  tracker  – cyan seek-bar sweep ("daemon grinding")\n' +
      '  aurora   – magenta ramp-wave shimmer ("AI breathing")',
    execute: async (args: string, ctx: CommandContext) => {
      const arg = args.trim().toLowerCase();

      if (!arg || arg === 'list') {
        listSpinners(ctx);
        return;
      }

      if (!isSpinnerStyle(arg)) {
        console.log(pc.red(`\n  [WARN] Unknown spinner style: "${arg}".`));
        console.log(pc.gray('  Valid styles: ') + SPINNER_STYLES.map((s) => pc.cyan(s)).join(', '));
        console.log(pc.gray('  Usage: /spinner [list | braille | tracker | aurora]'));
        console.log();
        return;
      }

      try {
        const { saveConfig, ConfigSchema } = await import('../config/index.js');
        if (!ctx.config.ui) {
          (ctx.config as Record<string, unknown>).ui = {};
        }
        ctx.config.ui.spinner = arg;
        const validated = ConfigSchema.parse(ctx.config);
        ctx.config = validated;
        saveConfig(validated);
        if (ctx.router && typeof ctx.router.updateConfig === 'function') {
          ctx.router.updateConfig(ctx.config.router);
        }
        const preview = PREVIEWS[arg].map((f) => COLORS[arg](f)).join(' ');
        console.log(pc.green(`\n  [OK] Thinking spinner set to "${arg}".`));
        console.log(pc.gray('  Preview: ') + `${preview} Daedalus thinking...`);
        console.log(pc.gray('  Persisted to config.json — takes effect on the next "thinking" turn.\n'));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(pc.red(`\n  [WARN] Could not set spinner style: ${msg}\n`));
      }
    },
  },
];
