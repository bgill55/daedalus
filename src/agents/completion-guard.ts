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

// Words and phrases indicating a hypothetical proposal, suggestion, or future design.
// A sentence proposing a new file (e.g., "Each agent role would declare a capability.json")
// is not asserting a factual property of an existing repo file and must not trip the
// ungrounded-claim guard.
export const HYPOTHETICAL_OR_PROPOSAL_RE =
  /\b(?:would|could|might|may)\s+(?:\w+\s+){0,3}(?:be|have|use|include|contain|declare|define|add|create|export|import|need|hold|store)\b|\b(?:propos(?:e|ed|al|ing)|suggest(?:ed|ion|ing)?|idea|feature idea|hypothetical|for example|e\.g\.)\b|\b(?:create|creating|add|adding|introduce|introducing|new)\s+(?:a\s+|an\s+)?[\w.-]+\.\w+/i;

export function isHypotheticalOrProposal(text: string): boolean {
  if (!text) return false;
  return HYPOTHETICAL_OR_PROPOSAL_RE.test(text);
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
    if (isHypotheticalOrProposal(sentence)) continue;
    const mentioned = fileMentions(sentence);
    if (mentioned.length === 0) continue;
    if (!CG_CLAIM_VERB_RE.test(sentence)) continue;
    for (const raw of mentioned) {
      const base = baseOf(raw);
      // Skip runtime/platform/CLI tokens (node.js, tsx, npm, ...) — verified via commands,
      // not by reading a repo file. Flagging them as "uninspected" is a false positive.
      if (NON_FILE_TOKENS.has(base)) continue;
      const isObserved =
        ledger.observed(base) ||
        (base.endsWith('.js') && ledger.observed(base.slice(0, -3) + '.ts')) ||
        (base.endsWith('.ts') && ledger.observed(base.slice(0, -3) + '.js')) ||
        (base.endsWith('.mjs') && ledger.observed(base.slice(0, -4) + '.mts')) ||
        (base.endsWith('.mts') && ledger.observed(base.slice(0, -4) + '.mjs')) ||
        (base.endsWith('.d.ts') && (ledger.observed(base.slice(0, -5) + '.ts') || ledger.observed(base.slice(0, -5) + '.js')));
      if (!isObserved) return raw;
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
    if (isHypotheticalOrProposal(window)) continue;
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

// Fix (audit-hallucination hardening): a multi-section code review / architecture report must
// back its structural claims with CITATIONS (a file path + line, e.g. `src/index.ts:250`), not
// vague praise. The existing guards catch unverified FILE MENTIONS and a curated buzzword list,
// but they cannot catch generic architecture assertions that name no file and no buzzword
// ("well-structured", "no any leakage", "patch tool used for all modifications", "entry point is
// src/definitions.ts"). Those are exactly what a self-audit hallucinates. This guard forces a
// review deliverable to either (a) cite source locations, or (b) be framed as provisional.
// It is gated on isReviewDeliverable so normal coding turns (which legitimately make claims
// without citations) are NOT burdened.
const ARCH_CLAIM_RE =
  /\b(module|architecture|entry point|separates? (?:concerns|responsibilities)|type[ -]?safe|no (?:`?any`?|any leakage)|uses? (?:Zod|strongly[ -]?typed)|centrali[sz]ed|extensible|well[ -]?structured|maintainab|read[ -]?only|patch[ -]?only|graceful|self[ -]?heal|circuit[ -]?breaker|robust|encapsulat|separation of)\b/i;

// A citation is a `path/to/file.ts:NN` or `file.ts:NN` or `path:NN` token.
const CITATION_RE = /(?:[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|mjs|py|go|rs|java|cs|rb|cpp|c|json|md)):\d+/i;

/**
 * True when the text is a review deliverable that makes architecture/structure claims but
 * provides NO file:line citation (and names no source file at all). Returns the first flagged
 * architecture claim snippet, or null when the deliverable either cites sources or makes no
 * structural assertions. Gated to reviews so coding turns are unaffected.
 */
export function isUncitedArchClaim(text: string): string | null {
  if (!text) return null;
  if (!isReviewDeliverable(text)) return null;
  if (CITATION_RE.test(text)) return null; // the report cites at least one location — grounded
  const m = text.match(ARCH_CLAIM_RE);
  if (!m) return null;
  return m[0];
}

export function uncitedArchClaimWarning(term: string): string {
  return (
    `[SYSTEM WARNING] Your review asserts "${term}" (and likely other structural claims) but ` +
    `cites NO source location (e.g. \`src/index.ts:250\`). Vague architecture praise is exactly ` +
    `what a self-audit hallucinates — it reads as verified but is not backed by a cited file:line. ` +
    `Either (1) re-read the relevant source and attach a file:line to each structural claim you make, ` +
    `or (2) explicitly frame the section as a high-level impression, not a verified finding. ` +
    `Do NOT present uncited structural claims as discovered facts.`
  );
}

// Layer-1 citation validator (audit hardening — turns "citations required" into
// "citations checked"). A cited `file:NN` is only as trustworthy as the file it points at.
// This validator actually inspects the cited region and confirms the claim is *anchored* to
// real code: the line is in range AND the claimed symbol/keyword actually appears near it.
// It does NOT judge whether the prose interpretation of the line is correct — that is the
// (costlier) LLM-as-judge layer. But it catches the most common fabrications: a wrong file,
// a line number out of range, or a claimed symbol that isn't even in the file.
//
// Pure: callers inject a `readLines(path, fromLine, toLine)` reader so this stays testable
// without touching the filesystem. Returned `CitationCheck` lists every cited anchor that
// failed validation so the guard can force a correction.
export interface CitationCheck {
  file: string;
  line: number;
  reason: 'file-not-found' | 'line-out-of-range' | 'symbol-missing';
  claimedSymbols: string[];
}

const CITATION_SCAN_RE =
  /((?:[A-Za-z0-9_./\\@-]+\/)*[A-Za-z0-9_./\\@-]+\.(?:ts|tsx|js|jsx|mjs|py|go|rs|java|cs|rb|cpp|c|cc|h|hpp|json|md|yaml|yml)):(\d+)/gi;

// Pull candidate symbol tokens from a sentence: identifiers (>=3 chars, not pure prose words
// we expect in English). We keep camelCase/snake_case/PascalCase and dotted member accesses.
const SYMBOL_TOKEN_RE = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,2}/g;
const STOPWORD_RE =
  /^(the|a|an|and|or|but|for|with|from|that|this|these|those|its|their|our|you|your|we|is|are|was|were|be|been|has|have|had|of|to|in|on|at|by|as|it|he|she|they|not|no|yes|via|via|into|than|then|when|where|which|who|how|what|why|can|could|should|would|will|may|might|must|do|does|did|so|if|else|each|per|about|across|between|through|over|under|after|before|both|such|only|also|any|all|some|more|most|less|new|old|use|uses|used|using)$/i;

function extractClaimedSymbols(claim: string, around: string): string[] {
  const seen = new Set<string>();
  for (const m of claim.match(SYMBOL_TOKEN_RE) ?? []) {
    if (m.length < 3) continue;
    if (STOPWORD_RE.test(m)) continue;
    seen.add(m);
  }
  // Only keep symbols that actually appear in the cited region — those are the checkable ones.
  const region = around.toLowerCase();
  return [...seen].filter((s) => region.includes(s.toLowerCase()));
}

export interface CitationValidatorDeps {
  // Given a repo-relative file path and a line window, return the lines (1-indexed inclusive)
  // or null if the file cannot be read. The window is kept small (±12 lines) for cheap checks.
  readLines: (file: string, fromLine: number, toLine: number) => string[] | null;
  // Cheap existence check for a repo-relative path. Used by the prose-reference validator
  // (Layer 1b) to confirm a named file actually exists, including sibling test files.
  fileExists?: (file: string) => boolean;
}

export interface CitationClaim {
  file: string;
  line: number;
  // The sentence/paragraph the citation is embedded in (the structural claim being made).
  claimSentence: string;
  // The actual source lines around the cited anchor, 1-indexed inclusive window.
  codeRegion: string;
}

export interface CitationValidatorDeps {
  // Given a repo-relative file path and a line window, return the lines (1-indexed inclusive)
  // or null if the file cannot be read. The window is kept small (±12 lines) for cheap checks.
  readLines: (file: string, fromLine: number, toLine: number) => string[] | null;
  // Cheap existence check for a repo-relative path. Used by the prose-reference validator
  // (Layer 1b) to confirm a named file actually exists, including sibling test files.
  fileExists?: (file: string) => boolean;
}

// Extract every file:NN anchor in `text` together with the claim sentence it sits in and the
// real code region it points at. Used by both Layer 1 (anchor validation) and Layer 2
// (semantic judge). Deduplicates by anchor.
export function collectCitationClaims(
  text: string,
  deps: CitationValidatorDeps,
  window = 12,
): CitationClaim[] {
  if (!text || !deps?.readLines) return [];
  const matches = [...text.matchAll(CITATION_SCAN_RE)];
  const out: CitationClaim[] = [];
  const seenKeys = new Set<string>();
  for (const m of matches) {
    const file = m[1];
    const line = parseInt(m[2], 10);
    if (!Number.isFinite(line) || line < 1) continue;
    const key = `${file}:${line}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const idx = m.index ?? 0;
    const start = text.lastIndexOf('\n', idx) + 1;
    let end = text.indexOf('\n\n', idx);
    if (end === -1) end = text.length;
    const claimSentence = text.slice(start, end).trim();

    const from = Math.max(1, line - window);
    const to = line + window;
    const regionLines = deps.readLines(file, from, to);
    if (regionLines === null) continue; // Layer 1 handles missing files separately
    out.push({ file, line, claimSentence, codeRegion: regionLines.join('\n') });
  }
  return out;
}

export function validateCitations(
  text: string,
  deps: CitationValidatorDeps,
  window = 12,
): CitationCheck[] {
  if (!text || !deps?.readLines) return [];
  // Iterate raw anchors (not collectCitationClaims, which skips unreadable files) so a
  // missing file is still reported as a failure rather than silently dropped.
  const matches = [...text.matchAll(CITATION_SCAN_RE)];
  const failures: CitationCheck[] = [];
  const seenKeys = new Set<string>();
  for (const m of matches) {
    const file = m[1];
    const line = parseInt(m[2], 10);
    if (!Number.isFinite(line) || line < 1) continue;
    const key = `${file}:${line}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const idx = m.index ?? 0;
    const start = text.lastIndexOf('\n', idx) + 1;
    let end = text.indexOf('\n\n', idx);
    if (end === -1) end = text.length;
    const claimSentence = text.slice(start, end).trim();

    const from = Math.max(1, line - window);
    const to = line + window;
    const regionLines = deps.readLines(file, from, to);
    if (regionLines === null) {
      failures.push({ file, line, reason: 'file-not-found', claimedSymbols: [] });
      continue;
    }
    if (line > regionLines.length + (from - 1)) {
      failures.push({ file, line, reason: 'line-out-of-range', claimedSymbols: [] });
      continue;
    }
    const around = regionLines.join('\n');
    const symbols = extractClaimedSymbols(claimSentence, around);
    if (symbols.length > 0) {
      const citedLine = regionLines[line - from] ?? '';
      const onCitedLine = symbols.filter((s) => citedLine.toLowerCase().includes(s.toLowerCase()));
      if (onCitedLine.length === 0) {
        failures.push({ file, line, reason: 'symbol-missing', claimedSymbols: symbols });
      }
    }
  }
  return failures;
}

// Layer 1b: prose file-reference validation (audit hardening).
//
// Layer 1 (above) only handles inline `path:NN` citations. Audit reports frequently reference
// files by NAME only (e.g. "src/indexing/watcher.ts") with no line number. This validator
// catches two gaps that Layer 1 misses:
//   1. file-not-found: a named source file does not exist at the cited path.
//   2. false-negative-claim: the report asserts a file (typically a test file) "does not exist"
//      / "no test file exists", but a sibling test file actually does. This is the exact
//      fabrication class that slipped through the prior audit ("no watcher.test.ts exists").
export interface ProseRefCheck {
  file: string;
  reason: 'file-not-found' | 'false-negative-claim';
  detail: string;
}

// Matches repo-relative source-file references: src/foo/bar.ts, `src/foo/bar.ts`,
// src/foo/bar.test.ts, path/to/file.tsx, etc. Accepts an optional leading backtick so paths
// wrapped in inline code (`like this`) are still captured. Tuned to avoid matching prose.
const PROSE_FILE_RE =
  /(?:^|\s)`?((?:src|test|tests|lib|app|packages|\.?\/)?[A-Za-z0-9_./@-]+\/[A-Za-z0-9_./@-]+\.(?:ts|tsx|js|jsx|mjs|py|go|rs|java|cs|rb|cpp|c|cc|h|hpp|json|md|yaml|yml))`?/g;

// Detects an explicit negative-existence claim about a file ("no test file exists",
// "no *.test.ts file exists", "no tests for X").
const NEG_EXIST_RE =
  /\b(no|not|without|lacking|missing|absent)\b[^?!]*?(test file|tests?|\*\.test\.[a-z]+|spec\.[a-z]+|file|coverage|integration test|e2e)[^?!]*(exists?|present|found|available|written|cover)/i;

// Given a source file path, return the set of sibling test paths that SHOULD exist if the
// project follows its own conventions (colocated *.test.ts beside the source).
function siblingTestPaths(file: string): string[] {
  const m = file.match(/^(.*\/)?([A-Za-z0-9_]+)\.(ts|tsx|js|jsx)$/);
  if (!m) return [];
  const dir = m[1] ?? '';
  const base = m[2];
  const ext = m[3];
  return [
    `${dir}${base}.test.${ext}`,
    `${dir}__tests__/${base}.test.${ext}`,
    `${dir}tests/${base}.test.${ext}`,
  ];
}

export function validateProseReferences(
  text: string,
  deps: CitationValidatorDeps,
): ProseRefCheck[] {
  if (!text || !deps?.fileExists) return [];
  const fileExists = deps.fileExists;
  const checks: ProseRefCheck[] = [];
  const seen = new Set<string>();

  const referenced = new Set<string>();
  for (const m of text.matchAll(PROSE_FILE_RE)) {
    const file = m[1];
    referenced.add(file);
  }
  if (referenced.size === 0) return checks;

  // 1. File existence: every named source file must exist.
  for (const file of referenced) {
    if (seen.has(file)) continue;
    seen.add(file);
    if (!fileExists(file)) {
      checks.push({ file, reason: 'file-not-found', detail: 'named file does not exist in the codebase' });
    }
  }

  // 2. Negative-existence claims about test files: if the report names a test file that DOES
  //    exist, or names a source file that HAS a sibling test, the "no test exists" claim is false.
  for (const sentence of text.split(/\n{1,}|(?<=[.!?])\s+/)) {
    if (!NEG_EXIST_RE.test(sentence)) continue;
    for (const m of sentence.matchAll(PROSE_FILE_RE)) {
      const file = m[1];
      // Only the test file itself being named-and-present is a direct false-negative. A source
      // file existing is expected and not what the claim disputes — let the sibling check below
      // handle "source exists but its test doesn't".
      if (/\.(test|spec)\.[a-z]+$/.test(file) && fileExists(file)) {
        checks.push({
          file,
          reason: 'false-negative-claim',
          detail: `report claims no test file exists, but ${file} is present`,
        });
        continue;
      }
      // Or it names a source file — check for a real sibling test.
      for (const testPath of siblingTestPaths(file)) {
        if (fileExists(testPath)) {
          checks.push({
            file: testPath,
            reason: 'false-negative-claim',
            detail: `report claims no test file exists, but ${testPath} is present`,
          });
          break;
        }
      }
    }
  }

  return checks;
}

// Layer-2 semantic verification (audit hardening). Layer 1 only confirms the citation points
// at a real symbol on a real line. Layer 2 asks a separate model call to judge whether the
// PROSE CLAIM actually follows from the cited code — catching the subtle case where the anchor
// is correct but the interpretation is wrong. Batched into ONE call over all claims to keep the
// cost bounded (one extra completion per audit, not one per citation).
export interface JudgeVerdict {
  file: string;
  line: number;
  supported: boolean;
  reason: string;
}

export function buildJudgePrompt(claims: CitationClaim[]): string {
  const items = claims
    .map((c, i) => {
      return `CLAIM ${i + 1}: ${c.claimSentence}\nCITED CODE (${c.file}:${c.line}):\n\`\`\`\n${c.codeRegion}\n\`\`\``;
    })
    .join('\n\n');
  return (
    `You are a strict code-reviewer verifying an architecture audit. For each CLAIM below, decide ` +
    `whether the CITED CODE actually supports the claim. A claim is SUPPORTED only if the cited code ` +
    `region demonstrably shows what the claim asserts (e.g. "X is validated by Zod" must point at a ` +
    `Zod schema validating X). A claim is UNSUPPORTED if the code does not show it, shows the opposite, ` +
    `or the cited region is irrelevant to the claim.\n\n` +
    `${items}\n\n` +
    `Respond ONLY with a JSON array, one object per claim in order, shaped exactly:\n` +
    `[{"claim":1,"supported":true,"reason":"one sentence"}, ...]\n` +
    `Do not add prose outside the JSON array.`
  );
}

// Tolerant parser: extract the first JSON array from the judge reply and map verdicts back to
// claims by index. Returns only successfully parsed verdicts (skips malformed entries) so a
// partial/garbled judge response degrades gracefully rather than blocking the audit.
export function parseJudgeResponse(raw: string, claims: CitationClaim[]): JudgeVerdict[] {
  if (!raw) return [];
  const arrMatch = raw.match(/\[[\s\S]*\]/);
  if (!arrMatch) return [];
  let parsed: Array<{ claim?: number; supported?: boolean; reason?: string }>;
  try {
    parsed = JSON.parse(arrMatch[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const verdicts: JudgeVerdict[] = [];
  for (const entry of parsed) {
    if (typeof entry?.supported !== 'boolean') continue;
    const idx = (typeof entry.claim === 'number' ? entry.claim : 0) - 1;
    const claim = claims[idx];
    if (!claim) continue;
    verdicts.push({
      file: claim.file,
      line: claim.line,
      supported: entry.supported,
      reason: typeof entry.reason === 'string' ? entry.reason : '',
    });
  }
  return verdicts;
}

export function judgeClaimWarning(unsupported: JudgeVerdict[]): string {
  const lines = unsupported
    .map((v) => `- ${v.file}:${v.line} — ${v.reason || 'claim not supported by the cited code'}`)
    .join('\n');
  return (
    `[SYSTEM WARNING] A verification pass found claims in your review that are NOT supported by the ` +
    `code they cite:\n${lines}\nThe citation points at real code, but the code does not show what the ` +
    `claim asserts. Either (1) re-read the cited region and correct the claim to match what the code ` +
    `actually does, or (2) drop the claim. Do NOT present an interpretation the cited code contradicts.`
  );
}

export function proseRefWarning(checks: ProseRefCheck[]): string {
  const lines = checks
    .map((c) => `- ${c.file} — ${c.detail}`)
    .join('\n');
  return (
    `[SYSTEM WARNING] Your review references files whose existence does not check out against the ` +
    `actual codebase:\n${lines}\nEither (1) re-verify the file on disk before asserting it is missing ` +
    `or misnamed, or (2) drop the claim. Do NOT assert a file is absent without checking; the codebase ` +
    `is the source of truth.`
  );
}

export function citationValidationWarning(failures: CitationCheck[]): string {
  const lines = failures
    .map((f) => {
      const why =
        f.reason === 'file-not-found'
          ? `file not found`
          : f.reason === 'line-out-of-range'
            ? `line ${f.line} is out of range`
            : `none of the claimed symbols (${f.claimedSymbols.join(', ')}) appear on the cited line`;
      return `- ${f.file}:${f.line} — ${why}`;
    })
    .join('\n');
  return (
    `[SYSTEM WARNING] Your review cites source locations that do not check out against the actual ` +
    `codebase:\n${lines}\nA citation is only trustworthy if it points at real code that supports the ` +
    `claim. Either (1) re-read the cited file and fix the path/line so it anchors to the real symbol, ` +
    `or (2) drop the citation and the unsupported claim. Do NOT present fabricated file:line references ` +
    `as evidence.`
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
  /\b(wired in|wired up|is (?:now )?(?:working|verified working|live)|works (?:now|correctly|as expected|end[ -]?to[ -]?end)|verified (?:end[ -]?to[ -]?end|and working)|is complete and (?:working|functional)|confirmed working|successfully (?:wired|integrated)|integration is (?:working|functional|complete)|tested end[ -]?to[ -]?end and working)\b/i;

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

