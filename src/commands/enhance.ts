import pc from 'picocolors';
import { printUserTurn } from '../formatting.js';
import type { Command, CommandContext } from './types.js';

export const ENHANCE_SYSTEM_PROMPT = `You are a prompt engineering specialist for AI coding agents. 
Expand the user's raw or casual request into a crisp, high-yield, structured prompt.
Requirements:
1. Specify clear scope and target areas.
2. Include concrete structure expectations (e.g. tables for architecture, bulleted recommendations).
3. Set explicit acceptance criteria (e.g. top 3 security/performance wins, test gaps).
4. Keep the enhanced prompt direct and actionable.
5. Return ONLY the enhanced prompt string without meta-commentary or wrapping quotes.`;

export async function enhancePrompt(rawPrompt: string, ctx: CommandContext): Promise<string> {
  const fullPrompt = `${ENHANCE_SYSTEM_PROMPT}\n\nUser request to enhance: "${rawPrompt}"`;

  try {
    if (typeof ctx.callModelWithFallback === 'function') {
      const res = await ctx.callModelWithFallback(fullPrompt);
      if (res && res.trim()) {
        return res.trim();
      }
    }
  } catch (_err) {
    // Fallback if model call fails
  }

  return `Review and analyze: "${rawPrompt}". Summarize key components, identify test gaps, and provide top 3 actionable improvement suggestions.`;
}

export const enhanceCommand: Command = {
  name: '/enhance',
  aliases: ['prompt', 'refine'],
  description: 'Auto-expand a casual user request into a structured, high-performing engineering prompt',
  usage: '/enhance [raw request]',
  helpText: 'Takes a casual request like "look at this project" and uses Daedalus to expand it into a structured engineering prompt with clear scope, architecture targets, and acceptance criteria.',
  execute: async (args: string, ctx: CommandContext): Promise<boolean | void> => {
    let rawQuery = args.trim();

    if (!rawQuery) {
      if (typeof ctx.askLine === 'function') {
        rawQuery = await ctx.askLine(pc.cyan('Enter raw prompt to enhance: '));
        rawQuery = rawQuery.trim();
      }
    }

    if (!rawQuery) {
      console.log(pc.yellow('\n  [WARN] No prompt provided to enhance. Usage: /enhance <request>'));
      return;
    }

    console.log(pc.cyan('\n  🪄 Enhancing prompt with Daedalus...'));
    const enhanced = await enhancePrompt(rawQuery, ctx);

    console.log(pc.bold('\n=== 🪄 ENHANCED PROMPT ==='));
    console.log(`\n${pc.yellow(enhanced)}\n`);
    console.log(pc.bold('=========================\n'));

    if (typeof ctx.askLine === 'function') {
      const confirm = await ctx.askLine(pc.green('Proceed with this enhanced prompt? (Y/n): '));
      const answer = confirm.trim().toLowerCase();
      if (answer === '' || answer === 'y' || answer === 'yes') {
        if (typeof ctx.callModelWithTools === 'function') {
          const indexCtx = typeof ctx.buildIndexContext === 'function' ? await ctx.buildIndexContext(enhanced) : '';
          const filesCtx = typeof ctx.buildFileContext === 'function' ? ctx.buildFileContext() : '';
          const userContent = `${indexCtx}${filesCtx}User Prompt: ${enhanced}`;
          printUserTurn(enhanced);
          await ctx.callModelWithTools(userContent);
        } else {
          ctx.messages.push({ role: 'user', content: enhanced });
        }
        return true;
      } else {
        console.log(pc.dim('  Enhanced prompt discarded.'));
      }
    }
  },
};
