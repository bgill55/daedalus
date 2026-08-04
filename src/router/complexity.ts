import type { TaskComplexity } from './types.js';

export interface ComplexityOptions {
  smallTaskTokens: number;
  largeTaskTokens: number;
  forceComplex?: boolean;
}

export const DEFAULT_COMPLEXITY_OPTIONS: ComplexityOptions = {
  smallTaskTokens: 1500,
  largeTaskTokens: 8000,
};

const COMPLEX_KEYWORDS = [
  'refactor',
  'implement',
  'architect',
  'architecture',
  'feature',
  'investigate',
  'migrate',
  'optimize',
  'redesign',
  'overhaul',
  'integrate',
  'autopilot',
  'orchestrate',
  'troubleshoot',
  'end-to-end',
  'comprehensive',
  'multistep',
  'debug',
  'audit',
  'assess',
  'assessment',
  'roadmap',
  'sprint',
  'prioritize',
  'todo list',
];

// Tasks that must stay on the intelligence ("complex") tier. Demoting these to
// a weaker "standard" model produces poor results (ignored instructions, hallucinated
// tools) — see the prompt-vault build-fix observation. These denote work that needs a
// strong model: fixing a broken build, refactoring, multi-file edits.
const KEEP_ON_INTELLIGENCE_KEYWORDS = [
  'refactor',
  'build',
  'build is broken',
  'fix the build',
  'type error',
  'type errors',
  'typescript error',
  'typescript errors',
  'tsc',
  'multi-file',
  'multifile',
  'multi file',
  'validation',
  'implement',
  'feature',
  'migrate',
  'architect',
  'debug',
  'audit',
  'optimize',
  'overhaul',
  'redesign',
  'troubleshoot',
  'end-to-end',
];

const SIMPLE_KEYWORDS = [
  'comma',
  'typo',
  'semicolon',
  'whitespace',
  'capitalize',
  'rename',
  'formatting',
  'missing comma',
];

const FILE_PATH_RE = /[A-Za-z0-9_./\\-]+\.[a-zA-Z0-9]{1,4}/g;

function countFilePaths(text: string): number {
  const matches = text.match(FILE_PATH_RE);
  return matches ? new Set(matches).size : 0;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function countSentenceFragments(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/[.!?;]+/).filter(s => s.trim().length > 0).length;
}

export function classifyTaskStart(taskText: string, opts?: Partial<ComplexityOptions>): TaskComplexity {
  const options = { ...DEFAULT_COMPLEXITY_OPTIONS, ...opts };
  if (options.forceComplex) return 'complex';

  const lower = taskText.toLowerCase();
  const tokenEstimate = estimateTokens(taskText);
  const fileCount = countFilePaths(taskText);
  const complexScore = COMPLEX_KEYWORDS.filter(k => lower.includes(k)).length;
  const simpleScore = SIMPLE_KEYWORDS.filter(k => lower.includes(k)).length;

  if (tokenEstimate >= options.largeTaskTokens) return 'complex';
  if (fileCount >= 3) return 'complex';
  if (complexScore >= 1) return 'complex';
  if (countSentenceFragments(taskText) >= 2) return 'complex';
  if (simpleScore > 0 && tokenEstimate <= options.smallTaskTokens) return 'simple';
  return 'standard';
}

// Returns the minimum routing tier a task should be allowed to drop to.
// Build-fix / refactor / multi-file tasks return 'complex' so the trivial-streak
// downgrade can never push them onto a weaker "standard" model.
export function floorForTask(taskText: string): TaskComplexity {
  const lower = taskText.toLowerCase();
  const hit = KEEP_ON_INTELLIGENCE_KEYWORDS.some(k => lower.includes(k));
  return hit ? 'complex' : 'standard';
}

export interface TurnSignals {
  completionTokensThisTurn: number;
  writesThisTurn: number;
  toolCallsThisTurn: number;
  failedToolsThisTurn: number;
  toolMentionsThisTurn?: number;
}

export interface RoutingState {
  current: TaskComplexity;
  totalCompletionTokens: number;
  trivialTurnStreak: number;
  hasDowngraded?: boolean;
  // Minimum tier a task may be downgraded to. Build-fix / refactor / multi-file
  // tasks set this to 'complex' so the trivial-streak downgrade can never push
  // them onto a weak "standard" model.
  floor?: TaskComplexity;
}

const COMPLEX_OUTPUT_TOKENS = 8000;
const STANDARD_OUTPUT_TOKENS = 2500;
const DOWNGRADE_TRIVIAL_TURNS = 3;
const TRIVIAL_OUTPUT_TOKENS = 500;

export function rankOf(level: TaskComplexity): number {
  return level === 'simple' ? 0 : level === 'standard' ? 1 : 2;
}

export function stepRouting(state: RoutingState, s: TurnSignals): RoutingState {
  // A turn that actually did work (made tool calls, wrote files, or emitted
  // substantial output) is never "trivial" — even if it produced few output
  // tokens. Tool-heavy planning/refactor turns (e.g. reading files, running
  // builds) must not be downgraded just because they generated little prose.
  const didWork = s.toolCallsThisTurn >= 2 || s.writesThisTurn > 0 || s.completionTokensThisTurn > TRIVIAL_OUTPUT_TOKENS;
  const trivial = !didWork && s.failedToolsThisTurn === 0;
  const trivialTurnStreak = trivial ? state.trivialTurnStreak + 1 : 0;
  const totalCompletionTokens = state.totalCompletionTokens + s.completionTokensThisTurn;

  let current = state.current;
  const plannedToolCalls = (s.toolMentionsThisTurn ?? 0) >= 3 && s.toolCallsThisTurn === 0;
  if (current !== 'complex' && (totalCompletionTokens >= COMPLEX_OUTPUT_TOKENS || s.failedToolsThisTurn >= 3 || s.toolCallsThisTurn >= 20 || plannedToolCalls)) {
    current = 'complex';
  } else if (current === 'simple' && totalCompletionTokens >= STANDARD_OUTPUT_TOKENS) {
    current = 'standard';
  } else if (current !== 'simple' && trivialTurnStreak >= DOWNGRADE_TRIVIAL_TURNS && !state.hasDowngraded) {
    current = current === 'complex' ? 'standard' : 'simple';
  }

  // Enforce the task's minimum tier BEFORE any downgrade is committed. A
  // build-fix / refactor / multi-file task must never be pushed below its floor
  // (complex) onto a weak "standard" model. If the computed tier fell below the
  // floor, hold at the floor and mark hasDowngraded so it stops retrying.
  if (state.floor && rankOf(current) < rankOf(state.floor)) {
    current = state.floor;
  }

  if (current !== state.current && rankOf(current) < rankOf(state.current)) {
    return { current, totalCompletionTokens: 0, trivialTurnStreak: 0, hasDowngraded: true, floor: state.floor };
  }
  return { current, totalCompletionTokens, trivialTurnStreak, hasDowngraded: state.hasDowngraded === true, floor: state.floor };
}
