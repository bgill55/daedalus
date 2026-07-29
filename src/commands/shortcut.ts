import fs from 'fs';
import path from 'path';
import pc from 'picocolors';

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
        const parsed = JSON.parse(content);

        // Bug 4 fix: handle both array format (legacy) and object format
        if (Array.isArray(parsed)) {
          return new Map((parsed as Shortcut[]).map(s => [s.alias, s.command]));
        }

        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const map = new Map<string, string>();
          for (const [alias, command] of Object.entries(parsed)) {
            if (typeof command === 'string') map.set(alias, command);
          }
          return map;
        }
      }
    } catch {
      // silently return empty map on any parse/read error
    }
    return new Map();
  }

  private saveShortcuts(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const record: Record<string, string> = {};
      this.shortcuts.forEach((command, alias) => { record[alias] = command; });
      fs.writeFileSync(this.configPath, JSON.stringify(record, null, 2), 'utf8');
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

function normalizeAlias(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export const shortcutCommand: Command = {
  name: '/shortcut',
  aliases: ['/sc'],
  description: 'Manage custom slash-command aliases',
  usage: '/shortcut [alias] = [command] | /shortcut list | /shortcut remove [alias]',
  helpText: 'Manage custom shortcuts for slash commands.\n\nExamples:\n  /shortcut qt = /test 1 -g\n  /shortcut cg = /callgraph\n  /shortcut list\n  /shortcut remove qt',
  execute: async (args, ctx) => {
    const manager = new ShortcutManager(ctx.configDir);

    // Bug 5 fix: check trimmed string before splitting to correctly detect empty args
    const trimmed = args.trim();
    if (trimmed === '' || trimmed === 'list') {
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

    // Bug 5 fix: use whitespace-normalizing tokenization to avoid empty tokens
    const parts = trimmed.split(/\s+/).filter(Boolean);

    if (parts[0] === 'remove' && parts[1]) {
      // Bug 5 fix: normalize alias on remove so 'remove qt' matches what '/shortcut qt = ...' stored
      const alias = normalizeAlias(parts[1]);
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
      const rawAlias = parts.slice(0, equalsIndex).join(' ');
      const command = parts.slice(equalsIndex + 1).join(' ');

      // Bug 5 fix: normalize alias — accept 'qt' and store as '/qt', matching docs examples
      const alias = normalizeAlias(rawAlias);

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