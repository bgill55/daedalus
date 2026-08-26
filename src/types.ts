// Shared types for the CLI

import type Database from 'better-sqlite3';
import type { ClaimLedger } from './agents/completion-guard.js';

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  success: boolean;
  content: string;
  error?: string;
}

export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatMessageContent = string | null | MessageContentPart[];

export function messageText(content: ChatMessageContent): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('')
    .trim();
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ChatMessageContent;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolContext {
  sessionId: string;
  projectRoot: string;
  projectHash: string;            // sha256 prefix of projectRoot — stable across calls
  indexDb?: Database.Database;    // shared FTS5 codebase index (lazy-opened)
  activeFiles: Map<string, string>;  // absPath -> alias
  agentRole: string;
  abortSignal: AbortSignal;
  autoApplyEdits?: 'prompt' | 'all' | 'skip';
  autoApproveTools?: boolean;
  pauseSpinner?: () => void;
  resumeSpinner?: () => void;
  patchHistory?: PatchEntry[];    // for /undo support
  sessionReadCache?: Map<string, number>;  // absPath -> mtime when last read
  patchFailureStreak?: Map<string, number>; // absPath -> consecutive failure count
  patchRepeatKey?: Map<string, string>; // absPath -> last revert signature (target+intent); same key across reverts flags a same-edit loop
  patchRepeatCount?: Map<string, number>; // absPath -> consecutive same-intent revert count (Munder Difflin "looping" signal)
  patchFailureTotal?: number; // session-wide count of patch syntax-reverts (loop guard, never reset by intervening reads)
  terminalFailureStreak?: Map<string, number>; // normalized command prefix -> consecutive failure count
  terminalRepeatStreak?: Map<string, number>; // full normalized command -> consecutive identical-run count (no-progress loop guard)
  terminalConsecutiveFails?: number; // consecutive terminal failures across ALL commands (diversifying retry-loop guard)
  verifyFailStreak?: number; // consecutive FAILING build/test/lint runs; resets only on a PASSING verify run (catches patch→test→patch→test loops where patches reset terminalConsecutiveFails)
  lastVerifyPassCount?: number; // last actual passing-test count observed from a verify run's output (used to catch fabricated "N tests passing" summary claims)
  lastVerifyPassed?: boolean; // whether the most recent build/test/lint verify run was GREEN (true) or RED (false). Lets the completion guard catch "tests passing / clean state" claims that omit a failing overall suite.
  // Set when a terminal run of the BUILT ARTIFACT (node dist/cli.js, npm run start, a runtime
  // probe) exited non-zero with a hard error this session. Lets the completion guard reject a
  // "project works / CLI executed / verified" claim that is contradicted by the agent's own
  // failed run. Cleared by any later successful run; null until the first failure.
  lastRuntimeFailure?: { command: string; error: string } | null;
  // Set true for the rest of the session once a build/test/lint verify command trips
  // the terminal circuit breaker, so a later turn cannot falsely claim "build/tests pass"
  // without a fresh successful run (see loop-guards.ts verification-claim guard).
  verifyBreakerTrippedLastTurn?: boolean;
  // Diagnosis of WHY a single-agent task hit the max-tool-turns checkpoint, captured at the
  // checkpoint so it can be recorded into the task's sigma memory (instead of a bare
  // "Agent reached max turns" stub). Empty/undefined means a natural checkpoint.
  maxTurnsCause?: string;
  // Keys of completion/verification guards ([CHECK] ... ) already fired this session,
  // so the SAME claim is not re-verified every turn (the "verify the same 5 items 4x"
  // token waste). Mirrors claimLedger/verifyBreakerTrippedLastTurn persistence.
  firedCompletionGuards?: Set<string>;
  // Persisted across turns: true once we've escalated the model on a failure streak,
  // so we don't re-escalate into a model-swap churn on the next turn (which silently
  // resets escalatedThisStreak to false each turn).
  escalatedStreak?: boolean;
  askLine?: (prompt: string) => Promise<string>;
  allowTestEdits?: boolean;
  // Set true when the user live-approved a test write via askLine. Once true,
  // the test-suite lock stays open for the rest of the session even if a later
  // sub-task goal doesn't signal test intent — distinguishes a deliberate
  // approval from the goal-text regex match.
  testApprovalGranted?: boolean;
  // Test-file paths the agent already tried (and was blocked) to write this
  // session. Used to detect a blocked write being re-attempted via a different
  // tool (e.g. write_file blocked -> terminal cat >) and force the agent to
  // report the blocker instead of silently routing around the lock.
  blockedTestWrites?: Set<string>;
  contextVariables?: Record<string, unknown>;
  // Claim-grounding ledger (session-scoped): records every file the agent actually
  // inspected this session (read/search/terminal) so factual claims about those files
  // are credited even across turns. MUST be persisted on the context (not recreated per
  // turn) — see model.ts runSingleAgentTurn. Lives here to match verifyBreakerTrippedLastTurn.
  claimLedger?: ClaimLedger;
}

export interface PatchEntry {
  filePath: string;
  oldContent: string;
  newContent: string;
  timestamp?: number;
  description: string;
}

export type ToolExecutor = (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;

export type ProviderStatus = 'UP' | 'DOWN' | 'UNKNOWN';

export interface ProviderHealth {
  status: ProviderStatus;
  avgLatencyMs: number | null;
  apiKey: string;
}

export interface HealthPayload {
  routerStrategy: string;
  providers: Record<string, ProviderHealth>;
}

export interface RouteSkip {
  endpoint: string;
  model: string;
  reason: string;
}

export interface RouteLogEntry {
  ts: string;
  model: string;
  endpoint: string;
  modelId: string;
  reason: string;
  skipped: Array<{ model: string; endpoint: string; reason: string }>;
}

export interface StaticFinding {
  rule: string;
  severity: 'error' | 'warning';
  file: string;
  line: number;
  message: string;
}

export interface StaticCheckResult {
  findings: StaticFinding[];
  passed: boolean;
  markdownReport: string;
}

declare global {
  var isTui: boolean | undefined;
  var originalStdoutWrite: typeof process.stdout.write | undefined;
  var originalStderrWrite: typeof process.stderr.write | undefined;
  var tuiScreen: unknown;
  var tuiLogBox: unknown;
}