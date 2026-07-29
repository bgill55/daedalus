import fs from 'fs';
import path from 'path';
import pc from 'picocolors';

import { loadConfig, saveConfig } from '../config/index.js';
import type { Command, CommandContext } from './types.js';

interface Shortcut {
  alias: string;
  command: string;
}

class ShortcutManager {
  private shortcuts: Map<string, string>;
  private configPath: string;

  constructor(configDir: string) {
    this.configPath = path.join(configDir, '.daedalus', 'shortcuts.json');
    this.shortcuts = this.loadShortcuts();
  }

  private loadShortcuts(): Map<string, string> {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf8');
        const shortcuts: Shortcut[] = JSON.parse(content);
        return new Map(shortcuts.map(s => [s.alias, s.command]));
      }
    } catch (err) {
      console.error(pc.red(`[ERROR] Failed to load shortcuts: ${err}`));
    }
    return new Map();
  }

  private saveShortcuts(): void {
    try {
      const shortcuts: Shortcut[] = Array.from(this.shortcuts.entries()).map(([alias, command]) => ({ alias, command }));
      fs.writeFileSync(this.configPath, JSON.stringify(shortcuts, null, 2), 'utf8');
    } catch (err) {
      console.error(pc.red(`[ERROR] Failed to save shortcuts: ${err}`));
    }
  }

  getAll(): Map<string, string> {
    return this.shortcuts;
  }

  add(alias: string, command: string): void {
    this.shortcuts.set(alias, command);
    this.saveShortcuts();
  }

  remove(alias: string): void {
    this.shortcuts.delete(alias);
    this.saveShortcuts();
  }

  resolve(alias: string): string | undefined {
    return this.shortcuts.get(alias);
  }
}

export const shortcutCommand: Command = {
  name: '/shortcut',
  aliases: ['/sc'],
  description: 'Manage custom slash-command aliases',
  usage: '/shortcut [alias] = [command] | /shortcut list | /shortcut remove [alias]',
  helpText: 'Manage custom shortcuts for slash commands.\n\nExamples:\n  /shortcut qt = /test 1 -g\n  /shortcut cg = /callgraph\n  /shortcut list\n  /shortcut remove qt',
  execute: async (args, ctx) => {
    const manager = new ShortcutManager(ctx.configDir);
    const parts = args.trim().split(' ');

    if (parts[0] === 'list' || parts.length === 0) {
      const shortcuts = manager.getAll();
      if (shortcuts.size === 0) {
        console.log(pc.yellow('No shortcuts configured. Use /shortcut <alias> = <command> to add one.'));
        return;
      }
      console.log(pc.bold('\n=== Configured Shortcuts ==='));
      shortcuts.forEach((command, alias) => {
        console.log(`  ${pc.cyan(alias)} = ${command}`);
      });
      return;
    }

    if (parts[0] === 'remove' && parts[1]) {
      const alias = parts[1];
      if (manager.resolve(alias)) {
        manager.remove(alias);
        console.log(pc.green(`[OK] Removed shortcut: ${alias}`));
      } else {
        console.log(pc.red(`[ERROR] Shortcut not found: ${alias}`));
      }
      return;
    }

    const equalsIndex = parts.findIndex(p => p === '=');
    if (equalsIndex > 0) {
      const alias = parts.slice(0, equalsIndex).join(' ');
      const command = parts.slice(equalsIndex + 1).join(' ');
      if (!alias.startsWith('/')) {
        console.log(pc.red('[ERROR] Alias must start with /'));
        return;
      }
      if (!command.startsWith('/')) {
        console.log(pc.red('[ERROR] Command must start with /'));
        return;
      }
      manager.add(alias, command);
      console.log(pc.green(`[OK] Added shortcut: ${alias} = ${command}`));
      return;
    }

    console.log(pc.red('[ERROR] Invalid syntax. Usage:'));
    console.log(pc.gray('  /shortcut list - List all shortcuts'));
    console.log(pc.gray('  /shortcut <alias> = <command> - Add a shortcut'));
    console.log(pc.gray('  /shortcut remove <alias> - Remove a shortcut'));
  }
};