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
  if (simpleScore > 0 && tokenEstimate <= options.smallTaskTokens) return 'simple';
  return 'standard';
}

export interface TurnSignals {
  completionTokensThisTurn: number;
  writesThisTurn: number;
  toolCallsThisTurn: number;
  failedToolsThisTurn: number;
}

export interface RoutingState {
  current: TaskComplexity;
  totalCompletionTokens: number;
  trivialTurnStreak: number;
}

const COMPLEX_OUTPUT_TOKENS = 8000;
const STANDARD_OUTPUT_TOKENS = 2500;
const DOWNGRADE_TRIVIAL_TURNS = 3;
const TRIVIAL_OUTPUT_TOKENS = 500;

export function rankOf(level: TaskComplexity): number {
  return level === 'simple' ? 0 : level === 'standard' ? 1 : 2;
}

export function stepRouting(state: RoutingState, s: TurnSignals): RoutingState {
  const trivial = s.writesThisTurn === 0 && s.failedToolsThisTurn === 0 && s.completionTokensThisTurn <= TRIVIAL_OUTPUT_TOKENS;
  const trivialTurnStreak = trivial ? state.trivialTurnStreak + 1 : 0;
  const totalCompletionTokens = state.totalCompletionTokens + s.completionTokensThisTurn;

  let current = state.current;
  if (current !== 'complex' && (totalCompletionTokens >= COMPLEX_OUTPUT_TOKENS || s.failedToolsThisTurn >= 3 || s.toolCallsThisTurn >= 20)) {
    current = 'complex';
  } else if (current === 'simple' && totalCompletionTokens >= STANDARD_OUTPUT_TOKENS) {
    current = 'standard';
  } else if (current !== 'simple' && trivialTurnStreak >= DOWNGRADE_TRIVIAL_TURNS) {
    current = current === 'complex' ? 'standard' : 'simple';
  }

  if (current !== state.current && rankOf(current) < rankOf(state.current)) {
    return { current, totalCompletionTokens: 0, trivialTurnStreak: 0 };
  }
  return { current, totalCompletionTokens, trivialTurnStreak };
}
