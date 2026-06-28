import fs from 'fs';
import readline from 'readline';
import pc from 'picocolors';

import { pendingNotifications } from './agents/background.js';
import { searchSymbols as ftsSearch } from './indexing/fts.js';
import { getSessionTodos, setSessionTodos, buildTodoContext } from './tools/builtin/todo.js';
import { calculateSessionTokens } from './session/tokens.js';
import { printUserTurn, turnSeparator } from './formatting.js';
import type { ToolContext, ToolCall, ChatMessage } from './types.js';
import type { LocalRouter } from './router/index.js';
import type { SessionManager } from './session/manager.js';
import type { SqliteTodo } from './session/sqlite.js';
import type { UserProfile } from './profile.js';
import { commandsList, executeCommand, CommandContext } from './commands.js';
import { extractAndSave } from './extraction.js';
import { resetTurnAborted } from './model.js';

export interface ReplDeps {
  config: any;
  configDir: string;
  cliTempDir: string;
  router: LocalRouter;
  sessionManager: SessionManager;
  userProfile: UserProfile;
  messages: ChatMessage[];
  activeFiles: Map<string, string>;
  toolContext: ToolContext;
  getSystemPromptWithMemory: () => string;
  callModelWithTools: (userContent: string, imageBase64?: string) => Promise<{ content: string; toolCalls: ToolCall[] }>;
  callModelWithFallback: (userContent: string, imageBase64?: string) => Promise<string>;
  getIndexDbPath: () => string;
}

export function createRepl(deps: ReplDeps): () => Promise<void> {
  const {
    config, configDir, cliTempDir, router, sessionManager, userProfile,
    messages, activeFiles, toolContext,
    getSystemPromptWithMemory,
    callModelWithTools, callModelWithFallback, getIndexDbPath,
  } = deps;

  let sessionId = sessionManager.sessionId;

  // Build commands completion list dynamically from registered commands
  const COMMANDS = commandsList.flatMap(cmd => [cmd.name, ...(cmd.aliases || [])]);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: (line: string) => {
      const prefix = line.toLowerCase();
      const hits = prefix.startsWith('/') || prefix.startsWith('?') || prefix.startsWith('exit') || prefix.startsWith('quit')
        ? COMMANDS.filter(c => c.startsWith(prefix))
        : [];
      return [hits.length ? hits : COMMANDS, prefix];
    },
  });

  toolContext.askLine = (prompt: string) => new Promise((resolve) => rl.question(prompt, resolve));

  function askLine(prompt: string): Promise<string> {
    return new Promise((resolve) => rl.question(prompt, resolve));
  }

  function readMultiLineInput(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      const lines: string[] = [];
      let timer: ReturnType<typeof setTimeout> | null = null;
      let resolved = false;

      const onLine = (line: string) => {
        if (resolved) return;
        // Non-interactive (piped): return single line immediately
        // so "/orchestrate ...\n/exit" doesn't get joined into one input
        if (!process.stdin.isTTY) {
          resolved = true;
          rl.off('line', onLine);
          resolve(line);
          return;
        }
        lines.push(line);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          resolved = true;
          rl.off('line', onLine);
          resolve(lines.join('\n'));
        }, 80);
      };

      rl.on('line', onLine);
      process.stdout.write(prompt);
      process.stdin.resume();
      rl.resume();
    });
  }

  function initializeSessionState(loaded: {
    sessionId: string;
    turns: ChatMessage[];
    activeFiles: Map<string, string>;
    todos: SqliteTodo[];
  }) {
    sessionId = loaded.sessionId;
    toolContext.sessionId = loaded.sessionId;

    activeFiles.clear();
    for (const [k, v] of loaded.activeFiles.entries()) {
      activeFiles.set(k, v);
    }
    toolContext.activeFiles = new Map(activeFiles);

    messages.length = 0;
    const sysPrompt = getSystemPromptWithMemory();
    messages.push({ role: 'system', content: sysPrompt });

    if (loaded.turns.length > 0) {
      const userOrAssistantTurns = loaded.turns.filter(t => t.role !== 'system');
      messages.push(...userOrAssistantTurns);
    }

    setSessionTodos(loaded.sessionId, loaded.todos);

    console.log(pc.gray(`Active files in context: ${activeFiles.size}`));
    console.log(pc.gray(`Loaded ${loaded.turns.length} message turn(s)`));
  }

  async function chatLoop(): Promise<void> {
    try {
      while (true) {
        if (pendingNotifications.length > 0) {
          console.log();
          while (pendingNotifications.length > 0) {
            console.log(pc.yellow(pendingNotifications.shift()!));
          }
        }
        let prompt = `\n${pc.cyan('  ⬡')} `;
        if (activeFiles.size > 0 || (config.ui.showTokens && messages.length > 1)) {
          const fileStr = activeFiles.size > 0 ? `${activeFiles.size} file${activeFiles.size > 1 ? 's' : ''}` : '';
          let tokenStr = '';
          if (config.ui.showTokens) {
            const tokens = calculateSessionTokens(messages, buildFileContext());
            const total = tokens.total;
            tokenStr = total >= 1000 ? `${(total / 1000).toFixed(1)}kt` : `${total}t`;
          }
          const separator = fileStr && tokenStr ? ' · ' : '';
          prompt += pc.dim(`[${fileStr}${separator}${tokenStr}] `);
        }
        prompt += `${pc.bold(pc.white('›'))} `;
        const input = await readMultiLineInput(prompt);
        const trimmedInput = input.trim();
        if (!trimmedInput) continue;

        resetTurnAborted();
        toolContext.autoApproveTools = false;

        // Construct CommandContext
        const cmdContext: CommandContext = {
          config,
          configDir,
          cliTempDir,
          router,
          sessionManager,
          userProfile,
          projectHash: sessionManager.projectHash,
          messages,
          activeFiles,
          toolContext,
          getSystemPromptWithMemory,
          callModelWithTools,
          callModelWithFallback,
          rl,
          initializeSessionState,
          buildFileContext,
          askLine,
          buildIndexContext,
          getIndexDbPath,
        };

        // Try executing as command first
        const wasCommand = await executeCommand(trimmedInput, cmdContext);
        if (wasCommand) {
          continue;
        }

        // User Message Processing (regular assistant chat)
        try {
          const filesContext = buildFileContext();
          const indexCtx = await buildIndexContext(trimmedInput);
          const todoCtx = buildTodoContext(sessionId);
          const userContent = `${indexCtx}${todoCtx}${filesContext}User Prompt: ${trimmedInput}`;
          printUserTurn(trimmedInput);
          await callModelWithTools(userContent);

          sessionManager.saveSessionState(messages, activeFiles, getSessionTodos(sessionId));
          await extractAndSave(router, sessionManager, messages);
        } catch {
          try {
            const filesContext = buildFileContext();
            const todoCtx = buildTodoContext(sessionId);
            const userContent = `${todoCtx}${filesContext}User Prompt: ${trimmedInput}`;
            console.log(pc.yellow('\n  [RETRY] Trying fallback mode...'));
            const fallbackResult = await callModelWithFallback(userContent);
            if (fallbackResult) {
              sessionManager.saveSessionState(messages, activeFiles, getSessionTodos(sessionId));
              await extractAndSave(router, sessionManager, messages);
            }
          } catch (fallbackErr: any) {
            const firstLine = (fallbackErr.message || '').split('\n')[0];
            console.log(pc.red(`\n  ${pc.bold('[ERROR]')} Fallback also failed: ${firstLine}`));
            console.log(pc.dim('         Check that at least one local server is running or run /doctor to debug.'));
          }
        }
        turnSeparator();
      }
    } finally {
      rl.close();
    }
  }

  function buildFileContext(): string {
    if (activeFiles.size === 0) return '';
    let ctx = '--- ACTIVE FILES CONTEXT ---\n';
    for (const [absPath, filename] of activeFiles) {
      let content: string;
      if (fs.existsSync(absPath)) {
        content = fs.readFileSync(absPath, 'utf8');
      } else {
        content = '[New file - does not exist yet]';
      }
      ctx += `[File: ${filename}]\n\`\`\`\n${content}\n\`\`\`\n\n`;
    }
    ctx += '----------------------------\n\n';
    return ctx;
  }

  async function buildIndexContext(userMessage: string): Promise<string> {
    if (!config.indexing.enabled || !toolContext.indexDb) return '';
    const indexDb = toolContext.indexDb;

    const symbolCandidates = userMessage.match(/\b(?:[a-z]+[A-Z]|[A-Z][a-z])[a-zA-Z0-9_]*\b/g) || [];
    const words = userMessage.split(/\s+/).filter(w => w.length > 2);
    const allTerms = [...symbolCandidates, ...words];

    if (allTerms.length === 0) return '';

    let ctx = '\n--- RELEVANT CODE SYMBOLS (from FTS5 index) ---\n';
    let count = 0;
    const seen = new Set<string>();

    try {
      for (const term of allTerms) {
        if (count >= 8) break;
        const results = ftsSearch(indexDb, term, sessionManager.projectHash, 3);
        for (const s of results) {
          const key = `${s.name}:${s.file_path}`;
          if (seen.has(key)) continue;
          seen.add(key);
          ctx += `  [${s.kind}] ${s.name} → ${s.file_path}:${s.line_start}`;
          if (s.signature) ctx += `  (${s.signature.slice(0, 80)})`;
          ctx += '\n';
          count++;
        }
      }
    } catch {
      // Index not available — skip
    }

    if (count === 0) return '';
    ctx += '------------------------------------------\n\n';
    return ctx;
  }

  return chatLoop;
}
