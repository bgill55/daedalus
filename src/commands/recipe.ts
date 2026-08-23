import pc from 'picocolors';
import { Command, CommandContext } from './types.js';
import { listRecipes, loadRecipeFromFile, DaedalusRecipe } from '../recipes/index.js';
import { buildTodoContext } from '../tools/builtin/todo.js';
import fs from 'fs';
import path from 'path';

export const recipeCommand: Command = {
  name: '/recipe',
  description: 'Manage and run portable YAML recipes (/recipe [list | run <name> | create <name>])',
  helpText: 'Manage and run portable YAML recipes. Usage: /recipe [list | run <name> | create <name>].',
  execute: async (args: string, ctx: CommandContext) => {
    const trimmed = args.trim();
    const parts = trimmed.split(/\s+/);
    const sub = parts[0]?.toLowerCase() || 'list';

    if (sub === 'list' || !trimmed) {
      const recipes = listRecipes(ctx.toolContext.projectRoot, ctx.configDir);
      if (recipes.length === 0) {
        console.log(pc.yellow('\n  No recipes found.'));
        console.log(pc.dim('  Create a YAML recipe in .daedalus/recipes/<name>.yaml or run /recipe create <name>.\n'));
        return;
      }

      console.log(pc.cyan('\n=== Portable Recipes (.daedalus/recipes/) ===\n'));
      for (const r of recipes) {
        console.log(`  ${pc.bold(r.name.padEnd(20))} ${pc.dim(r.description || 'No description')}`);
        if (r.role) console.log(`  ${pc.dim('  Role:')} ${pc.cyan(r.role)}`);
        if (r.skills && r.skills.length > 0) console.log(`  ${pc.dim('  Skills:')} ${r.skills.join(', ')}`);
        console.log(`  ${pc.dim('  File:')} ${r.filePath}\n`);
      }
      return;
    }

    if (sub === 'run') {
      const name = parts[1];
      if (!name) {
        console.log(pc.red('\n  [ERROR] Usage: /recipe run <name>'));
        return;
      }

      const recipes = listRecipes(ctx.toolContext.projectRoot, ctx.configDir);
      const recipe = recipes.find(r => r.name.toLowerCase() === name.toLowerCase());
      if (!recipe) {
        console.log(pc.red(`\n  [ERROR] Recipe "${name}" not found. Run /recipe list to see available recipes.`));
        return;
      }

      console.log(pc.cyan(`\n  [RECIPE] Running recipe: ${pc.bold(recipe.name)}`));
      if (recipe.role) {
        ctx.toolContext.agentRole = recipe.role;
        console.log(pc.dim(`  Role targeted: ${recipe.role}`));
      }

      // Inject prompt into assistant execution turn
      const userContent = `${buildTodoContext(ctx.sessionManager.sessionId)}${ctx.buildFileContext()}Recipe Prompt: ${recipe.prompt}`;
      await ctx.callModelWithTools(userContent);
      return;
    }

    if (sub === 'create') {
      const name = parts[1];
      if (!name) {
        console.log(pc.red('\n  [ERROR] Usage: /recipe create <name>'));
        return;
      }

      const dir = path.join(ctx.toolContext.projectRoot, '.daedalus', 'recipes');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const targetFile = path.join(dir, `${name.toLowerCase()}.yaml`);
      const template = `name: ${name}
description: Reusable playbook for ${name}
role: coder
skills: []
prompt: |
  Describe the steps for ${name} here.
`;
      fs.writeFileSync(targetFile, template, 'utf8');
      console.log(pc.green(`\n  [OK] Created recipe template: ${targetFile}`));
      return;
    }

    console.log(pc.yellow('\n  Usage: /recipe [list | run <name> | create <name>]'));
  },
};
