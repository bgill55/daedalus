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

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: any;
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
  askLine?: (prompt: string) => Promise<string>;
}

export interface PatchEntry {
  filePath: string;
  oldContent: string;
  newContent: string;
  timestamp: number;
  description: string;
}

export type ToolExecutor = (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;