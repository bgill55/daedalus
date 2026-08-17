import pc from 'picocolors';
import { printUserTurn, turnSeparator } from '../formatting.js';
import { extractAndSave } from '../extraction.js';
import { getSessionTodos } from '../tools/builtin/todo.js';
import { stripToolCallMarkup } from '../formatting.js';
import type { Command, CommandContext } from './types.js';

export const ENHANCE_SYSTEM_PROMPT = `You are an expert prompt engineer for AI coding agents. 
Expand the user's raw or casual request into a crisp, high-yield engineering prompt for Daedalus.
Rules for the generated prompt:
1. Frame the prompt as a direct action command instructing the agent to perform the task and write out its completed report.
2. Instruct the agent to inspect relevant files and codebase context using tools before writing.
3. Require the agent to deliver a fully populated report formatted in Markdown with headers, filled-in comparison tables, and bullet points.
4. NEVER output empty Markdown templates, empty table rows (e.g. "| Aspect | | |"), or bracketed placeholders (e.g. "[dependency]", "[what it does]"). Instead, write clear instructions ordering the agent to analyze the code and populate those sections with actual findings.
5. Return ONLY the final enhanced prompt text without meta-commentary, introductory remarks, or surrounding quote marks.
6. If the user's request already contains tool-call markup (e.g. \`<tool_call>\`, \`<function=...>\`), code fences, or XML-like tags, DO NOT copy that structured markup into the output. Rephrase the request as a clean natural-language instruction that a coding agent can act on directly. The enhanced prompt must be plain prose/Markdown an agent can execute — never raw tool-call XML.
7. PRESERVE THE USER'S INTENT MODE. If the user's request is a proposal, ideation, brainstorm, design, or discussion ask (e.g. "come up with ideas", "propose", "what are some options", "brainstorm", "think about how to", "suggest approaches", "architecture review"), the enhanced prompt MUST remain a proposal/analysis ask. Do NOT reframe it as an implement/build command, and do NOT inject execution-scope deliverables such as "implement the following", "deliver a comprehensive Markdown report with sprint breakdowns and file modifications", "manageable sprints", or "populate all sections with actual implementation plans". If the user wants implementation, they will say so — your job is to make the proposal sharper and more specific, not to expand a question into a build order. Conversely, if the request IS a direct implementation task, keep Rule 1-3 as written.
8. DO NOT NAME SPECIFIC TOOL FUNCTIONS. The execution agent selects its own tools from whatever is available in its environment — you cannot know the exact tool names, and naming non-existent ones (e.g. "using find_symbol and get_definition to locate files") makes the agent attempt calls that fail. Instead, describe the ACTION in plain language ("inspect the relevant source files", "search the codebase for usages of X"). Never write "using <tool_name> to ..." or "via <tool_name>" clauses.
9. BOUNDED, DISTINCT OUTPUT — DEPTH OVER BREADTH. When the request asks for "improvements", "ideas", "options", or "areas for <X>", instruct the agent to produce AT MOST 8-10 highest-impact, DISTINCT items. Never generate templated or boilerplate variations of the same idea (e.g. fifty "Add Prompt Template Variables ..." bullets that only swap words). Each item must be a concrete, independently valuable change with its own rationale. "Fully populated" (Rule 3-4) means every table ROW holds real findings — it does NOT mean padding an open-ended list with repetitive permutations. If the codebase yields fewer than 8 genuine items, stop; do not invent filler.
10. DO NOT ASSERT UNVERIFIED FINDINGS. You have NOT inspected the codebase — you only received the user's raw request. NEVER state specific findings as fact (file names, error codes like "TS2304", counts like "12 TODO comments", dependency names like "helmet", specific function names, or "missing X in server.ts"). Doing so fabricates problems the agent will then try to "fix", corrupting the project. Instead, define the report's SECTIONS and instruct the EXECUTION agent to populate each section from real file inspection. A "Current Pain Points" or "Findings" list must be discovered by the agent, never pre-filled by you. If the user only asked for an explanation, the enhanced prompt should ask the agent to report what it actually finds — not what you assume.`;


// Intent-mode markers. If the RAW request contains a proposal/brainstorm marker, the
// enhanced prompt must stay a proposal and must not be expanded into an implementation
// mandate. Used by stripModeViolation to defend against an enhancer that ignores Rule 7.
const PROPOSAL_INTENT_RE =
  /\b(ideas?|propose|proposal|brainstorm|suggest (approaches|ideas|options)|think (outside|about|of)|what (are|would|could)|options|approaches|design (a )?(review|doc)|architecture review|outside the box|how (might|could|should) we)\b/i;
// Phrases that signal the enhancer illegally escalated a proposal into a build mandate.
// Global flag: a single enhanced prompt can contain several mandate phrases that must all
// be stripped (e.g. "implement the following" AND "manageable sprints" AND "specific file modifications").
const IMPLEMENT_MANDATE_RE =
  /\b(implement (the )?(following|these|in )|manageable sprints?|sprint breakdown|deliver a comprehensive (markdown )?report|file modifications required|specific file modifications|detailed comparison tables showing current (state|vs)|populate all sections with actual (implementation|analysis)|implementation readiness statement|proceed with implementing)\b/gi;
// Invented-tool references: the enhancer must not name specific tool functions it cannot
// know exist (Rule 8). It emits clauses like "using find_symbol and get_definition to
// locate relevant files" — which make the execution agent attempt non-existent tools.
// Strip the "using X (and Y) to <action>" / "via X" instruction clauses. Build-agnostic:
// we don't maintain a tool allowlist (it varies by build/MCP); we just remove the
// imperative tool-name phrasing and let the agent pick its own tools.
const INVENTED_TOOL_RE =
  /\b(?:using\s+[\w_]+(?:\s+and\s+[\w_]+)*|via\s+[\w_]+)\b/gi;

/**
 * Backstop for Rule 8: removes "using <tool> to <action>" / "via <tool>" clauses the
 * enhancer may still emit, so the execution turn is instructed by ACTION ("inspect the
 * relevant source files") rather than by a possibly-fictional tool name it will fail to call.
 */
function stripInventedToolRefs(enhanced: string): string {
  if (!INVENTED_TOOL_RE.test(enhanced)) return enhanced;
  return enhanced
    .replace(INVENTED_TOOL_RE, '') // drop the invented-tool instruction clauses
    .replace(/\s{2,}/g, ' ') // collapse double spaces left behind
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Matches a Markdown bullet line (supports "-", "*", "•", numbered "1.").
const BULLET_RE = /^\s*(?:[-*•]|\d+\.)\s+/;

/**
 * Backstop for Rule 9: if the enhanced prompt's bullet list degenerates into templated
 * boilerplate (the same prefix repeating many times — e.g. fifty "Add Prompt Template
 * Variables ..." bullets that only swap words), keep the first MAX_DISTINCT_BULLETS items
 * and append a cap note. This stops the execution turn from producing a 4.5k-token
 * copy-paste ramble when the user asked for "areas of improvement". We cap by total bullet
 * count (not by de-duping semantics) — a list with >MAX items is almost always padding, and
 * the note instructs the agent to keep only the highest-impact, distinct items.
 */
const MAX_DISTINCT_BULLETS = 12;
function capRepetition(enhanced: string): string {
  const lines = enhanced.split('\n');
  const bulletIdx: number[] = [];
  lines.forEach((ln, i) => { if (BULLET_RE.test(ln)) bulletIdx.push(i); });
  if (bulletIdx.length <= MAX_DISTINCT_BULLETS) return enhanced;
  const keepThrough = bulletIdx[MAX_DISTINCT_BULLETS - 1]; // last bullet we keep
  const truncated = lines.slice(0, keepThrough + 1);
  truncated.push('', `> Note: list capped at the ${MAX_DISTINCT_BULLETS} highest-impact, distinct items — do not pad with templated variations of the same idea.`);
  return truncated.join('\n').trim();
}

/**
 * Backstop for Rule 7: if the raw request is a proposal/ideation ask but the enhancer
 * still expanded it into an implement/build mandate (added sprint breakdowns, "implement
 * the following", "file modifications", etc.), strip those execution-scope phrases so the
 * enhanced prompt stays a proposal the user can vet before any build happens. This prevents
 * the /prompt enhancer from silently turning "propose 3-5 ideas" into "implement these in
 * sprints and deliver a full report" — which the execution turn then obeys as a build order.
 */
function stripModeViolation(rawPrompt: string, enhanced: string): string {
  if (!PROPOSAL_INTENT_RE.test(rawPrompt)) return enhanced;
  if (!IMPLEMENT_MANDATE_RE.test(enhanced)) return enhanced;
  return enhanced
    .replace(IMPLEMENT_MANDATE_RE, (m) => '') // remove the illegal mandate phrases
    .replace(/\n{3,}/g, '\n\n') // collapse the gaps left behind
    .trim();
}

export async function enhancePrompt(rawPrompt: string, ctx: CommandContext): Promise<string> {
  const fullPrompt = `${ENHANCE_SYSTEM_PROMPT}\n\nUser request to enhance: "${rawPrompt}"`;

  try {
    if (typeof ctx.callModelWithFallback === 'function') {
      // callModelWithFallback appends the request + its reply to the shared messages
      // history. The enhanced prompt is an intermediate artifact, NOT a conversation
      // turn — if it leaks into history, the follow-up "execute this" call sees an
      // assistant message that already "answered" with an enhanced prompt and
      // re-enhances it instead of acting on it. Snapshot and restore history so the
      // enhancement never pollutes the real conversation.
      const restore = Array.isArray(ctx.messages) ? ctx.messages.length : 0;
      const res = await ctx.callModelWithFallback(fullPrompt);
      if (Array.isArray(ctx.messages)) ctx.messages.length = restore;
      if (res && res.trim()) {
        // Defensive: the enhance model can echo raw <tool_call> XML from a pasted
        // structured input instead of producing natural-language. Strip any such
        // markup so the displayed/enhanced prompt is always plain prose an agent
        // can execute (see bug where /enhance returned <tool_call><function=read_file>).
        const stripped = stripToolCallMarkup(res.trim());
        return capRepetition(stripInventedToolRefs(stripModeViolation(rawPrompt, stripped)));
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
          // Rebuild the system prompt for the execution turn using the USER'S
          // ORIGINAL request — NOT the enhanced prompt. The enhanced prompt is a
          // generated intermediate artifact (often an audit/expansion) that can
          // spuriously match skill triggers (e.g. "Pre-Flight Audit" hits the
          // grade-and-fix-daedalus skill via "pre-flight"), injecting unrelated
          // skill bodies that hijack the execution turn. Skill matching must stay
          // keyed to the user's actual intent, just like the REPL loop does.
          if (ctx.messages.length > 0 && ctx.messages[0].role === 'system' && typeof ctx.getSystemPromptWithMemory === 'function') {
            ctx.messages[0] = { role: 'system', content: ctx.getSystemPromptWithMemory(rawQuery) };
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
