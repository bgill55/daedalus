// Shared types for the CLI

import type Database from 'better-sqlite3';

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
  patchFailureTotal?: number; // session-wide count of patch syntax-reverts (loop guard, never reset by intervening reads)
  terminalFailureStreak?: Map<string, number>; // normalized command prefix -> consecutive failure count
  terminalRepeatStreak?: Map<string, number>; // full normalized command -> consecutive identical-run count (no-progress loop guard)
  askLine?: (prompt: string) => Promise<string>;
  allowTestEdits?: boolean;
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