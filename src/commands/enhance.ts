import pc from 'picocolors';
import { printUserTurn, turnSeparator } from '../formatting.js';
import { extractAndSave } from '../extraction.js';
import { getSessionTodos } from '../tools/builtin/todo.js';
import type { Command, CommandContext } from './types.js';

export const ENHANCE_SYSTEM_PROMPT = `You are an expert prompt engineer for AI coding agents. 
Expand the user's raw or casual request into a crisp, high-yield engineering prompt for Daedalus.
Rules for the generated prompt:
1. Frame the prompt as a direct action command instructing the agent to perform the task and write out its completed report.
2. Instruct the agent to inspect relevant files and codebase context using tools before writing.
3. Require the agent to deliver a fully populated report formatted in Markdown with headers, filled-in comparison tables, and bullet points.
4. NEVER output empty Markdown templates, empty table rows (e.g. "| Aspect | | |"), or bracketed placeholders (e.g. "[dependency]", "[what it does]"). Instead, write clear instructions ordering the agent to analyze the code and populate those sections with actual findings.
5. Return ONLY the final enhanced prompt text without meta-commentary, introductory remarks, or surrounding quote marks.`;

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
          const userContent = `${indexCtx}${filesCtx}Execute the following task:\n\n${enhanced}`;
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
