import pc from 'picocolors';
import { printUserTurn, turnSeparator } from '../formatting.js';
import { extractAndSave } from '../extraction.js';
import { getSessionTodos } from '../tools/builtin/todo.js';
import type { Command, CommandContext } from './types.js';

export const ENHANCE_SYSTEM_PROMPT = `You are an expert prompt engineer for AI coding agents. 
Expand the user's raw or casual request into a crisp, high-yield engineering prompt for Daedalus.
Rules for the generated prompt:
1. Direct the agent to inspect relevant files and codebase context before answering.
2. Direct the agent to format its output cleanly with Markdown section headers, comparison tables, and bullet points.
3. Specify concrete target deliverables (e.g. architecture table, code quality table, top 3 security/performance recommendations).
4. NEVER request plain text without formatting or forbid markdown formatting.
5. NEVER output empty template placeholders, empty table cells (e.g. "| Aspect | | |"), or bracketed fill-ins (e.g. "[Specific recommendation]"). Instead, write clear instructions directing the agent to analyze and populate those sections.
6. Return ONLY the final enhanced prompt text without meta-commentary, introductory remarks, or surrounding quote marks.`;

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

  return `Perform a comprehensive technical audit of the codebase:
1. Inspect project structure, configuration files, and core source files.
2. Provide a Project Overview table listing Component, Responsibility, and Key Files.
3. Provide a Code Quality Assessment table evaluating Type Safety, Error Handling, Code Organization, Test Coverage, and Documentation with Rating and Notes for each.
4. List Top 5 specific security and performance recommendations with rationale.
5. Summarize overall codebase health and production readiness.`;
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
          if (ctx.messages.length > 0 && ctx.messages[0].role === 'system' && typeof ctx.getSystemPromptWithMemory === 'function') {
            ctx.messages[0] = { role: 'system', content: ctx.getSystemPromptWithMemory(enhanced) };
          }
          await ctx.callModelWithTools(userContent);
          if (ctx.sessionManager?.sessionDb) {
            ctx.sessionManager.saveSessionState(ctx.messages, ctx.activeFiles, getSessionTodos(ctx.sessionManager.sessionId));
          }
          if (ctx.router && ctx.sessionManager) {
            await extractAndSave(ctx.router, ctx.sessionManager, ctx.messages);
          }
          turnSeparator();
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
