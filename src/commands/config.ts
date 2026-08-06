import pc from 'picocolors';
import { loadConfig, saveConfig } from '../config/index.js';
import { PRESETS, getPreset, applyPreset } from '../config/presets.js';
import type { Command, CommandContext } from './types.js';
import type { ModelEntry } from '../router/types.js';

export const presetCommand: Command = {
  name: '/preset',
  aliases: ['preset'],
  description: 'View or apply preset LLM router configurations',
  usage: '/preset [list | apply <preset_name>]',
  helpText: `Presets make setup instant by applying pre-configured router chains.

Available Presets:
  • local-free       - Local Free-Tier (LM Studio / Ollama defaults)
  • cloud-power      - Cloud Power (BYOK for OpenAI, Anthropic, OpenRouter)
  • hybrid           - Hybrid (Local fast tier + Cloud intelligence tier)
  • privacy-strict   - Privacy Strict (100% offline, local execution only)

Examples:
  /preset list
  /preset apply hybrid
  /preset local-free`,
  execute: async (args: string, ctx: CommandContext) => {
    const trimmed = args.trim();
    const parts = trimmed.split(/\s+/);
    const sub = parts[0]?.toLowerCase() || '';

    if (!trimmed || sub === 'list') {
      console.log(pc.bold('\n=== 🎛️ DAEDALUS CONFIGURATION PRESETS ==='));
      for (const [id, preset] of Object.entries(PRESETS)) {
        console.log(`\n  ${pc.cyan(pc.bold(preset.name))} (${pc.yellow(id)})`);
        console.log(`    ${preset.description}`);
        console.log(`    Models (${preset.chain.length}): ${preset.chain.map(m => m.name).join(', ')}`);
      }
      console.log(pc.gray('\n  To apply a preset: ') + pc.cyan('/preset apply <name>'));
      console.log();
      return;
    }

    let presetName = sub === 'apply' ? parts[1] : sub;
    if (!presetName) {
      console.log(pc.red('\n[WARN] Please specify a preset name. Example: /preset apply hybrid'));
      return;
    }

    presetName = presetName.toLowerCase().trim();
    const preset = getPreset(presetName);
    if (!preset) {
      console.log(pc.red(`\n[ERROR] Unknown preset "${presetName}". Available: ${Object.keys(PRESETS).join(', ')}`));
      return;
    }

    const current = loadConfig();
    const updated = applyPreset(current, presetName);
    saveConfig(updated);

    if (ctx.router) {
      ctx.router.reloadConfig(updated.router);
    }

    console.log(pc.green(`\n✔ Successfully applied preset "${pc.bold(preset.name)}"!`));
    console.log(pc.gray(`  Model chain updated with ${preset.chain.length} entry/entries.`));
    console.log(pc.gray('  Saved minimal config to ~/.daedalus/config.json\n'));
  },
};

export const modelManagerCommand: Command = {
  name: '/model',
  aliases: ['models-manage'],
  description: 'Manage router models (list, add, remove, enable, disable)',
  usage: '/model [list | add <name> <endpoint> <model> | remove <name> | enable <name> | disable <name> | sync [endpoint-name]]',
  helpText: `Inspect and manage model entries in your local router chain.\n\nSubcommands:\n  list                 - List all configured models and their health/priority\n  add <name> <url> <m> - Add a new model entry\n  remove <name>        - Remove a model entry\n  enable <name>        - Enable a model entry\n  disable <name>       - Disable a model entry\n  sync [endpoint-name] - Pull models from an OpenAI-compatible /v1/models catalog\n                        (defaults to the freellmapi endpoint) and add them as\n                        individually-selectable entries. The "auto" entry is kept.\n\nExamples:\n  /model list\n  /model add openai https://api.openai.com/v1 gpt-4o\n  /model disable lmstudio-gemma\n  /model sync freellmapi`,
  execute: async (args: string, ctx: CommandContext) => {
    const trimmed = args.trim();
    const parts = trimmed.split(/\s+/);
    const sub = parts[0]?.toLowerCase() || 'list';

    const config = loadConfig();
    const chain = config.router.chain;

    if (sub === 'list' || !trimmed) {
      console.log(pc.bold('\n=== 🤖 ROUTER MODEL CHAIN ==='));
      if (chain.length === 0) {
        console.log(pc.yellow('  No models configured. Run /onboard or /preset apply local-free'));
        console.log();
        return;
      }
      chain.forEach((m, idx) => {
        const status = m.enabled ? pc.green('● ENABLED') : pc.gray('○ DISABLED');
        const tier = m.tier ? pc.cyan(`[${m.tier.toUpperCase()}]`) : '';
        console.log(`  ${idx + 1}. ${pc.bold(m.name)} ${tier} — ${status}`);
        console.log(`     Endpoint: ${pc.gray(m.endpoint)}`);
        console.log(`     Model ID: ${pc.gray(m.model)} | Priority: ${m.priority}`);
        if (m.apiKey) {
          console.log(`     API Key:  ${pc.gray('***' + m.apiKey.slice(-4))}`);
        }
      });
      console.log(pc.gray('\n  Use /model add or /model remove <name> to modify models.\n'));
      return;
    }

    if (sub === 'remove' || sub === 'rm' || sub === 'delete') {
      const targetName = parts[1]?.toLowerCase();
      if (!targetName) {
        console.log(pc.red('\n[WARN] Please specify model name to remove. Example: /model remove lmstudio-gemma'));
        return;
      }
      const initialCount = chain.length;
      config.router.chain = chain.filter(m => m.name.toLowerCase() !== targetName);

      if (config.router.chain.length === initialCount) {
        console.log(pc.red(`\n[ERROR] Model "${targetName}" not found in config.`));
        return;
      }

      saveConfig(config);
      if (ctx.router) ctx.router.reloadConfig(config.router);
      console.log(pc.green(`\n✔ Removed model "${targetName}" from router chain.`));
      return;
    }

    if (sub === 'enable' || sub === 'disable') {
      const targetName = parts[1]?.toLowerCase();
      if (!targetName) {
        console.log(pc.red(`\n[WARN] Please specify model name to ${sub}.`));
        return;
      }
      const entry = chain.find(m => m.name.toLowerCase() === targetName);
      if (!entry) {
        console.log(pc.red(`\n[ERROR] Model "${targetName}" not found.`));
        return;
      }
      entry.enabled = sub === 'enable';
      saveConfig(config);
      if (ctx.router) ctx.router.reloadConfig(config.router);
      console.log(pc.green(`\n✔ Model "${entry.name}" is now ${sub.toUpperCase()}D.`));
      return;
    }

    if (sub === 'add') {
      const name = parts[1];
      const endpoint = parts[2];
      const model = parts[3];

      if (!name || !endpoint || !model) {
        console.log(pc.red('\n[WARN] Missing arguments. Usage: /model add <name> <endpoint_url> <model_id>'));
        console.log(pc.gray('Example: /model add openai https://api.openai.com/v1 gpt-4o'));
        return;
      }

      const newEntry = {
        name,
        endpoint,
        model,
        priority: chain.length,
        enabled: true,
        supportsTools: true,
        tier: 'intelligence' as const,
      };

      config.router.chain.push(newEntry);
      saveConfig(config);
      if (ctx.router) ctx.router.reloadConfig(config.router);
      console.log(pc.green(`\n✔ Added model "${name}" (${model}) at ${endpoint}.`));
      return;
    }

    if (sub === 'sync') {
      const target = parts[1];
      try {
        const catalog = await ctx.router.syncCatalog(target);
        if (catalog.length === 0) {
          console.log(pc.yellow('\nNo models returned from the endpoint. It may be down or keyless-blocked.'));
          return;
        }
        const sourceName = target
          ? (config.router.chain.find(e => e.name.toLowerCase() === target.toLowerCase())?.name ?? target)
          : (config.router.chain.find(e => e.provider === 'freellmapi')?.name
            ?? config.router.chain.find(e => e.enabled)?.name
            ?? target ?? 'endpoint');
        const existing = new Map(config.router.chain.map(m => [m.name.toLowerCase(), m]));
        let added = 0;
        let updated = 0;
        for (const row of catalog) {
          const entryName = `${sourceName}:${row.id}`;
          const key = entryName.toLowerCase();
          if (existing.has(key)) {
            const e = existing.get(key)!;
            e.model = row.id;
            e.endpoint = config.router.chain.find(c => c.name === sourceName)?.endpoint ?? e.endpoint;
            e.enabled = row.available;
            e.maxTokens = row.contextWindow ?? e.maxTokens;
            updated++;
            continue;
          }
          const rank = row.intelligenceRank ?? 50;
          const newEntry: ModelEntry = {
            name: entryName,
            endpoint: config.router.chain.find(c => c.name === sourceName)?.endpoint ?? '',
            model: row.id,
            priority: rank,
            enabled: row.available,
            supportsTools: true,
            tier: 'intelligence',
            provider: 'freellmapi',
            maxTokens: row.contextWindow ?? undefined,
          };
          config.router.chain.push(newEntry);
          existing.set(key, newEntry);
          added++;
        }
        saveConfig(config);
        if (ctx.router) ctx.router.reloadConfig(config.router);
        console.log(pc.green(`\n✔ Synced ${catalog.length} models from "${sourceName}".`));
        console.log(pc.gray(`  Added ${added}, updated ${updated}. The "auto" entry is kept as the smart default.`));
        console.log(pc.gray('  Only currently-available models are enabled; unavailable ones are listed but disabled.'));
        console.log(pc.gray('  Pick a specific model with /model, or let Daedalus route automatically via "auto".\n'));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(pc.red(`\n[ERROR] ${msg}`));
      }
      return;
    }

    console.log(pc.red(`\n[WARN] Unknown subcommand "${sub}". Type /help /model for usage.`));
  },
};
