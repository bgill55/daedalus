import pc from 'picocolors';
import { loadConfig, saveConfig } from '../config/index.js';
import { ok, info, warn } from '../ui/theme.js';
import type { Command, CommandContext } from './types.js';

export const gitAutoBranchCommand: Command = {
  name: '/gitautobranch',
  aliases: ['gitautobranch'],
  description: 'Toggle automatic branch-from-base for single-agent tasks',
  usage: '/gitautobranch [on|off]',
  helpText:
    'Toggle whether single-agent coding tasks start on a fresh branch off the detected base branch (main/master).\n\n' +
    'When ON, Daedalus branches from base at the start of a task (only when the working tree is clean and you are on the base branch), so work never piles onto a stale branch. There is no auto-merge in interactive mode — you merge the work branch back when ready (or use /autopilot, which merges automatically).\n\n' +
    'When OFF (default), single-agent mode works directly on whatever branch you are on.\n\n' +
    'Arguments:\n' +
    '  (no args)   Show the current state\n' +
    '  on          Enable automatic branch-from-base\n' +
    '  off         Disable it\n\n' +
    'The setting persists to ~/.daedalus/config.json (git.autoBranchFromBase).',
  execute: async (args: string, _ctx: CommandContext) => {
    const arg = args.trim().toLowerCase();
    const config = loadConfig();
    const current = config.git?.autoBranchFromBase ?? false;

    if (!arg || arg === 'status') {
      console.log(`\n  ${pc.bold('Automatic branch-from-base:')} ${current ? ok('ON') : info('OFF')}`);
      console.log(`  ${pc.dim('Toggle with /gitautobranch on | off')}`);
      console.log();
      return;
    }

    if (arg !== 'on' && arg !== 'off') {
      console.log(pc.yellow(`\n  [WARN] Unknown argument "${arg}". Use /gitautobranch on | off.`));
      console.log();
      return;
    }

    const next = arg === 'on';
    if (!config.git) config.git = { autoBranchFromBase: false };
    config.git.autoBranchFromBase = next;
    saveConfig(config);

    console.log(`\n  ${ok('[OK]')} Automatic branch-from-base ${next ? 'enabled' : 'disabled'}.`);
    if (next) {
      console.log(pc.gray('  Single-agent tasks will branch from main/master at start (clean tree only).'));
    }
    console.log();
  },
};
