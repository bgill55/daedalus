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

// Honesty disclaimers: an update that explicitly says the work is NOT done, is
// partial, or lists what remains must NOT be treated as a completion / progress /
// scope-overstatement claim. Without this carve-out the whole-text completion regex
// (and the achievement-enumeration / task-enumeration guards) match incidental
// wrap-up phrasing and force-loop a token-wasting [SYSTEM WARNING] even on an honest
// status update. Mirrors the negation exclusion used by detectFalseCompletionOnDisk
// (claimSegments). Centralised here so every closing-turn guard shares the same
// notion of "this message is an honest 'not done yet, here's where we are' update."
export const HONESTY_DISCLAIMER_RE =
  /\b(i (?:can'?t|cannot|can not)|not (?:all )?(?:done|complete|finished|yet)|not (?:yet )?(?:done|complete)|still (?:in progress|pending|open|remaining|to do|needs? (?:work|doing)|working|have to)|hasn'?t (?:been )?(?:done|completed|finished)|have ?n'?t (?:been )?(?:done|completed|finished)|remain(?:s|ing)? (?:to be done|incomplete|open|items?|tasks?|steps?)|only (?:partially )?(?:done|complete)|what (?:was )?(?:actually )?(?:done|completed)|what (?:is )?left|not (?:actually )?completed|did not (?:complete|finish)|incomplete|not (?:yet )?verified|not (?:properly )?implemented|was (?:not|never) (?:actually )?(?:completed|done|implemented)|moving (?:on )?to|proceeding to|(?:currently )?working on|work in progress|partial (?:progress|update)|status update|progress update)\b/i;

export function isHonestDisclaimer(text: string): boolean {
  if (!text) return false;
  return HONESTY_DISCLAIMER_RE.test(text);
}


export function isCompletionClaim(text: string): boolean {
  if (!text) return false;
  if (isHonestDisclaimer(text)) return false;
  return COMPLETION_CLAIM_RE.test(text);
}


export function countIncompleteTodos(todos: SqliteTodo[]): number {
  return todos.filter((t) => t.status !== 'completed').length;
}

export const SUMMARY_TASK_ENUM_RE =
  /(task\s*\d+|step\s*\d+|issue\s*#?\d+|#\d+)\s*[:—-]|✅\s*(task|step|issue)|all \d+ (tasks|sprints|issues)/i;
export const SUMMARY_DONE_VERB_RE =
  /\b(complete|completed|done|delivered|finished|shipped|resolved|implemented|all (tasks|sprints|issues) (are )?(complete|done))\b/i;

export const ACHIEVEMENT_ITEM_RE =
  /(?:^|\n)\s*(?:✅\s*|[•\-*]\s*|(?:\d+)[.)]\s*)[^\n]*?\b(?:fixed|removed|added|updated|changed|cleaned\s*up|refactored|resolved|implemented|completed|done|enhanced|deleted|optimized|improved)\b/i;

export function countAchievementItems(text: string): number {
  const lines = text.split('\n');
  let count = 0;
  for (const line of lines) {
    if (ACHIEVEMENT_ITEM_RE.test(line)) count++;
  }
  return count;
}

/**
 * True when the agent is concluding a turn claiming whole-task completion or
 * enumerating deliverables as done while the todo list still has open items.
 */
export function detectFalseCompletion(text: string, todos: SqliteTodo[]): boolean {
  if (todos.length === 0) return false;
  if (countIncompleteTodos(todos) === 0) return false;
  if (isHonestDisclaimer(text)) return false;
  return isCompletionClaim(text) || countAchievementItems(text) >= 2 || SUMMARY_TASK_ENUM_RE.test(text);
}

export function falseCompletionWarning(remaining: number): string {
  return (
    `[SYSTEM WARNING] You reported deliverables/fixes as completed, but ${remaining} todo item(s) are still ` +
    `pending or in progress. Do NOT report completion while todos are open. Either (1) continue the ` +
    `work and finish the remaining items (updating the todo list to mark them completed via the todo tool), or ` +
    `(2) explicitly mention in your summary what remains incomplete or unverified. Reconcile with the todo list, ` +
    `then report accurately.`
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
const FILE_MENTION_RE = /(?:src[\\\\/])?[\w.-]+\.(?:tsx|jsx|cjs|mjs|ts|js|py|go|rs|java|rb|php|cs)(?::\d+)?/gi;

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
export function isScopeOverstatedSummary(text: string, todos: SqliteTodo[]): boolean {
  if (!text || !SUMMARY_TASK_ENUM_RE.test(text)) return false;
  // An honest "not all done / here's what remains" update must not be flagged as a
  // scope over-statement. Lets the agent close a turn after stating remaining todos
  // instead of force-looping the [SYSTEM WARNING].
  if (isHonestDisclaimer(text)) return false;
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
export function isUnsubstantiatedProgressReport(text: string): boolean {
  if (!text) return false;
  // An honest "not done yet / here's what's left" update must NOT be challenged as
  // an unverified progress report. Without this, a reconciled status update that
  // enumerates verified ✅ items alongside explicit ❌/NOT-completed items loops the
  // guard and wastes tokens re-stating reality.
  if (isHonestDisclaimer(text)) return false;
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

// Config / dependency / artifact terms that an agent commonly asserts are
// MISSING or ABSENT ("no ESLint config", "missing JSDoc", "no .env.example").
// A negative-existence claim about one of these is only grounded if the agent
// actually looked (ran a search/list this session). Biased toward terms an LLM
// reaches for when it hasn't inspected the repo; not exhaustive.
const NEG_EXISTENCE_TERMS = [
  'eslint',
  'prettier',
  'jest',
  'vitest',
  'mocha',
  'tsc',
  'typescript',
  'jsdoc',
  '.env.example',
  'env.example',
  'dockerfile',
  'ci',
  'github actions',
  'test',
  'tests',
  'tests dir',
  'test directory',
  'readme',
  'changelog',
  'license',
  'config',
  'configuration',
  'helmet',
  'cors',
  'jwt',
  'oauth',
  'redis',
  'docker',
  'kubernetes',
];

// Asserts an artifact is ABSENT / MISSING / NOT FOUND / NOT CONFIGURED.
const NEG_EXIST_VERB_RE =
  /\b(no|not (?:found|configured|present|in place|set up)|missing|absent|lacking|without|no longer (?:has|have|present)|unable to find|couldn'?t find|no \w+ (?:config|configuration|file|script|directory|dir|setup|found))\b/i;

// Source files that count toward real code inspection (not docs, walkthroughs, or changelogs).
// Used by the review gate to distinguish "agent read actual code" from "agent only read README".
const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|cs|rb|php|html|css|json)$/i;

export class ClaimLedger {
  private seen = new Map<string, boolean>(); // base -> ever observed (hit or not)
  private features = new Set<string>(); // lowercase feature/dependency terms observed in tool output
  private srcSeen = new Set<string>(); // base names that are actual source files (not docs/markdown)
  private searched = false; // agent ran at least one search/list/grep this session
  private negTermsSeen = new Set<string>(); // negative-existence terms actually observed in tool output
  private exercisedRuntime = false; // agent ran a live integration probe (curl/HTTP/run) this session

  record(o: Observation): void {
    this.seen.set(baseOf(o.base), true);
    // Track source file observations separately. Walkthrough/docs reads are grounding
    // for file-pair claims but NOT for the review-gate (which requires source inspection).
    if (SOURCE_FILE_RE.test(o.base)) {
      this.srcSeen.add(baseOf(o.base));
    }
    // A search/list/grep observation means the agent actually looked for something —
    // required to ground a negative-existence claim ("no X found"). Terminal commands
    // like `ls`/`dir`/`find` also reveal file presence, so they count.
    if (o.kind === 'search' || o.kind === 'terminal') this.searched = true;
  }

  /** Record raw tool-output text so a later claim about a project feature/dependency is
   * grounded when that term actually appeared in something the agent read/ran. */
  recordText(text: string): void {
    if (!text) return;
    const lower = text.toLowerCase();
    for (const term of PROJECT_FEATURE_TERMS) {
      if (lower.includes(term)) this.features.add(term);
    }
    for (const term of NEG_EXISTENCE_TERMS) {
      if (lower.includes(term)) this.negTermsSeen.add(term);
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

  /** True if the agent ran a search/list/grep this session (needed to ground "X is absent"). */
  get didSearch(): boolean {
    return this.searched;
  }

  /** True if a negative-existence term was actually observed in tool output this session. */
  observedNegTerm(term: string): boolean {
    return this.negTermsSeen.has(term.toLowerCase());
  }

  /** Set when the agent actually EXERCISED the integration at runtime — ran a live
   * request/curl/HTTP probe against the thing it claims works, not just a static
   * build/typecheck/unit-test. Required to ground a "feature is wired in / works /
   * verified end-to-end" claim. A green `tsc`/`vitest` is NOT runtime exercise. */
  markRuntimeExercised(): void {
    this.exercisedRuntime = true;
  }

  /** True if the agent ran a live integration probe this session. */
  get didExerciseRuntime(): boolean {
    return this.exercisedRuntime;
  }

  /** Total file observations this session (read/search/terminal with a path). */
  get totalObservations(): number {
    return this.seen.size;
  }

  /**
   * Source-file observations only — excludes markdown, walkthrough, and doc files.
   * Used by the review gate so that reading only a walkthrough.md does not satisfy
   * the inspection requirement for a multi-section code review deliverable.
   */
  get sourceFileObservations(): number {
    return this.srcSeen.size;
  }

  reset(): void {
    this.seen.clear();
    this.features.clear();
    this.srcSeen.clear();
  }
}

function baseOf(p: string): string {
  return p.replace(/:\d+$/, '').replace(/^src[\\/]/, '').toLowerCase().split(/[\\/]/).pop() ?? p.toLowerCase();
}

// Reuse the file-mention pattern from detectFalseCompletionOnDisk. A fresh regex per call
// avoids the shared-global lastIndex bug noted there.
const CG_FILE_RE = /(?:src[\\\\/])?[\w.\-]+\.(?:tsx|jsx|cjs|mjs|json|ts|js|py|go|rs|java|rb|php|md|css|html|cs)(?::\d+)?/gi;

// A sentence asserts a fact about an artifact when it pairs a file mention with a
// claim/state verb. Listed as base verbs + the "already X" / "no longer Y" negations that
// the review report abused ("already implemented", "no longer starts", "has no errors").
const CG_CLAIM_VERB_RE =
  /\b(is|are|was|were|has|have|had|contains?|defines?|declares?|exports?|imports?|uses?|implements?|added|removed|fixed|missing|redundant|unused|broken|clean(ed)?|already|no longer|does not|doesn't|not (present|defined|found|implemented|used)|✅)\b/i;

function fileMentions(text: string): string[] {
  return [...text.matchAll(new RegExp(CG_FILE_RE.source, CG_FILE_RE.flags))].map((m) => m[0]);
}

// Tokens that match CG_FILE_RE (e.g. "node.js", "tsx.ts") but are NEVER repo artifacts —
// they are runtime/platform/CLI names the agent verifies via `node -e` / `tsx` commands,
// not by reading a file. Treating them as uninspected files makes the ungrounded-claim
// guard fire on legitimately-verified platform facts (the "Claim about Node.js is ungrounded"
// false positive). Skip them so the guard only flags real repo files.
const NON_FILE_TOKENS = new Set([
  'node.js', 'node', 'deno', 'bun', 'tsx', 'npm', 'npx', 'yarn', 'pnpm', 'git',
  'docker', 'kubectl', 'vim', 'bash', 'sh', 'powershell', 'cmd',
]);

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
      // Skip runtime/platform/CLI tokens (node.js, tsx, npm, ...) — verified via commands,
      // not by reading a repo file. Flagging them as "uninspected" is a false positive.
      if (NON_FILE_TOKENS.has(base)) continue;
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

/**
 * Detects a claim that a config/dependency/artifact is ABSENT or MISSING
 * ("no ESLint configuration found", "missing JSDoc", "no .env.example") when the
 * agent never actually looked for it this session (no search/list/terminal run).
 * Mirrors isUngroundedProjectClaim but for NEGATIVE existence: asserting something
 * is gone requires the same grounding as asserting it is present. Without this, an
 * agent that never ran `ls`/`search_files` can invent absent files with no check.
 *
 * Returns the claimed-absent term, or null when the claim is either absent or
 * grounded (the agent searched this session, or actually observed the term present).
 */
export function isNegativeExistenceClaim(text: string, ledger: ClaimLedger): string | null {
  if (!text || !ledger) return null;
  const lower = text.toLowerCase();
  for (const term of NEG_EXISTENCE_TERMS) {
    if (!lower.includes(term)) continue;
    // If the agent actually OBSERVED this term in tool output, the absence claim may
    // be grounded (it saw context implying absence, e.g. a file listing without it).
    if (ledger.observedNegTerm(term)) continue;
    const idx = lower.indexOf(term);
    const window = lower.slice(Math.max(0, idx - 50), idx + term.length + 50);
    if (NEG_EXIST_VERB_RE.test(window)) {
      // Grounded only if the agent actually searched/listed this session.
      if (ledger.didSearch) continue;
      return term;
    }
  }
  return null;
}

export function negativeExistenceWarning(term: string): string {
  return (
    `[SYSTEM WARNING] You asserted "${term}" is missing/absent, but you never ran a ` +
    `search, list, or grep for it this session — you have no basis to claim absence. ` +
    `Do NOT report that a file, config, or dependency is missing unless you actually ` +
    `checked (run \`search_files\` / \`list_files\` / \`ls\` / \`grep\` and confirm it is ` +
    `not present). Either (1) actually look for "${term}" and report what you find, or ` +
    `(2) rephrase as a hypothesis ("I did not see X") or omit it. A claim of absence ` +
    `without a check is invention.`
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

// Fix 1: Upgraded review-gate — require actual SOURCE file reads, not just any file.
// Reading walkthrough.md / README.md / CHANGELOG does NOT count as inspecting the codebase.
// A minimum of MIN_SOURCE_READS source files must have been read before a multi-section
// review deliverable is acceptable.
const MIN_SOURCE_READS = 2;

/**
 * True when the agent produced a multi-section review deliverable but read fewer than
 * MIN_SOURCE_READS actual source files (e.g. only read walkthrough.md / README.md).
 * Stricter than the zero-observation gate: reading docs alone is insufficient for a code review.
 */
export function isReviewWithoutSourceInspection(text: string, ledger: ClaimLedger): boolean {
  if (!text || !ledger) return false;
  if (!isReviewDeliverable(text)) return false;
  return ledger.sourceFileObservations < MIN_SOURCE_READS;
}

export function reviewWithoutSourceInspectionWarning(srcCount: number): string {
  return (
    `[SYSTEM WARNING] You produced a multi-section project review, but you only inspected ` +
    `${srcCount} source file(s) this session (minimum required: ${MIN_SOURCE_READS}). Reading ` +
    `only walkthrough.md, README.md, or similar docs is NOT code inspection — those files ` +
    `describe intent, not reality. Do NOT fabricate architecture/feature claims from docs alone. ` +
    `Either (1) actually read the relevant source files (read_file / search_files on .ts/.js/.py/etc.) ` +
    `before reviewing, or (2) state plainly that you have only read documentation and can only ` +
    `give provisional guidance. A review grounded only in docs — not source — is speculation.`
  );
}

// Fix 3: Test-count claim without any npm test run this session.
// The existing fabricatedTestCountCorrection guard only fires when lastActualPassCount is set
// (i.e. a real npm test was observed). This companion guard fires unconditionally when the
// agent claims a SPECIFIC test count (e.g. "9 tests passing") but no test run was recorded.
const SPECIFIC_TEST_COUNT_RE =
  /\b(\d+)\s*(?:\/\s*\d+\s*)?(?:tests?|specs?|suites?)\s+(?:pass(?:ing|ed)?|green)\b|\ball\s+(\d+)\s+tests?\s+pass(?:ing)?\b|(\d+)\s+(?:passing|passed)\b/i;

/**
 * Returns a correction string when the text claims a specific passing test count but
 * no `npm test` / vitest / jest run was actually observed this session (lastActualPassCount
 * is undefined). Returns null when no specific count is asserted or when a real run exists.
 */
export function claimedTestCountWithoutRun(text: string, lastActualPassCount: number | undefined): string | null {
  if (lastActualPassCount !== undefined) return null; // real run exists, let the existing guard handle it
  const m = text.match(SPECIFIC_TEST_COUNT_RE);
  if (!m) return null;
  const claimed = m[1] ?? m[2] ?? m[3];
  if (!claimed) return null;
  return claimed;
}

export function claimedTestCountWithoutRunWarning(claimed: string): string {
  return (
    `[SYSTEM WARNING] You reported "${claimed} tests passing" (or a similar specific test count), ` +
    `but no \`npm test\` / vitest / jest run was observed in your tool calls this session. ` +
    `Do NOT invent test counts from memory, walkthroughs, or prior sessions. Either (1) actually ` +
    `run \`npm test\` and report the real output, or (2) omit the specific count and say you have ` +
    `not run the test suite this session. Fabricating a passing count misleads the user.`
  );
}

// Runtime-exercise guard: a claim that a feature/integration "works", "is wired in",
// "is verified", or "is functional end-to-end" must be backed by an actual runtime probe
// (a live curl/HTTP request, a server run that was actually hit, an integration test) — NOT
// by a green typecheck or unit-test suite alone. A passing `tsc`/`vitest` proves the code
// compiles and unit-tested logic holds; it does NOT prove a newly-wired integration (an API
// endpoint hitting an external service, a proxy, an auth flow) actually functions. The graded
// run that motivated this: the agent built a /api/prompts/generate endpoint, reported "wired
// in" after typecheck+tests passed, and the feature was in fact broken (missing dotenv load →
// 401 → 500 swallowed by the frontend) until the user tested it and reported failure.
//
// This guard fires only when BOTH hold: (1) the text asserts the feature/integration works
// (wired-in / verified / functional / end-to-end verbs), and (2) no live runtime probe was
// recorded this session (ledger.didExerciseRuntime is false). Static checks (tsc/vitest) do
// NOT satisfy the requirement. A plain "I added X" without a works-claim is out of scope —
// this only challenges the VERIFICATION claim, not the work claim.

// Asserts a feature/integration is functional / wired / verified working. Excludes
// recommendations and hypotheticals ("we could verify", "to wire it in, do X").
const WORKS_CLAIM_RE =
  /\b(wired in|wired up|is (?:now )?(?:working|functional|verified|live)|works (?:now|correctly|as expected|end[ -]?to[ -]?end)|verified (?:end[ -]?to[ -]?end|and working|working)|functional|end[ -]?to[ -]?end|is complete and (?:working|functional)|confirmed working|successfully (?:wired|integrated|connected)|integration (?:works|is working|complete))\b/i;

// A live integration probe: a real request against the thing under test, not a build/typecheck.
// Covers curl/httpie to a localhost/remote endpoint, a Node http/fetch probe, a server run that
// was then hit, or an integration/e2e test command. Deliberately excludes `npm run build`,
// `tsc`, `vitest`/`jest` (those are static and do not exercise the wired integration).
export const RUNTIME_EXERCISE_RE =
  /\b(curl\s|httpie|http\s+[A-Z]+|invoke-(webrequest|restmethod)|node\s+.+\bfetch\b|\baxios\b|\.request\(|supertest|integration test|e2e test|playwright|cypress|--integration|--e2e)\b/i;

export function detectUngroundedWorksClaim(text: string, ledger: ClaimLedger): boolean {
  if (!text || !ledger) return false;
  if (ledger.didExerciseRuntime) return false; // real probe ran this session — grounded
  // Only fire when the text actually asserts the feature works/is wired/verified.
  return WORKS_CLAIM_RE.test(text);
}

export function ungroundedWorksWarning(): string {
  return (
    `[SYSTEM WARNING] You claimed a feature/integration is "wired in" / "working" / "verified", ` +
    `but no live runtime probe (a real request/curl/HTTP call hitting the integration, an ` +
    `integration test, or a server run that was actually exercised) was recorded in your tool ` +
    `calls this session. A passing typecheck or unit-test suite proves the code compiles and ` +
    `unit logic holds — it does NOT prove a newly-wired integration (API endpoint, proxy, ` +
    `auth flow, external call) actually functions. Do NOT report a feature as working without ` +
    `exercising it: (1) actually run a real request against the endpoint/integration and confirm ` +
    `it returns the expected result, or (2) rephrase as "implemented; not yet runtime-verified". ` +
    `A "works" claim with only static checks behind it is a false verification.`
  );
}

