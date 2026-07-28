import pc from 'picocolors';

import { contextCommands } from './context.js';
import { agentCommands } from './agents.js';
import { feedbackCommand } from './feedback.js';
import { devCommands } from './dev.js';
import type { Command, CommandContext } from './types.js';

export type { Command, CommandContext } from './types.js';

const helpCommand: Command = {
  name: '/help',
  aliases: ['?', 'help'],
  description: 'Show available commands or detailed help for a specific command',
  usage: '/help [command_name]',
  helpText: 'Display general help or a detailed "man page" for a given slash command.',
  execute: async (args, _ctx) => {
    const query = args.trim().toLowerCase();
    if (query) {
      const cmdName = query.startsWith('/') ? query : `/${query}`;
      const cmd = commandsList.find(c =>
        c.name.toLowerCase() === cmdName ||
        c.name.toLowerCase() === query ||
        c.aliases?.some(alias => alias.toLowerCase() === cmdName || alias.toLowerCase() === query)
      );

      if (!cmd) {
        console.log(pc.red(`\n  [WARN] Unknown command: "${query}". Type /help to see all commands.`));
        return;
      }

      console.log(pc.bold(`\n=== COMMAND MANUAL: ${cmd.name} ===`));
      console.log(`  ${pc.bold('Description:')} ${cmd.description}`);
      if (cmd.usage) {
        console.log(`  ${pc.bold('Usage:')}       ${pc.cyan(cmd.usage)}`);
      }
      if (cmd.aliases && cmd.aliases.length > 0) {
        const formattedAliases = cmd.aliases.map(a => a.startsWith('/') ? a : `/${a}`).join(', ');
        console.log(`  ${pc.bold('Aliases:')}     ${pc.yellow(formattedAliases)}`);
      }
      if (cmd.helpText) {
        console.log(`\n${pc.bold('Details:')}\n${cmd.helpText.split('\n').map(line => `  ${line}`).join('\n')}`);
      }
      console.log(pc.bold('='.repeat(20 + cmd.name.length)));
      console.log();
      return;
    }

    console.log(pc.bold('\n--- Available Commands ---'));
    for (const cmd of commandsList) {
      const aliasList = cmd.aliases ? cmd.aliases.map(a => a.startsWith('/') ? a : `/${a}`) : [];
      const nameAndAliases = [cmd.name, ...aliasList].join(', ');
      console.log(`  ${pc.cyan(nameAndAliases.padEnd(30))} - ${cmd.description}`);
    }
    console.log(pc.bold('--------------------------'));
    console.log(pc.gray('  Detailed documentation: ') + pc.underline(pc.cyan('https://bgill55.github.io/daedalus/#/')));
    console.log(pc.gray('  Tip: Type ') + pc.cyan('/help <command>') + pc.gray(' for detailed usage and subcommands (e.g. /help config)'));
    console.log();
  }
};

export const commandsList: Command[] = [
  ...contextCommands,
  ...agentCommands,
  ...devCommands,
  feedbackCommand,
  helpCommand,
];

export async function executeCommand(input: string, ctx: CommandContext): Promise<boolean> {
  const trimmed = input.trim();
  if (!trimmed) return false;

  const parts = trimmed.split(/\s+/);
  const commandName = parts[0].toLowerCase();
  const args = trimmed.substring(parts[0].length).trim();

  let mappedName = commandName;
  if (commandName === '?' || commandName === 'help') {
    mappedName = '/help';
  }

  const command = commandsList.find(c =>
    c.name.toLowerCase() === mappedName ||
    c.aliases?.some(alias => alias.toLowerCase() === mappedName)
  );

  if (command) {
    if (command.name === '/tui') {
      await command.execute(args, ctx);
      return true;
    }
    try {
      await command.execute(args, ctx);
    } catch (err: any) {
      console.log(pc.red(`[ERROR] Command ${command.name} failed: ${err.message}`));
    }
    return true;
  }

  if (trimmed.startsWith('/')) {
    console.log(pc.red(`[WARN] Unknown command: ${commandName}. Type /help or ? to view all available commands.`));
    return true;
  }

  return false;
}
