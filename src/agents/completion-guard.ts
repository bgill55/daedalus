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
const FILE_MENTION_RE = /(?:src[\\/])?[\w.-]+\.(?:ts|tsx|js|mjs|cjs|jsx|py|go|rs|java|cs|rb|php)(?::\d+)?/gi;

export function detectFalseCompletionOnDisk(text: string, context: ToolContext | undefined): string | null {
  if (!text || !context) return null;
  if (!isCompletionClaim(text) && !/\b(fix|fixed|refactor|refactored|resolved|removed|added|updated|changed)\b/i.test(text)) {
    return null;
  }
  const history = context.patchHistory ?? [];
  const streak = context.patchFailureStreak ?? new Map<string, number>();
  const mentioned = text.match(FILE_MENTION_RE) ?? [];
  for (const raw of mentioned) {
    const base = raw.replace(/:\d+$/, '').replace(/^src[\\/]/, '').toLowerCase();
    // Did we successfully patch this file at least once?
    const succeeded = history.some(h => h.filePath.toLowerCase().replace(/^.*[\\/]/, '').replace(/^src[\\/]/, '') === base.split(/[\\/]/).pop());
    if (succeeded) continue;
    // Did we revert patches against it?
    const reverted = [...streak.keys()].some(k => k.toLowerCase().replace(/^.*[\\/]/, '').replace(/^src[\\/]/, '') === base.split(/[\\/]/).pop());
    if (reverted) return raw;
  }
  // Session had reverts but no successful patches at all, and the message asserts a fix.
  if ((context.patchFailureTotal ?? 0) > 0 && history.length === 0 && /\b(fix|fixed|refactor|refactored|resolved|all issues|done)\b/i.test(text)) {
    return '(no successful patch recorded this session)';
  }
  return null;
}
