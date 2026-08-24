import { writeSkillDraft, listSkillDrafts } from './draft.js';
import path from 'path';

export interface SynthesisResult {
  synthesized: boolean;
  name?: string;
  filePath?: string;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Auto-synthesize a skill DRAFT from a successful turn. Writes to the shared
 * draft store (~/.daedalus/skills/.drafts/<slug>.json) so it surfaces in /skills
 * for human review/approval. Never becomes active until a human approves it.
 *
 * The draft store deliberately ignores project-local paths and the shipped
 * skills dir, so this can only ever propose — never auto-activate — a skill.
 */
// Turns that are mere acknowledgements / transitions carry no reusable recipe and
// only pollute the .drafts store ("yes", "ok lets move on to #4", "awesome"). We skip
// them rather than synthesizing a skill from trivial conversation.
const TRIVIAL_PROMPT_RE =
  /^(\s*(yes|yeah|yep|yup|ok|okay|sure|cool|nice|sweet|awesome|great|thanks|thank you|fine|go ahead|proceed|continue|lets? (go|move (on|forward)|do (that|it))|let's (go|move (on|forward)|do (that|it))|move on to (#\w+|\w+)|next)\b)/i;

export function isTrivialPrompt(prompt: string): boolean {
  return TRIVIAL_PROMPT_RE.test(prompt.trim());
}

// A turn summary that shows no actual work performed (no edit/run confirmation, no
// file change) is not a reusable playbook. We require at least one "did work" signal
// before proposing a skill, so read-only summaries and "nothing to do" turns don't synth.
const NO_WORK_SUMMARY_RE =
  /\b(no (changes|patches|edits|fix(es)?) (were )?made|already (fixed|resolved|done|present)|nothing (to do|left|changed)|no further (changes|action)|change[s]? (already )?(present|in place|existing))\b/i;

// Positive proof of work: a reusable skill can only be synthesized from a turn that
// actually DID something — ran a command, edited/created a file, installed a dep,
// fixed/implemented/verified something. Conversational or meta turns (the agent
// bantering, or the user discussing the tool itself) produce summaries with no work
// signal, so they must not spawn a skill draft. This is the mechanism-level gate:
// "ground, don't guess" — no observed work, no synthesized playbook.
const DID_WORK_SUMMARY_RE =
  /\b(installed|ran|run|executed|edited|updated|created|added|removed|deleted|fixed|resolved|refactored|implemented|patched|configured|set up|migrated|verified|tests? (?:pass|passed|green)|built|changed|wrote|generated|debugged)\b/i;

export function synthesizeSkillFromTurn(
  userPrompt: string,
  turnSummary: string
): SynthesisResult {
  if (!userPrompt || userPrompt.length < 10) return { synthesized: false };
  if (!turnSummary || turnSummary.length < 30) return { synthesized: false };

  if (isTrivialPrompt(userPrompt)) return { synthesized: false };
  if (NO_WORK_SUMMARY_RE.test(turnSummary)) return { synthesized: false };
  // Require proof of actual work before proposing a skill. Without this, a casual
  // chat / meta turn (e.g. the user joking about the guardrails) whose summary
  // happens to exceed the length floor would synthesize a spurious draft.
  if (!DID_WORK_SUMMARY_RE.test(turnSummary)) return { synthesized: false };

  // A skill playbook must contain a REUSABLE RECIPE, not just a status report. A turn
  // that says "all 60 tests pass / verified on disk / changes made" has a work verb but
  // no procedure — it is a verification summary, not a how-to. Synthesizing a draft from
  // it (e.g. from a "good job" praise turn) pollutes the .drafts store with junk. Require
  // at least one procedural signal: a shell command, a code/file block, an ordered step
  // list, or an explicit patched-file reference, before proposing a skill.
  const PROCEDURAL_SUMMARY_RE =
    /(^|\n)\s*(?:[*-]|\d+[.)])\s|npm |npx |git |pnpm |yarn |bun |cd \/|patch |read_file|write_file|(src\/|tests?\/\.ts|\.js|\.json)|diff --git|@@ -\d/i;
  if (!PROCEDURAL_SUMMARY_RE.test(turnSummary)) return { synthesized: false };

  const slug = slugify(userPrompt);
  if (!slug || slug.length < 3) return { synthesized: false };

  // Skip if a draft for this slug already exists (avoids re-synthesizing every turn).
  const existing = listSkillDrafts().some(d => slugify(d.name) === slug || slugify(d.trigger) === slug);
  if (existing) return { synthesized: false };

  const name = userPrompt.slice(0, 50).replace(/"/g, '').trim();
  const description = `Auto-synthesized playbook from successful execution: ${userPrompt.slice(0, 80).replace(/"/g, '')}`;
  try {
    const filePath = writeSkillDraft({
      name,
      description,
      trigger: slug,
      // Synthesized playbooks are guidance only — never auto-executable.
      safety: 'instructions',
      body: `## Synthesized Context & Playbook\nThis skill playbook was auto-synthesized after a successful resolution.\n\n### Original Intent\n> ${userPrompt}\n\n### Execution Recipe\n${turnSummary}`,
    });
    return { synthesized: true, name: path.basename(filePath, '.json'), filePath };
  } catch {
    return { synthesized: false };
  }
}
