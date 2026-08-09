// Completion-guard: prevents the agent from reporting a task as done while its
// tracked task list still has open items. End users should be able to trust a
// "complete" report; a claimed completion with pending/in_progress items is a
// false report and must be reconciled before the turn can end.
//
// This is a hard guard (not a prompt nudge): when the agent tries to conclude a
// turn with a whole-task completion claim while todos remain incomplete, the turn
// loop refuses to return and injects a blocking SYSTEM WARNING instead.

import type { SqliteTodo } from '../session/sqlite.js';
import type { ToolContext } from '../types.js';

// Phrases that assert WHOLE-TASK completion (not a partial/local "X completed").
// Scoped to global wrap-up claims so we don't fire on "the build completed".
const COMPLETION_CLAIM_RE =
  /\b(all (sprints|tasks|done|complete|finished)|all \d+ (sprints|tasks) (completed|done|finished)|fully (complete|done)|everything (is )?complete|all work (is )?complete|done with (all|the) (sprints|tasks)|task[s]? (are )?(complete|done)|work is complete|complete[d]? all (sprints|tasks))\b/i;

export function isCompletionClaim(text: string): boolean {
  if (!text) return false;
  return COMPLETION_CLAIM_RE.test(text);
}

export function countIncompleteTodos(todos: SqliteTodo[]): number {
  return todos.filter((t) => t.status !== 'completed').length;
}

/**
 * True when the agent is concluding a turn claiming whole-task completion but the
 * todo list still has open items. That is a false completion report.
 */
export function detectFalseCompletion(text: string, todos: SqliteTodo[]): boolean {
  if (todos.length === 0) return false;
  if (!isCompletionClaim(text)) return false;
  return countIncompleteTodos(todos) > 0;
}

export function falseCompletionWarning(remaining: number): string {
  return (
    `[SYSTEM WARNING] You reported the task as complete, but ${remaining} todo item(s) are still ` +
    `pending or in progress. Do NOT report completion while todos are open. Either (1) continue the ` +
    `work and finish the remaining items, or (2) if they are genuinely done, update the todo list to ` +
    `mark them completed via the todo tool BEFORE claiming completion. Reconcile the todo list with ` +
    `reality, then report accurately.`
  );
}

// On-disk verification of a completion/fix claim. A whole-task or "I fixed X" claim is a
// false report when it references a file that the agent reverted patches against this
// session but never successfully patched. This catches the exact case where the agent
// says "All issues resolved" / "createApp no longer starts the server" while the change
// was only ever attempted (and reverted by the syntax guard) and never actually written.
//
// `context` is the live ToolContext carrying patchHistory (successful patches) and
// patchFailureStreak (per-file revert counts). Returns the first falsely-claimed file
// path, or null when the claim is consistent with what was actually written.
//
// IMPORTANT: we only inspect the sentence/phrase that ASSERTS completion or a fix. A
// file mentioned in incidental prose (e.g. an audit report recommending "split
// popup.js into modules") must not trip this guard — otherwise a read-only report that
// names files falsely accuses the agent of a revert-only edit it never made.
// NOTE: FILE_MENTION_RE must NOT be used with the global flag via String.match in a
// loop — a shared global-flag regex carries persistent lastIndex state across calls,
// which silently makes subsequent matches return empty. We build a fresh regex per
// call (see matchFileMentions) to keep matching correct.
const FILE_MENTION_RE = /(?:src[\\/])?[\w.-]+\.(?:ts|tsx|js|mjs|cjs|jsx|py|go|rs|java|cs|rb|php)(?::\d+)?/gi;

function matchFileMentions(text: string): string[] {
  // Fresh regex each call: avoids the shared-global lastIndex bug that made
  // "src/server.ts" in a claim segment silently fail to match.
  return [...text.matchAll(new RegExp(FILE_MENTION_RE.source, FILE_MENTION_RE.flags))].map(m => m[0]);
}

// A claim sentence is one that asserts a fix/completion actually HAPPENED
// (past-tense / perfect verbs or a whole-task completion phrase) AND is not a
// self-disclaimer. We deliberately exclude bare imperatives ("refactor popup.js",
// "split script.js") — those are recommendations, not claims of work performed, and
// treating them as claims made a read-only audit report falsely accuse the agent of
// revert-only edits it never made. Negation phrases ("I haven't patched X", "no patch
// was made") disqualify a sentence as a claim.
function claimSegments(text: string): string[] {
  const segments = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
  const isClaim = (s: string): boolean => {
    // Real disclaimers only — bare "no" is excluded so "no longer starts" in a
    // genuine claim ("All issues resolved, createApp no longer starts the server")
    // is not wrongly disqualified.
    if (/\b(I\s+(?:haven't|didn't|have not|did not)|haven't|didn't|hasn't|not\s+\w|never\s+(?:patched|edited|wrote|made)|without\s+(?:making|any)|no\s+(?:patch|change|edit|fix|file|successful|success|changes|edits))\b/i.test(s)) return false;
    return isCompletionClaim(s) || /\b(fixed|refactored|resolved|removed|added|updated|changed|wrote|implemented|completed|done)\b/i.test(s);
  };
  return segments.filter(isClaim);
}

export function detectFalseCompletionOnDisk(text: string, context: ToolContext | undefined): string | null {
  if (!text || !context) return null;
  const history = context.patchHistory ?? [];
  const streak = context.patchFailureStreak ?? new Map<string, number>();
  const baseOf = (p: string): string =>
    p.replace(/:\d+$/, '').replace(/^src[\\/]/, '').toLowerCase().split(/[\\/]/).pop() ?? p.toLowerCase();
  const segments = claimSegments(text);
  for (const seg of segments) {
    const mentioned = matchFileMentions(seg);
    for (const raw of mentioned) {
      const base = baseOf(raw);
      const succeeded = history.some(h => baseOf(h.filePath) === base);
      if (succeeded) continue;
      const reverted = [...streak.keys()].some(k => baseOf(k) === base);
      if (reverted) return raw;
    }
  }
  // Session had reverts but no successful patches at all, and a claim sentence asserts
  // a fix (with no specific file named). Only fires on an actual claim segment — never
  // on incidental prose that merely contains a fix-word.
  if ((context.patchFailureTotal ?? 0) > 0 && history.length === 0 && segments.some(s => /\b(fix|fixed|refactor|refactored|resolved|all issues|done)\b/i.test(s))) {
    return '(no successful patch recorded this session)';
  }
  return null;
}
