---
name: add-slash-command
description: How to add a new slash command to Daedalus (src/commands), including the docs-sync step that breaks CI if skipped.
trigger: add a command|new /command|create a slash command|add /command|/command
safety: instructions
---

# Adding a Slash Command to Daedalus

Commands live in `src/commands/` and are aggregated in `src/commands/index.ts`.
ESM only, named exports, `.js` extension on imports, no comments unless necessary.

## Command shape
`src/commands/types.ts` defines `Command`:
```ts
export interface Command {
  name: string;            // '/spinner'
  aliases?: string[];      // ['spin']
  description: string;
  usage?: string;
  helpText?: string;
  execute: (args: string, ctx: CommandContext) => Promise<boolean | void>;
}
```

## Steps
1. Create `src/commands/<name>.ts` exporting `export const <name>Commands: Command[]`.
   Inside `execute`, use `ctx.config` (typed `DaedalusConfig`), `ctx.configDir`, `ctx.router`.
2. To persist a config change, mirror `/config` (src/commands/dev.ts ~line 964):
   ```ts
   const { saveConfig, ConfigSchema } = await import('../config/index.js');
   ctx.config.ui.spinner = arg;
   const validated = ConfigSchema.parse(ctx.config);
   ctx.config = validated;
   saveConfig(validated);
   if (ctx.router && typeof ctx.router.updateConfig === 'function') {
     ctx.router.updateConfig(ctx.config.router);
   }
   ```
   Validate input BEFORE mutating; reject unknown values with a friendly message.
3. Register in `src/commands/index.ts`:
   `import { <name>Commands } from './<name>.js';` then spread `...<name>Commands,` into `commandsList`.
4. CRITICAL — docs will break CI if you skip this. `src/docs.test.ts` has two tests
   that fail unless the command is in BOTH the docs generator and the test's own copy:
   - `scripts/sync-docs.ts`: add the command to `COMMAND_GROUPS` (array) AND `COMMAND_USAGES` (map).
   - `src/docs.test.ts`: add the SAME entries to its duplicate `COMMAND_GROUPS` + `COMMAND_USAGES`.
   - Then run `npm run sync-docs` to regenerate README.md + docs/configuration-reference.md.
   The usual failure: a missing `COMMAND_USAGES` entry → test says "commands table is out of sync".
5. Add `src/commands/<name>.test.ts`. For config-persisting commands, `vi.mock('../config/index.js')`
   with `{ ConfigSchema: { parse: (c) => c }, saveConfig: vi.fn() }` so no real disk write;
   assert `saveConfig` called and `ctx.router.updateConfig` fired.

## Verify before commit
```
npx tsc --noEmit
npm run lint
npm test
```
`docs.test.ts` is the easy one to break — always run `npm run sync-docs` after touching groups/usages.

## PR + release notes
- PR title scope with a comma (`fix(tools,router):`) is rejected by the title guard; use a single scope.
- `require()`-style imports in test files trip `no-require-imports`; use ESM imports.
- The Release workflow may not auto-trigger on squash-merge; dispatch manually:
  `gh workflow run release.yml`.
