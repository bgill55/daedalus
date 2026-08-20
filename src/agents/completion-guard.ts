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

// Scope-overstatement guard for closing summaries. A turn that wraps up with a
// deliverable checklist ("Task 1 - ... Done", "Task 3 - Refine Workflow: ...") while its
// tracked todo list still has open items is over-reporting — it enumerates sub-deliverables
// as if complete but the run's own task tracker disagrees. This catches the case where the
// agent relabels a partially-shipped feature (e.g. "Refine workflow" reduced to "editable
// textarea") as fully delivered in the summary. We only fire on a closing summary (the turn
// is ending) that contains a "Task N:" deliverable enumeration AND a completion-ish verb.
const SUMMARY_TASK_ENUM_RE =
  /(task\s*\d+|step\s*\d+|issue\s*#?\d+|#\d+)\s*[:—-]|✅\s*(task|step|issue)|all \d+ (tasks|sprints|issues)/i;
const SUMMARY_DONE_VERB_RE =
  /\b(complete|completed|done|delivered|finished|shipped|resolved|implemented|all (tasks|sprints|issues) (are )?(complete|done))\b/i;

export function isScopeOverstatedSummary(text: string, todos: SqliteTodo[]): boolean {
  if (!text || !SUMMARY_TASK_ENUM_RE.test(text)) return false;
  // If every todo is closed, the enumeration is accurate — no over-statement.
  if (todos.length === 0 || countIncompleteTodos(todos) === 0) return false;
  // Only flag when the summary asserts completion of the enumerated tasks.
  return SUMMARY_DONE_VERB_RE.test(text);
}

export function scopeOverstatementWarning(remaining: number): string {
  return (
    `[SYSTEM WARNING] Your closing summary enumerates sub-tasks/steps as delivered, but ${remaining} ` +
    `tracked todo item(s) are still open. Do NOT present the deliverable checklist as complete. ` +
    `Either (1) finish the remaining items and update the todo list before summarizing, or (2) clearly ` +
    `label which enumerated items are partially done vs fully done (e.g. "Task 3 - Refine Workflow: ` +
    `PARTIAL — editable textarea shipped; Save-to-Existing dropdown not implemented"). Keep the summary ` +
    `scoped to what actually shipped.`
  );
}

// Unsubstantiated-progress guard: catches the "Current State Analysis: ✅ X / ✅ Y /
// Key Improvements Made: 1... 2... 3..." shape — a summary that enumerates specific
// deliverables as DONE without any todo list to reconcile against. The existing
// list-gated guards (detectFalseCompletion / isScopeOverstatedSummary) never fire when
// the agent didn't use the todo tool, which is exactly how an unverified progress
// report slips through and over-claims work. This guard fires on the enumeration
// itself (≥2 achievement items with done-verbs), independent of todos, and forces the
// agent to reconcile each claimed item with disk reality before the turn can end.
//
// Deliberately scoped to DELIVERABLE ENUMERATIONS (✅ lists, "N. <DoneVerb> ..." numbered
// achievement lists, "• <DoneVerb> ..." bullet achievement lists). A plain sentence like
// "I fixed the bug" or a read-only audit that names files is NOT an enumeration and will
// not trip this guard — we only challenge claims that present a checklist of completed work.
const ACHIEVEMENT_ITEM_RE =
  /(?:^|\n)\s*(?:✅\s*|[•\-*]\s*|(?:\d+)[.)]\s*)[^\n]*?\b(?:fixed|removed|added|updated|changed|cleaned\s*up|refactored|resolved|implemented|completed|done|enhanced|deleted|optimized|improved)\b/i;

export function countAchievementItems(text: string): number {
  const lines = text.split('\n');
  let count = 0;
  for (const line of lines) {
    if (ACHIEVEMENT_ITEM_RE.test(line)) count++;
  }
  return count;
}

export function isUnsubstantiatedProgressReport(text: string): boolean {
  if (!text) return false;
  // Require a substantive enumeration (≥2 items) so a single incidental "✅ done"
  // or one bullet doesn't trip the guard — only a deliverable checklist does.
  return countAchievementItems(text) >= 2;
}

export function unsubstantiatedProgressWarning(count: number): string {
  return (
    `[SYSTEM WARNING] Your message enumerates ${count} specific deliverables as done ` +
    `(✅ / numbered / bulleted achievement list) but there is no task tracker reconciling them ` +
    `and no on-disk verification accompanying each claim. Do NOT present a checklist of completed ` +
    `work you have not verified. Either (1) actually perform and verify each item (run build/lint/test ` +
    `and confirm the change on disk) before claiming it, or (2) rewrite the summary to only state what ` +
    `you genuinely did and verified this session, marking anything partial or unverified honestly. ` +
    `Every "done" claim must correspond to a real, verified change.`
  );
}

// Claim-grounding guard (generalizes the deliverable-checklist guard above). It catches
// BARE FACTUAL CLAIMS about a repo artifact — "path and url are unused imports",
// "rate limiting is already implemented", "DatabaseError is defined", "the build has no
// TS2304 errors" — that are not backed by any tool observation of that artifact this
// session. The merged #136 guard only catches enumerated ✅ checklists; this catches the
// single-sentence factual overclaim that the sandbox review report was full of (it asserted
// errors/types that did not exist and features that were already shipped, with no grep/read
// evidence behind them).
//
// Mechanism: the loop records an observation ledger of every file the agent actually looked
// at this session (read_file path, search_files target, terminal command touching a path).
// A factual claim about a file the agent never observed is ungrounded and must be verified
// before it can be asserted. We intentionally only fire on claims paired with a file mention
// + a claim verb, so free-form narration that merely names a file (e.g. "see db.ts") is safe.

export interface Observation {
  kind: 'read' | 'search' | 'terminal';
  /** Normalized base filename (no dir, no :line) for matching. */
  base: string;
  hit: boolean;
}

export class ClaimLedger {
  private seen = new Map<string, boolean>(); // base -> ever observed (hit or not)
  private features = new Set<string>(); // lowercase feature/dependency terms observed in tool output

  record(o: Observation): void {
    this.seen.set(baseOf(o.base), true);
  }

  /**
   * Record raw tool-output text so a later claim about a project feature/dependency is
   * grounded when that term actually appeared in something the agent read/ran. Without
   * this, the file-paired guard (#138) misses PROJECT-LEVEL claims that name no file
   * (e.g. "helmet causes TS errors", "uses a circuit breaker") — the exact hole that let
   * an agent review a codebase it never opened. Terms are matched case-insensitively.
   */
  recordText(text: string): void {
    if (!text) return;
    const lower = text.toLowerCase();
    for (const term of PROJECT_FEATURE_TERMS) {
      if (lower.includes(term)) this.features.add(term);
    }
  }

  /** True if the file (by base name) was observed at all this session. */
  observed(base: string): boolean {
    return this.seen.has(baseOf(base));
  }

  /** True if a project feature/dependency term was observed in tool output this session. */
  observedFeature(term: string): boolean {
    return this.features.has(term.toLowerCase());
  }

  /** Total file observations this session (read/search/terminal with a path). */
  get totalObservations(): number {
    return this.seen.size;
  }

  reset(): void {
    this.seen.clear();
    this.features.clear();
  }
}

function baseOf(p: string): string {
  return p.replace(/:\d+$/, '').replace(/^src[\\/]/, '').toLowerCase().split(/[\\/]/).pop() ?? p.toLowerCase();
}

// Reuse the file-mention pattern from detectFalseCompletionOnDisk. A fresh regex per call
// avoids the shared-global lastIndex bug noted there.
const CG_FILE_RE = /(?:src[\\/])?[\w.\-]+\.(?:json|tsx|jsx|cjs|mjs|ts|js|py|go|rs|java|cs|rb|php|md|css|html)(?::\d+)?/gi;

// A sentence asserts a fact about an artifact when it pairs a file mention with a
// claim/state verb. Listed as base verbs + the "already X" / "no longer Y" negations that
// the review report abused ("already implemented", "no longer starts", "has no errors").
const CG_CLAIM_VERB_RE =
  /\b(is|are|was|were|has|have|had|contains?|defines?|declares?|exports?|imports?|uses?|implements?|added|removed|fixed|missing|redundant|unused|broken|clean(ed)?|already|no longer|does not|doesn't|not (present|defined|found|implemented|used)|✅)\b/i;

function fileMentions(text: string): string[] {
  return [...text.matchAll(new RegExp(CG_FILE_RE.source, CG_FILE_RE.flags))].map((m) => m[0]);
}

/**
 * Detects a factual claim about a repo artifact the agent never observed this session.
 * Returns the first ungrounded file mention, or null when every claimed file was actually
 * inspected (read/searched/terminal-touched) this session.
 */
export function detectUngroundedClaim(text: string, ledger: ClaimLedger): string | null {
  if (!text || !ledger) return null;
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sentence of sentences) {
    const mentioned = fileMentions(sentence);
    if (mentioned.length === 0) continue;
    if (!CG_CLAIM_VERB_RE.test(sentence)) continue;
    for (const raw of mentioned) {
      const base = baseOf(raw);
      if (!ledger.observed(base)) return raw;
    }
  }
  return null;
}

export function ungroundedClaimWarning(file: string): string {
  return (
    `[SYSTEM WARNING] You asserted a fact about ${file} (or a property of it) but you have not ` +
    `read, searched, or otherwise inspected that file this session — the claim is ungrounded. ` +
    `Do NOT report repo state you have not verified. Either (1) actually inspect ${file} ` +
    `(read_file / search_files / grep) and confirm the claim against its real contents, or ` +
    `(2) rephrase as a hypothesis or omit it. Every factual claim about a file must be backed by ` +
    `a tool observation this session.`
  );
}

// Project-level feature / dependency terms that an agent tends to hallucinate into a
// codebase review when it never opened the repo. Used by the project-claim guard to force
// grounding: a claim that the project HAS one of these features must be backed by a tool
// observation of that term this session. Curated (not exhaustive) — biased toward the
// jargon an LLM reaches for ("circuit breaker", "glassmorphism", "helmet", "favorites").
// Keep terms lowercase; matched case-insensitively via substring.
const PROJECT_FEATURE_TERMS = [
  'helmet',
  'pino',
  'express-rate-limit',
  'cors',
  'circuit breaker',
  'glassmorphism',
  'debounce',
  'favorites',
  'favourites',
  'dark theme',
  'dark mode',
  'jwt',
  'oauth',
  'websocket',
  'graphql',
  'redis',
  'docker',
  'kubernetes',
  'swagger',
];

// Asserts a feature/dependency is PRESENT in the (target) project, not a hypothetical
// ("we could add helmet") or a recommendation. Matches when a feature term is within a
// short window of a possession/existence verb or a "the project/codebase has..." cue.
const FEATURE_ASSERT_RE =
  /\b(uses?|using|with|has|have|added|includes?|configured|set up|implements?|via|installed|the (?:project|codebase|app|server) (?:uses|has|includes|implements)|is (?:configured|set up|present|in place))\b/i;

/**
 * Detects a project-level claim about a feature/dependency the agent never observed this
 * session. Returns the claimed term, or null when every asserted feature was actually seen
 * in tool output (read_file/search_files/terminal) this session. This closes the #138 blind
 * spot: file-paired grounding only catches claims that NAME a file, so an agent reviewing a
 * codebase it never opened can still invent project features (helmet, circuit breaker,
 * favorites, glassmorphism) with no file mentioned. Here, asserting the project HAS such a
 * feature without ever observing the term is ungrounded.
 */
export function isUngroundedProjectClaim(text: string, ledger: ClaimLedger): string | null {
  if (!text || !ledger) return null;
  const lower = text.toLowerCase();
  for (const term of PROJECT_FEATURE_TERMS) {
    if (!lower.includes(term)) continue;
    if (ledger.observedFeature(term)) continue; // actually saw it in tool output — grounded
    // Only fire on an assertion of existence, not a recommendation/hypothetical.
    // Check a window around the term for a possession verb.
    const idx = lower.indexOf(term);
    const window = lower.slice(Math.max(0, idx - 40), idx + term.length + 40);
    if (FEATURE_ASSERT_RE.test(window)) return term;
  }
  return null;
}

export function ungroundedProjectClaimWarning(term: string): string {
  return (
    `[SYSTEM WARNING] You asserted the project has "${term}", but you never observed that ` +
    `term in any file you read, search you ran, or command you executed this session. That is ` +
    `an ungrounded project-level claim — you reviewed a codebase you did not inspect. Do NOT ` +
    `report project features/dependencies you have not verified. Either (1) actually inspect the ` +
    `relevant file or run a search/grep for "${term}" and confirm it exists, or (2) rephrase as a ` +
    `hypothesis ("it may use...") or omit it. Every claim that a project HAS a feature or ` +
    `dependency must be backed by a tool observation this session.`
  );
}

// Inspection-before-review gate: when the user asked for a review/audit of a project
// ("check out this project and give me your thoughts"), a closing report that describes the
// codebase's architecture/features with ZERO file observations this session is a review of a
// repo the agent never opened. This is the highest-leverage guard against the runaway
// "fabricated multi-section review from a single passing `npm run typecheck`" failure: it
// halts the turn at the first review deliverable instead of letting the agent loop on it.
const REVIEW_TASK_RE =
  /\b(check (out|this|the)|review|analy[sz]e|analyse|look at|take a look at|audit|assess|your (?:thoughts|feedback|opinion)|give me (?:your )?(?:thoughts|feedback)|walk me through|examine)\b/i;

export function isReviewTask(task: string): boolean {
  if (!task) return false;
  return REVIEW_TASK_RE.test(task);
}

// A report is a "review deliverable" when it presents the codebase's structure/features in a
// structured, multi-section form (headers like "Architecture & Tech Stack", "Key Features",
// "Top Recommendations") and is substantive. Plain prose ("looks good") is NOT a deliverable.
const REVIEW_DELIVERABLE_RE =
  /\b(architecture|tech stack|high-level (?:project )?review|key features|top recommendations|strengths|weaknesses|project structure|codebase (?:overview|analysis)|what (?:i (?:see|notice)|stands out))\b/i;

export function isReviewDeliverable(text: string): boolean {
  if (!text) return false;
  if (text.length < 400) return false; // a genuine review is substantive
  return REVIEW_DELIVERABLE_RE.test(text);
}

export function reviewWithoutInspectionWarning(): string {
  return (
    `[SYSTEM WARNING] You produced a multi-section project review, but you have not inspected ` +
    `a single file (no read_file / search_files / terminal this session). You are describing a ` +
    `codebase you never opened. Do NOT fabricate architecture/feature claims from a single ` +
    `passing command or from training priors. Either (1) actually read the relevant files ` +
    `(read_file / search_files / grep) before reviewing, or (2) state plainly that you have not ` +
    `inspected the code and can only give generic guidance. A review with zero file observations ` +
    `is not a review — it is invention.`
  );
}

// Green-state claim guard: catches the "subset-omission" overclaim where the agent asserts
// the tests/build pass or the project is in a clean state, while the most recent REAL
// verify run this session was RED. The count-fabrication guard (#131) only fires when the
// stated number disagrees with the run; this fires when the agent cherry-picks a green
// subset ("9 validation tests passing") and silently omits a failing overall suite. The
// run in the transcript reported "9 validation tests passing" while `npm test` had actually
// failed 2 db/api tests — a true count, so the count guard missed it; this guard catches it.
const GREEN_STATE_RE =
  /\b(tests?\b[^\w]*?(?:pass|passing|green)|build\b[^\w]*?(?:pass|passing|clean|green)|all tests?\b[^\w]*?(?:pass|green|passing)|clean state|no (?:errors?|warnings?|failures?)|everything (?:is )?(?:green|passing)|the (?:suite|project)\b[^\w]*?(?:is )?(?:green|clean|passing))\b/i;

export function isGreenStateClaim(text: string): boolean {
  if (!text) return false;
  return GREEN_STATE_RE.test(text);
}

export function greenStateWarning(): string {
  return (
    `[SYSTEM WARNING] You reported the tests/build as passing or the project as clean, but the ` +
    `most recent actual verify run this session FAILED (the suite was not green). Do NOT report ` +
    `a green/clean state by citing a passing subset while the overall run was red. Either (1) ` +
    `re-run \`npm run build && npm run test\` and confirm a REAL all-green result before claiming ` +
    `it, or (2) report the actual state honestly (which tests/files failed). A passing subset is ` +
    `not a passing suite.`
  );
}

