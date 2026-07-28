import type { DaedalusConfig } from '../config/index.js';
import type { ToolContext, ToolCall, ChatMessage } from '../types.js';
import type { LocalRouter } from '../router/index.js';
import type { SessionManager } from '../session/manager.js';
import type { UserProfile } from '../profile.js';
import type { SqliteTodo } from '../session/sqlite.js';
import type readline from 'readline';

export interface CommandContext {
  config: DaedalusConfig;
  configDir: string;
  cliTempDir: string;
  router: LocalRouter;
  sessionManager: SessionManager;
  userProfile: UserProfile;
  projectHash: string;
  messages: ChatMessage[];
  activeFiles: Map<string, string>;
  toolContext: ToolContext;
  getSystemPromptWithMemory: () => string;
  callModelWithTools: (userContent: string, imageBase64?: string) => Promise<{ content: string; toolCalls: ToolCall[] }>;
  callModelWithFallback: (userContent: string, imageBase64?: string) => Promise<string>;
  rl: readline.Interface;
  initializeSessionState: (loaded: { sessionId: string; turns: ChatMessage[]; activeFiles: Map<string, string>; todos: SqliteTodo[] }) => void;
  buildFileContext: () => string;
  askLine: (prompt: string) => Promise<string>;
  buildIndexContext: (msg: string) => Promise<string>;
  getIndexDbPath: () => string;
}

export interface Command {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  helpText?: string;
  execute: (args: string, ctx: CommandContext) => Promise<boolean | void>;
}
