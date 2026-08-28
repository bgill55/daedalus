import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { Writable } from 'stream';
import pc from 'picocolors';

import { pendingNotifications } from './agents/background.js';
import { searchSymbols as ftsSearch } from './indexing/fts.js';
import { getSessionTodos, setSessionTodos, buildTodoContext } from './tools/builtin/todo.js';
import { calculateSessionTokens } from './session/tokens.js';
import { printUserTurn, turnSeparator } from './formatting.js';
import type { ToolContext, ToolCall, ChatMessage } from './types.js';
import type { DaedalusConfig } from './config/index.js';
import type { LocalRouter } from './router/index.js';
import type { SessionManager } from './session/manager.js';
import type { SqliteTodo } from './session/sqlite.js';
import type { UserProfile } from './profile.js';
import { commandsList, executeCommand, CommandContext } from './commands.js';
import { extractAndSave } from './extraction.js';
import { resetTurnAborted } from './model.js';
import { parseAgentTag } from './agents/roles.js';
import { SigmaMemEngine } from './session/sigma-mem.js';
import { synthesizeSkillFromTurn } from './skills/auto-synthesis.js';
import { brand, dim, info, warn, err } from './ui/theme.js';

export interface ReplDeps {
  config: DaedalusConfig;
  configDir: string;
  cliTempDir: string;
  router: LocalRouter;
  sessionManager: SessionManager;
  userProfile: UserProfile;
  messages: ChatMessage[];
  activeFiles: Map<string, string>;
  toolContext: ToolContext;
  getSystemPromptWithMemory: (userRequest?: string) => Promise<string>;
  callModelWithTools: (userContent: string, imageBase64?: string) => Promise<{ content: string; toolCalls: ToolCall[] }>;
  callModelWithFallback: (userContent: string, imageBase64?: string) => Promise<string>;
  getIndexDbPath: () => string;
  // Detected project stack tags (from classifyStack) used to bias the
  // first-turn prompt hint toward the active project. Empty when unknown.
  projectStackTags: string[];
}

export function createRepl(deps: ReplDeps): () => Promise<void> {
  const {
    config, configDir, cliTempDir, router, sessionManager, userProfile,
    messages, activeFiles, toolContext,
    getSystemPromptWithMemory,
    callModelWithTools, callModelWithFallback, getIndexDbPath,
    projectStackTags,
  } = deps;

  let sessionId = sessionManager.sessionId;

  // Build commands completion list dynamically from registered commands
  const COMMANDS = commandsList.flatMap(cmd => [cmd.name, ...(cmd.aliases || [])]);

  // Persistent command history at ~/.daedalus/history so Up/Down works across
  // sessions. The file retains the most recent entries (capped) and excludes
  // blank lines and exact duplicates of the immediately previous entry.
  const HISTORY_LIMIT = 1000;
  const historyPath = path.join(configDir || path.join(os.homedir(), '.daedalus'), 'history');
  let history: string[] = [];
  try {
    if (fs.existsSync(historyPath)) {
      history = fs.readFileSync(historyPath, 'utf8')
        .split('\n')
        .map(l => l.replace(/\r$/, ''))
        .filter(Boolean);
    }
  } catch { /* best-effort load */ }

  function appendHistory(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (history[history.length - 1] === trimmed) return;
    history.push(trimmed);
    if (history.length > HISTORY_LIMIT) history = history.slice(history.length - HISTORY_LIMIT);
    try {
      fs.mkdirSync(path.dirname(historyPath), { recursive: true });
      fs.writeFileSync(historyPath, history.join('\n') + '\n', 'utf8');
    } catch { /* best-effort persist */ }
  }

  // Wrapper stream so rl.close() doesn't call process.stdout.end(),
  // which would break TUI rendering on mode switch
  const rlOutput = new Writable({
    write(chunk, encoding, callback) {
      process.stdout.write(chunk, encoding);
      callback();
    },
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: rlOutput,
    history,
    historySize: HISTORY_LIMIT,
    completer: (line: string) => {
      const prefix = line.toLowerCase();
      const hits = prefix.startsWith('/') || prefix.startsWith('?') || prefix.startsWith('exit') || prefix.startsWith('quit')
        ? COMMANDS.filter(c => c.startsWith(prefix))
        : [];
      return [hits.length ? hits : COMMANDS, prefix];
    },
  });

  // In fully headless/auto-approve mode (safety.autoApprovePlans or DAEDALUS_AUTO_APPROVE),
  // stdin is a closed pipe, so rl.question() throws "readline was closed". Auto-resolve
  // prompts (Continue working? / Allow?) with "y" instead of blocking on the dead readline.
  const headlessAutoApprove =
    config.safety?.autoApprovePlans === true || process.env.DAEDALUS_AUTO_APPROVE === 'true';
  toolContext.askLine = headlessAutoApprove
    ? () => Promise.resolve('y')
    : (prompt: string) => new Promise((resolve) => rl.question(prompt, resolve));

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
      // Let readline own the prompt (rl.prompt) so its arrow-key -> rl.history
      // navigation is engaged. Writing the prompt via process.stdout.write +
      // rl.resume() instead leaves readline in passive line-emitting mode and
      // breaks Up/Down command recall across sessions.
      rl.setPrompt(prompt);
      rl.prompt();
    });
  }

  async function initializeSessionState(loaded: {
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
    const sysPrompt = await getSystemPromptWithMemory();
    messages.push({ role: 'system', content: sysPrompt });

    if (loaded.turns.length > 0) {
      const userOrAssistantTurns = loaded.turns.filter(t => t.role !== 'system');
      messages.push(...userOrAssistantTurns);
    }

    setSessionTodos(loaded.sessionId, loaded.todos);

    console.log(pc.gray(`Active files in context: ${activeFiles.size}`));
    console.log(pc.gray(`Loaded ${loaded.turns.length} message turn(s)`));
  }

  let isFirstTurn = true;
  let syntheticInput: string | null = null;

  async function chatLoop(): Promise<void> {
    try {
      if (isFirstTurn && process.stdin.isTTY) {
        isFirstTurn = false;
        try {
          const { getRandomPromptHint } = await import('./prompt-hints.js');
          console.log(`\n  ${getRandomPromptHint(projectStackTags)}`);
        } catch {
          // ignore if hint module unavailable
        }
      }

      while (true) {
        if (pendingNotifications.length > 0) {
          console.log();
          while (pendingNotifications.length > 0) {
            console.log(warn(pendingNotifications.shift()!));
          }
        }
        let prompt = `\n${brand('  ›')} `;
        if (activeFiles.size > 0 || (config.ui.showTokens && messages.length > 1)) {
          const fileStr = activeFiles.size > 0 ? `${activeFiles.size} file${activeFiles.size > 1 ? 's' : ''}` : '';
          let tokenStr = '';
          if (config.ui.showTokens) {
            const tokens = calculateSessionTokens(messages, buildFileContext());
            const total = tokens.total;
            tokenStr = total >= 1000 ? `${(total / 1000).toFixed(1)}kt` : `${total}t`;
          }
          const separator = fileStr && tokenStr ? ' · ' : '';
          prompt += dim(`[${fileStr}${separator}${tokenStr}] `);
        }
        prompt += `${pc.bold(pc.white('›'))} `;
        // autoApprovePlans: when a synthetic "Yes" was queued (the assistant asked
        // to proceed with a plan), consume it instead of blocking on stdin — this is
        // what makes headless/CI runs complete without stalling on an approval prompt.
        let trimmedInput: string;
        if (syntheticInput !== null) {
          trimmedInput = syntheticInput;
          syntheticInput = null;
          console.log(pc.gray(`  [AUTO-APPROVE] Plan approved (autoApprovePlans) — proceeding.`));
        } else {
          const input = await readMultiLineInput(prompt);
          trimmedInput = input.trim();
        }
        if (!trimmedInput) continue;
        appendHistory(trimmedInput);

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
        let activePrompt = trimmedInput;
        const agentTag = parseAgentTag(trimmedInput);
        if (agentTag) {
          toolContext.agentRole = agentTag.role;
          activePrompt = agentTag.cleanInput;
          console.log(info(`\n  [AGENT] Targeted role: ${pc.bold(agentTag.role)}`));
        } else {
          toolContext.agentRole = config.agents?.default || 'coder';
        }
        const allowTestsRe = /\b(test|tests|vitest|jest|spec|specs|assert|assertion|unit\s*test|integration\s*test|update\s*test|fix\s*test|add\s*test)\b/i;
        toolContext.allowTestEdits = allowTestsRe.test(activePrompt);

        try {
          const filesContext = buildFileContext();
          const indexCtx = await buildIndexContext(activePrompt);
          const todoCtx = buildTodoContext(sessionId);
          const userContent = `${indexCtx}${todoCtx}${filesContext}User Prompt: ${activePrompt}`;
          printUserTurn(activePrompt);
          // BETA: rebuild system prompt with the current request so matched
          // skill playbooks are injected for this turn (load-only).
          if (messages.length > 0 && messages[0].role === 'system') {
            messages[0] = { role: 'system', content: await getSystemPromptWithMemory(activePrompt) };
          }
          await callModelWithTools(userContent);

          // autoApprovePlans: if the assistant just proposed a plan and asked for
          // approval, queue a synthetic "Yes" so the next loop iteration proceeds
          // without waiting for stdin. Headless/CI runs complete autonomously.
          if (config.safety?.autoApprovePlans) {
            const lastAssistant = messages.filter(m => m.role === 'assistant').pop()?.content;
            const lastText = typeof lastAssistant === 'string' ? lastAssistant : JSON.stringify(lastAssistant ?? '');
            if (/Would you like me to proceed with this plan\?|proceed with (the|this) plan/i.test(lastText)) {
              syntheticInput = 'Yes';
            }
          }

          sessionManager.saveSessionState(messages, activeFiles, getSessionTodos(sessionId));
          await extractAndSave(router, sessionManager, messages);

          // Mythic Engine: Background memory consolidation and skill synthesis
          try {
            if (sessionManager.projectMemDb) {
              SigmaMemEngine.consolidateAndPruneMemories(sessionManager.projectMemDb);
            }
            const rawContent = messages.filter(m => m.role === 'assistant').pop()?.content || '';
            const summaryStr = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
            const synth = synthesizeSkillFromTurn(activePrompt, summaryStr);
            if (synth.synthesized && synth.name) {
              console.log(info(`\n  [SKILL SYNTHESIZED] Draft playbook "${synth.name}" saved to ~/.daedalus/skills/.drafts/ — review with /skills`));
            }
          } catch { /* background housekeeping silent */ }
        } catch {
          try {
            const filesContext = buildFileContext();
            const todoCtx = buildTodoContext(sessionId);
            const userContent = `${todoCtx}${filesContext}User Prompt: ${activePrompt}`;
            console.log(dim('\n  [RETRY] Trying fallback mode...'));
            const fallbackResult = await callModelWithFallback(userContent);
            if (fallbackResult) {
              sessionManager.saveSessionState(messages, activeFiles, getSessionTodos(sessionId));
              await extractAndSave(router, sessionManager, messages);
            }
          } catch (fallbackErr) {
            const firstLine = ((fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)) || '').split('\n')[0];
            console.log(err(`\n  ${pc.bold('[ERROR]')} Fallback also failed: ${firstLine}`));
            console.log(dim('         Check that at least one local server is running or run /doctor to debug.'));
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
