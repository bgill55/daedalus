import fs from 'fs';
import path from 'path';
import readline from 'readline';
import pc from 'picocolors';
import { BUILTIN_TOOLS, POWER_TOOLS } from './tools/definitions.js';
import { searchSymbols as ftsSearch } from './indexing/fts.js';
import { getSessionTodos, setSessionTodos } from './tools/builtin/todo.js';
import { calculateSessionTokens, pruneMessages } from './session/tokens.js';
import { saveProfile } from './profile.js';
import { runOnboarding } from './onboarding/wizard.js';
import { extractAndSave } from './extraction.js';
import { printUserTurn, turnSeparator } from './formatting.js';
import { getClipboardText, getClipboardImage } from './clipboard.js';
import type { ToolContext, ToolCall, ChatMessage } from './types.js';
import type { LocalRouter } from './router/index.js';
import type { SessionManager } from './session/manager.js';
import type { SqliteTodo } from './session/sqlite.js';
import type { UserProfile } from './profile.js';

export interface ReplDeps {
  config: any;
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
  handleSpawn: (role: string, task: string) => Promise<void>;
  handleOrchestrate: (goal: string) => Promise<void>;
  handleModels: () => Promise<void>;
  handleConfig: () => void;
  handleDoctor: () => Promise<void>;
  handleIndex: (opts: { exclude?: string[]; extensions?: string[] }) => Promise<void>;
  handleFindSymbol: (query: string, limit: number) => Promise<void>;
  handleGetReferences: (symbol: string) => Promise<void>;
  handleGetDefinition: (symbol: string) => Promise<void>;
  getIndexDbPath: () => string;
}

export function createRepl(deps: ReplDeps): () => Promise<void> {
  const {
    config, configDir, cliTempDir, router, sessionManager, userProfile, projectHash,
    messages, activeFiles, toolContext,
    getSystemPromptWithMemory,
    callModelWithTools, callModelWithFallback,
    handleSpawn, handleOrchestrate, handleModels, handleConfig, handleDoctor,
    handleIndex, handleFindSymbol, handleGetReferences, handleGetDefinition, getIndexDbPath,
  } = deps;

  let sessionId = sessionManager.sessionId;

  const COMMANDS = [
    '/add', '/remove', '/context', '/clear',
    '/spawn', '/delegate', '/orchestrate',
    '/memory', '/fact', '/convention',
    '/extract',
    '/profile', '/style',
    '/index', '/find', '/refs', '/def',
    '/commit', '/undo', '/test', '/paste',
    '/models', '/tools', '/config', '/project', '/doctor', '/session', '/onboard',
    '/help', 'exit', 'quit', '?', '/prune', '/branch', '/pr', '/debug', '/ensemble',
  ];

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
    while (true) {
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

      const lowerInput = trimmedInput.toLowerCase();

      if (lowerInput === 'exit' || lowerInput === 'quit') {
        const todos = getSessionTodos(sessionId);
        sessionManager.saveSessionState(messages, activeFiles, todos);
        console.log(pc.dim('  [EXTRACT] Extracting facts from session...'));
        await extractAndSave(router, sessionManager, messages);
        console.log(pc.gray(`Session saved: ${sessionManager.sessionId}`));
        console.log(pc.yellow('\nEnding session. Goodbye!\n'));
        rl.close();
        process.exit(0);
      }

      if (lowerInput === '?' || lowerInput === 'help' || lowerInput === '/help') {
        console.log(`\n  ${pc.bold('Commands')}`);
        console.log(`  ${pc.dim('────────────────────────────────────')}`);
        console.log(`  ${pc.cyan('/add')}      Add file to context`);
        console.log(`  ${pc.cyan('/remove')}   Remove file from context`);
        console.log(`  ${pc.cyan('/context')}  Show active file context`);
        console.log(`  ${pc.cyan('/prune')}    Prune old conversation history & save budget`);
        console.log(`  ${pc.cyan('/commit')}   Stage and commit changes`);
        console.log(`  ${pc.cyan('/branch')}   View or create Git branches`);
        console.log(`  ${pc.cyan('/pr')}       Generate Pull Request description`);
        console.log(`  ${pc.cyan('/undo')}     Undo last file patch`);
        console.log(`  ${pc.cyan('/paste')}   Paste clipboard text/image as message`);
        console.log(`  ${pc.cyan('/test')}     Run tests and auto-fix failures`);
        console.log(`  ${pc.cyan('/debug')}    Run a command and autonomously fix failures`);
        console.log(`  ${pc.cyan('/ensemble')} Run multi-model ensemble drafting pipeline`);
        console.log(`  ${pc.cyan('/index')}    Index codebase for symbol search`);
        console.log(`  ${pc.cyan('/find')}     Search indexed symbols`);
        console.log(`  ${pc.cyan('/refs')}    Find symbol references`);
        console.log(`  ${pc.cyan('/def')}     Get symbol definition`);
        console.log(`  ${pc.cyan('/project')} View or set project config`);
        console.log(`  ${pc.cyan('/extract')}  Manually extract facts from session`);
        console.log(`  ${pc.cyan('/profile')} View or set your user profile`);
        console.log(`  ${pc.cyan('/style')}   Set your coding style/preferences`);
        console.log(`  ${pc.cyan('/session')} Manage chat sessions`);
        console.log(`  ${pc.cyan('?')}         Show this help menu`);
        console.log(`  ${pc.cyan('exit')}     Save and quit\n`);
        continue;
      }

      if (lowerInput === '/add' || lowerInput.startsWith('/add ')) {
        const fileArg = trimmedInput.substring(4).trim();
        if (!fileArg) {
          const { runInteractiveFileSelector } = await import('./session/selector.js');
          rl.pause();
          const result = await runInteractiveFileSelector(process.cwd(), config.indexing.exclude, new Set(activeFiles.keys()));
          rl.resume();
          if (result !== null) {
            activeFiles.clear();
            for (const absPath of result) {
              const rel = path.relative(process.cwd(), absPath);
              activeFiles.set(absPath, rel);
            }
            toolContext.activeFiles = new Map(activeFiles);
            console.log(pc.green(`\n[OK] Active context files updated: ${activeFiles.size} file(s)`));
          }
        } else {
          const absPath = path.resolve(fileArg);
          activeFiles.set(absPath, fileArg);
          toolContext.activeFiles = new Map(activeFiles);
          console.log(pc.green(`[OK] Added file to context: ${pc.bold(fileArg)}`));
        }
        continue;
      }

      if (trimmedInput.startsWith('/remove ')) {
        const fileArg = trimmedInput.substring(8).trim();
        if (!fileArg) {
          console.log(pc.red('[WARN] Please specify a file path. Example: /remove src/App.tsx'));
        } else {
          const absPath = path.resolve(fileArg);
          if (activeFiles.delete(absPath)) {
            toolContext.activeFiles = new Map(activeFiles);
            console.log(pc.green(`[OK] Removed file from context: ${pc.bold(fileArg)}`));
          } else {
            console.log(pc.yellow(`[WARN] File was not in context: ${fileArg}`));
          }
        }
        continue;
      }

      if (lowerInput === '/paste' || lowerInput.startsWith('/paste ')) {
        const extra = trimmedInput.startsWith('/paste ') ? trimmedInput.substring(7).trim() : '';

        if (extra && !extra.startsWith('http')) {
          const filePath = path.resolve(extra);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
              const imgBuffer = fs.readFileSync(filePath);
              const base64 = imgBuffer.toString('base64');
              const message = 'What do you see in this image?';
              printUserTurn(`${path.basename(filePath)} (image)`);
              try {
                const filesContext = buildFileContext();
                const indexCtx = await buildIndexContext(message);
                const userContent = `${indexCtx}${filesContext}User Prompt: ${message}`;
                await callModelWithTools(userContent, base64);
                sessionManager.saveSessionState(messages, activeFiles, getSessionTodos(sessionId));
              } catch (error: any) {
                try {
                  const filesContext = buildFileContext();
                  const userContent = `${filesContext}User Prompt: ${message}`;
                  console.log(pc.yellow('\n  [RETRY] Trying fallback mode...'));
                  await callModelWithFallback(userContent, base64);
                  sessionManager.saveSessionState(messages, activeFiles, getSessionTodos(sessionId));
                } catch (fallbackErr: any) {
                  const firstLine = (fallbackErr.message || '').split('\n')[0];
                  console.log(pc.red(`\n  ${pc.bold('[ERROR]')} Fallback also failed: ${firstLine}`));
                }
              }
              turnSeparator();
              continue;
            }
          }
        }

        const imgPath = getClipboardImage(cliTempDir);
        if (imgPath) {
          const imgBuffer = fs.readFileSync(imgPath);
          fs.unlinkSync(imgPath);
          const base64 = imgBuffer.toString('base64');
          const message = extra || 'What do you see in this image?';
          printUserTurn(`${message} (image)`);
          try {
            const filesContext = buildFileContext();
            const indexCtx = await buildIndexContext(message);
            const userContent = `${indexCtx}${filesContext}User Prompt: ${message}`;
            await callModelWithTools(userContent, base64);
            sessionManager.saveSessionState(messages, activeFiles, getSessionTodos(sessionId));
          } catch (error: any) {
            try {
              const filesContext = buildFileContext();
              const userContent = `${filesContext}User Prompt: ${message}`;
              console.log(pc.yellow('\n  [RETRY] Trying fallback mode...'));
              await callModelWithFallback(userContent, base64);
              sessionManager.saveSessionState(messages, activeFiles, getSessionTodos(sessionId));
            } catch (fallbackErr: any) {
              const firstLine = (fallbackErr.message || '').split('\n')[0];
              console.log(pc.red(`\n  ${pc.bold('[ERROR]')} Fallback also failed: ${firstLine}`));
            }
          }
          turnSeparator();
          continue;
        }

        const clipboard = getClipboardText();
        if (!clipboard) {
          console.log(pc.red('[WARN] Clipboard is empty or inaccessible.'));
          continue;
        }
        const fullMessage = extra ? `${clipboard}\n\n${extra}` : clipboard;
        printUserTurn(fullMessage);
        try {
          const filesContext = buildFileContext();
          const indexCtx = await buildIndexContext(fullMessage);
          const userContent = `${indexCtx}${filesContext}User Prompt: ${fullMessage}`;
          await callModelWithTools(userContent);
          sessionManager.saveSessionState(messages, activeFiles, getSessionTodos(sessionId));
        } catch (error: any) {
        }
        turnSeparator();
        continue;
      }

      if (lowerInput === '/context') {
        console.log(pc.bold('\n--- Monitored Files in Context ---'));
        if (activeFiles.size === 0) {
          console.log(pc.gray('  (No active files. Use "/add <filepath>" to add files)'));
        } else {
          activeFiles.forEach((filename) => {
            console.log(`  • ${pc.cyan(filename)}`);
          });
        }
        console.log(pc.bold('----------------------------------'));
        continue;
      }

      if (lowerInput.startsWith('/prune')) {
        const parts = trimmedInput.substring(6).trim().split(/\s+/);
        const arg = parts[0]?.trim();
        const maxT = config.context.maxTokens ?? 128000;
        let target = Math.floor(maxT * 0.5);

        if (arg) {
          if (arg.endsWith('%')) {
            const pct = parseFloat(arg.slice(0, -1)) / 100;
            if (!isNaN(pct) && pct > 0 && pct <= 1) {
              target = Math.floor(maxT * pct);
            }
          } else {
            const num = parseInt(arg, 10);
            if (!isNaN(num) && num > 0) {
              target = num;
            }
          }
        }

        const fileCtx = buildFileContext();
        const beforeTokens = calculateSessionTokens(messages, fileCtx);

        console.log(pc.bold('\n--- Context Budget Status ---'));
        console.log(`  System Prompt:       ${(beforeTokens.system / 1000).toFixed(1)}kt`);
        console.log(`  Message History:     ${(beforeTokens.history / 1000).toFixed(1)}kt`);
        console.log(`  Active Files:        ${(beforeTokens.activeFiles / 1000).toFixed(1)}kt`);
        console.log(`  Total Active:        ${(beforeTokens.total / 1000).toFixed(1)}kt / ${(maxT / 1000).toFixed(0)}kt (${Math.round((beforeTokens.total / maxT) * 100)}%)`);
        console.log(`  Target Limit:        ${(target / 1000).toFixed(1)}kt`);
        console.log(pc.bold('-----------------------------'));
        const pruneResult = pruneMessages(messages, fileCtx, target);
        if (pruneResult.prunedTurns > 0 || pruneResult.truncatedTools > 0) {
          console.log(pc.green(`\n[OK] Pruned ${pruneResult.prunedTurns} older turns and truncated ${pruneResult.truncatedTools} large tool outputs.`));
          console.log(pc.green(`Reclaimed ~${Math.round(pruneResult.savedTokens / 1000)}kt.`));
        } else {
          console.log(pc.gray('\nContext is already within target budget. No pruning needed.'));
        }
        continue;
      }

      if (lowerInput.startsWith('/session')) {
        const parts = trimmedInput.substring(9).trim().split(/\s+/);
        const subCmd = parts[0]?.toLowerCase();

        if (subCmd === 'list') {
          const list = sessionManager.getSessionsForProject();
          console.log(pc.bold('\n--- Sessions for this Project ---'));
          if (list.length === 0) {
            console.log(pc.gray('  No saved sessions.'));
          } else {
            list.forEach((s) => {
              const dateStr = new Date(s.updated_at).toLocaleString();
              const activeMarker = s.id === sessionManager.sessionId ? pc.green(' * ') : '   ';
              console.log(`${activeMarker}${s.title} (ID: ${pc.cyan(s.id)}) - Last updated: ${dateStr}`);
            });
          }
          console.log(pc.bold('---------------------------------'));
        } else if (subCmd === 'load') {
          const targetId = parts[1]?.trim();
          if (!targetId) {
            console.log(pc.red('[WARN] Usage: /session load <id>'));
          } else {
            try {
              const todos = getSessionTodos(sessionId);
              sessionManager.saveSessionState(messages, activeFiles, todos);
              const loaded = sessionManager.startSession(targetId);
              initializeSessionState(loaded);
              console.log(pc.green(`[OK] Loaded session: ${sessionManager.sessionTitle} (${sessionManager.sessionId})`));
            } catch (err: any) {
              console.log(pc.red(`[WARN] Failed to load session: ${err.message}`));
            }
          }
        } else if (subCmd === 'new') {
          const title = parts.slice(1).join(' ').trim();
          const todos = getSessionTodos(sessionId);
          sessionManager.saveSessionState(messages, activeFiles, todos);
          const loaded = sessionManager.startSession(undefined, title || undefined);
          initializeSessionState(loaded);
          console.log(pc.green(`[OK] Started new session: ${sessionManager.sessionTitle} (${sessionManager.sessionId})`));
        } else if (subCmd === 'delete') {
          const targetId = parts[1]?.trim();
          if (!targetId) {
            console.log(pc.red('[WARN] Usage: /session delete <id>'));
          } else {
            sessionManager.deleteSession(targetId);
            console.log(pc.green(`[OK] Deleted session: ${targetId}`));
          }
        } else {
          console.log(pc.red('[WARN] Usage: /session list | load <id> | new [title] | delete <id>'));
        }
        continue;
      }

      if (lowerInput === '/memory') {
        const mem = sessionManager.loadMemory();
        console.log(pc.bold('\n--- Project Facts & Conventions (Memory) ---'));
        console.log(pc.bold('Conventions:'));
        if (Object.keys(mem.conventions).length === 0) {
          console.log(pc.gray('  No conventions saved.'));
        } else {
          for (const [k, v] of Object.entries(mem.conventions)) {
            console.log(`  • ${pc.cyan(k)}: ${v}`);
          }
        }
        console.log(pc.bold('\nFacts:'));
        if (mem.facts.length === 0) {
          console.log(pc.gray('  No facts saved.'));
        } else {
          mem.facts.forEach(f => {
            console.log(`  • ${pc.cyan(f.key)}: ${f.value} (source: ${f.source})`);
          });
        }
        console.log(pc.bold('------------------------------------------'));
        continue;
      }

      if (lowerInput.startsWith('/fact ')) {
        const argStr = trimmedInput.substring(6).trim();
        const eqIdx = argStr.indexOf('=');
        if (eqIdx < 0) {
          console.log(pc.red('[WARN] Usage: /fact <key> = <value>'));
        } else {
          const key = argStr.slice(0, eqIdx).trim();
          const value = argStr.slice(eqIdx + 1).trim();
          sessionManager.addFact(key, value, 'user');
          console.log(pc.green(`[OK] Saved fact: ${key} = ${value}`));
        }
        continue;
      }

      if (lowerInput.startsWith('/convention ')) {
        const argStr = trimmedInput.substring(12).trim();
        const eqIdx = argStr.indexOf('=');
        if (eqIdx < 0) {
          console.log(pc.red('[WARN] Usage: /convention <key> = <value>'));
        } else {
          const key = argStr.slice(0, eqIdx).trim();
          const value = argStr.slice(eqIdx + 1).trim();
          sessionManager.setConvention(key, value);
          console.log(pc.green(`[OK] Saved convention: ${key} = ${value}`));
        }
        continue;
      }

      if (lowerInput === '/extract') {
        console.log(pc.dim('  [EXTRACT] Extracting facts from conversation...'));
        await extractAndSave(router, sessionManager, messages);
        continue;
      }

      if (lowerInput.startsWith('/profile')) {
        const rest = trimmedInput.substring(8).trim();
        if (!rest || rest === 'view') {
          console.log(pc.bold('\n--- Your Profile ---'));
          console.log(`  ${pc.cyan('Name')}: ${userProfile.name || '(not set)'}`);
          console.log(`  ${pc.cyan('Bio')}:  ${userProfile.bio || '(not set)'}`);
          if (userProfile.updatedAt) {
            console.log(pc.gray(`  Last updated: ${new Date(userProfile.updatedAt).toLocaleString()}`));
          }
          console.log(pc.dim('  Set name: /profile name = Your Name'));
          console.log(pc.dim('  Set bio:  /profile bio = Tell me about yourself'));
          continue;
        }
        if (rest.startsWith('name ')) {
          userProfile.name = rest.substring(5).trim();
          saveProfile(userProfile);
          console.log(pc.green(`[OK] Profile name set: ${userProfile.name}`));
          continue;
        }
        if (rest.startsWith('bio ')) {
          userProfile.bio = rest.substring(4).trim();
          saveProfile(userProfile);
          console.log(pc.green('[OK] Profile bio set.'));
          continue;
        }
        console.log(pc.red('[WARN] Usage: /profile view | /profile name = <name> | /profile bio = <bio>'));
        continue;
      }

      if (lowerInput.startsWith('/style')) {
        const rest = trimmedInput.substring(6).trim();
        if (!rest || rest === 'view') {
          console.log(pc.bold('\n--- Coding Style ---'));
          console.log(`  ${userProfile.style || '(not set)'}`);
          console.log(pc.dim('  Set: /style <your coding preferences>'));
          console.log(pc.dim('  Example: /style I prefer tabs, functional style, descriptive variable names'));
          continue;
        }
        userProfile.style = rest;
        saveProfile(userProfile);
        console.log(pc.green('[OK] Coding style saved. It will be injected into every session.'));
        continue;
      }

      if (lowerInput === '/clear') {
        messages.length = 0;
        messages.push({ role: 'system', content: getSystemPromptWithMemory() });
        console.log(pc.green('[OK] Conversation history cleared!'));
        continue;
      }

      if (lowerInput === '/tools') {
        console.log(pc.bold('\n--- Available Tools ---'));
        BUILTIN_TOOLS.forEach(t => {
          console.log(`  • ${pc.cyan(t.function.name)}: ${t.function.description}`);
        });
        const mcpTools: import('./tools/definitions.js').ToolDefinition[] = [];
        if (mcpTools.length > 0) {
          console.log(pc.bold('\n--- MCP Tools ---'));
          mcpTools.forEach(t => {
            console.log(`  • ${pc.cyan(t.function.name)}: ${t.function.description}`);
          });
        }
        console.log(pc.bold('-----------------------'));
        continue;
      }

      if (lowerInput.startsWith('/spawn ')) {
        const parts = trimmedInput.substring(7).trim().split(' ');
        if (parts.length < 2) {
          console.log(pc.red('[WARN] Usage: /spawn <role> <task>'));
          console.log(pc.gray('  Roles: coder, reviewer, debugger, researcher, planner'));
        } else {
          const role = parts[0].toLowerCase();
          const task = parts.slice(1).join(' ');
          await handleSpawn(role, task);
        }
        continue;
      }

      if (lowerInput.startsWith('/delegate ')) {
        const match = trimmedInput.substring(10).match(/^(.+)\s+to\s+(\w+)$/i);
        if (!match) {
          console.log(pc.red('[WARN] Usage: /delegate <task> to <role>'));
        } else {
          const task = match[1].trim();
          const role = match[2].toLowerCase();
          await handleSpawn(role, task);
        }
        continue;
      }

      if (lowerInput.startsWith('/orchestrate ')) {
        const goal = trimmedInput.substring(13).trim();
        if (!goal) {
          console.log(pc.red('[WARN] Usage: /orchestrate <goal>'));
        } else {
          await handleOrchestrate(goal);
        }
        continue;
      }

      if (lowerInput === '/models') {
        await handleModels();
        continue;
      }

      if (lowerInput === '/config') {
        handleConfig();
        continue;
      }

      if (lowerInput === '/doctor') {
        await handleDoctor();
        continue;
      }

      if (lowerInput === '/onboard') {
        console.log(pc.cyan('\n[RESTART] Re-running onboarding wizard...\n'));
        await runOnboarding(true);
        continue;
      }

      if (lowerInput === '/undo') {
        const history = toolContext.patchHistory;
        if (!history || history.length === 0) {
          console.log(pc.yellow('[WARN] No patches to undo.'));
        } else {
          const last = history[history.length - 1];
          try {
            const currentContent = fs.readFileSync(last.filePath, 'utf8');
            if (currentContent === last.newContent) {
              fs.writeFileSync(last.filePath, last.oldContent, 'utf8');
              console.log(pc.green(`[OK] Undid patch to ${last.filePath} (${last.description})`));
            } else {
              console.log(pc.yellow(`[WARN] File ${last.filePath} has been modified since last patch. Cannot auto-undo.`));
            }
            history.pop();
          } catch (err: any) {
            console.log(pc.red(`[WARN] Failed to undo: ${err.message}`));
          }
        }
        continue;
      }

      if (lowerInput === '/branch' || lowerInput.startsWith('/branch ')) {
        try {
          const { execute: termExec } = await import('./tools/builtin/terminal.js');
          const arg = trimmedInput.substring(7).trim();
          if (!arg) {
            const currentBranchResult = await termExec({ command: 'git branch --show-current', timeout: 5, workdir: process.cwd() }, toolContext);
            const current = currentBranchResult.content?.trim();
            if (current) {
              console.log(`\n  ${pc.cyan('Current Git branch:')} ${pc.bold(current)}`);
            } else {
              console.log(pc.red('\n  Not in a Git repository or no branch found.'));
            }
          } else {
            console.log(`\n  Creating and switching to branch ${pc.cyan(arg)}...`);
            const checkoutResult = await termExec({ command: `git checkout -b ${arg}`, timeout: 10, workdir: process.cwd() }, toolContext);
            if (checkoutResult.success) {
              console.log(pc.green(`  [OK] Switched to a new branch '${arg}'`));
            } else {
              console.log(pc.yellow(`  Branch might already exist, attempting to switch...`));
              const switchResult = await termExec({ command: `git checkout ${arg}`, timeout: 10, workdir: process.cwd() }, toolContext);
              if (switchResult.success) {
                console.log(pc.green(`  [OK] Switched to branch '${arg}'`));
              } else {
                console.log(pc.red(`  Switch failed: ${switchResult.error || switchResult.content}`));
              }
            }
          }
        } catch (err: any) {
          console.log(pc.red(`[WARN] Branch command error: ${err.message}`));
        }
        continue;
      }

      if (lowerInput === '/pr' || lowerInput.startsWith('/pr ')) {
        const arg = trimmedInput.substring(3).trim();
        try {
          const { execute: termExec } = await import('./tools/builtin/terminal.js');

          const gitCheck = await termExec({ command: 'git rev-parse --is-inside-work-tree', timeout: 5, workdir: process.cwd() }, toolContext);
          if (!gitCheck.success) {
            console.log(pc.red('  Error: Not inside a Git repository.'));
            continue;
          }

          let baseBranch = arg || 'main';
          if (!arg) {
            const mainCheck = await termExec({ command: 'git show-ref --verify refs/heads/main', timeout: 5, workdir: process.cwd() }, toolContext);
            if (!mainCheck.success) {
              const masterCheck = await termExec({ command: 'git show-ref --verify refs/heads/master', timeout: 5, workdir: process.cwd() }, toolContext);
              if (masterCheck.success) {
                baseBranch = 'master';
              }
            }
          }

          const currentBranchResult = await termExec({ command: 'git branch --show-current', timeout: 5, workdir: process.cwd() }, toolContext);
          const currentBranch = currentBranchResult.content?.trim();

          console.log(`\n  Comparing ${pc.cyan(currentBranch || 'HEAD')} with base branch ${pc.cyan(baseBranch)}...`);

          const commitsResult = await termExec({ command: `git log ${baseBranch}..HEAD --oneline`, timeout: 10, workdir: process.cwd() }, toolContext);
          const commitList = commitsResult.content?.trim() || '';

          const diffResult = await termExec({ command: `git diff ${baseBranch}...HEAD`, timeout: 15, workdir: process.cwd() }, toolContext);
          const diffContent = diffResult.content?.slice(0, 15000) || '';

          if (!commitList && !diffContent) {
            console.log(pc.yellow(`  No commits or diff found between ${currentBranch} and ${baseBranch}.`));
            continue;
          }

          console.log(pc.dim('  Analyzing changes and generating PR description...'));

          const aiResponse = await router.chat.completions.create({
            model: 'auto',
            messages: [
              {
                role: 'system',
                content: 'You write clean, comprehensive, professional Pull Request descriptions in Markdown format. Output ONLY the markdown content — no extra chat, wrapper, or quotes.'
              },
              {
                role: 'user',
                content: `Generate a Pull Request description for the current branch compared to ${baseBranch}.\n\nCommits:\n${commitList}\n\nDiff:\n${diffContent}`
              }
            ],
            temperature: 0.3,
          });

          const prDesc = (aiResponse.choices[0]?.message?.content || '').trim();
          if (!prDesc) {
            console.log(pc.red('  Failed to generate PR description.'));
            continue;
          }

          console.log(pc.bold('\n--- Generated PR Description ---'));
          console.log(prDesc);
          console.log(pc.bold('--------------------------------'));

          const outPath = path.join(process.cwd(), 'pr-desc.md');
          fs.writeFileSync(outPath, prDesc, 'utf8');
          console.log(pc.green(`\n[OK] PR description saved to ${pc.cyan('pr-desc.md')}`));

        } catch (err: any) {
          console.log(pc.red(`[WARN] PR command error: ${err.message}`));
        }
        continue;
      }

      if (lowerInput.startsWith('/debug ')) {
        const debugCmd = trimmedInput.substring(7).trim();
        if (!debugCmd) {
          console.log(pc.red('  Error: Please specify a command to run. Example: /debug npm test'));
          continue;
        }

        console.log(`\n  ${pc.cyan('Starting autonomous debugging loop for:')} ${pc.bold(debugCmd)}`);

        const MAX_RETRIES = 5;
        let attempt = 1;
        let success = false;

        while (attempt <= MAX_RETRIES) {
          console.log(`\n  ${pc.yellow(`[Attempt ${attempt}/${MAX_RETRIES}]`)} Running: ${pc.bold(debugCmd)}...`);

          try {
            const { execute: termExec } = await import('./tools/builtin/terminal.js');
            const execResult = await termExec({ command: debugCmd, timeout: 60, workdir: process.cwd() }, toolContext);

            if (execResult.success) {
              console.log(pc.green(`\n  ${pc.green('✔')} ${pc.bold(`Success on attempt ${attempt}!`)} Command passed with exit code 0.`));
              success = true;
              break;
            }

            console.log(pc.red(`\n  ${pc.red('✗')} ${pc.bold(`Command failed on attempt ${attempt}.`)}`));

            const stdout = execResult.content || '';
            const errorMsg = execResult.error || '';
            const logs = `${stdout}\n${errorMsg}`.trim();

            console.log(pc.bold('\n--- Failure Logs ---'));
            const logLines = logs.split('\n');
            const preview = logLines.length > 20 ? logLines.slice(-20).join('\n') : logs;
            console.log(preview);
            if (logLines.length > 20) {
              console.log(pc.dim(`\n  (... truncated ${logLines.length - 20} lines of logs ...)`));
            }
            console.log(pc.bold('--------------------'));

            if (attempt === MAX_RETRIES) {
              console.log(pc.red(`\n  Reached maximum attempt limit of ${MAX_RETRIES}. Debugging loop failed.`));
              break;
            }

            console.log(pc.dim('\n  Calling Daedalus to analyze failure and apply a fix...'));

            const debugPrompt = `The command "${debugCmd}" failed on attempt ${attempt}.
Here are the execution logs (showing the failure details):

${logs.slice(-6000)}

Please analyze the error, identify which files need correction, and apply surgical edits using 'patch' or write tools to fix the issue.
Once you have finished making changes, I will automatically re-run the command to verify if it passes.`;

            await callModelWithTools(debugPrompt);

          } catch (err: any) {
            console.log(pc.red(`\n  Error in debugging loop: ${err.message}`));
            break;
          }

          attempt++;
        }

        if (!success) {
          console.log(pc.red(`\n  Autonomous debugging did not succeed after ${MAX_RETRIES} attempts.`));
        }
        turnSeparator();
        continue;
      }

      if (lowerInput.startsWith('/ensemble ') || lowerInput === '/ensemble') {
        const ensembleGoal = trimmedInput.substring(9).trim();
        if (!ensembleGoal) {
          console.log(pc.red('  Error: Please specify a goal for the ensemble draft. Example: /ensemble Implement feature X'));
          continue;
        }

        try {
          const { runEnsembleWorkflow } = await import('./agents/ensemble.js');
          await runEnsembleWorkflow(ensembleGoal, toolContext, config, router);
        } catch (err: any) {
          console.log(pc.red(`\n  Error in ensemble drafting: ${err.message}`));
        }
        turnSeparator();
        continue;
      }

      if (lowerInput === '/commit' || lowerInput.startsWith('/commit ')) {
        const forcedMsg = trimmedInput.startsWith('/commit ') ? trimmedInput.substring(8).trim() : '';
        try {
          const { execute: termExec } = await import('./tools/builtin/terminal.js');
          const statusResult = await termExec({ command: 'git status --short', timeout: 10, workdir: process.cwd() }, toolContext);
          console.log(pc.bold('\n--- Git Status ---'));
          console.log(statusResult.content || pc.gray('(clean)'));
          if (!statusResult.content?.trim()) {
            console.log(pc.yellow('Nothing to commit.'));
            continue;
          }
          const addResult = await termExec({ command: 'git add -A', timeout: 10, workdir: process.cwd() }, toolContext);
          if (!addResult.success) {
            console.log(pc.red(`Stage failed: ${addResult.error}`));
            continue;
          }
          let commitMsg = forcedMsg;
          if (!commitMsg) {
            const diffResult = await termExec({ command: 'git diff --cached --stat', timeout: 10, workdir: process.cwd() }, toolContext);
            const diffFull = await termExec({ command: 'git diff --cached', timeout: 10, workdir: process.cwd() }, toolContext);
            const diffContent = diffFull.content?.slice(0, 6000) || '';
            if (diffResult.content) console.log(pc.gray(diffResult.content));

            if (diffContent) {
              console.log(pc.dim('  Generating commit message...'));
              try {
                const aiResponse = await router.chat.completions.create({
                  model: 'auto',
                  messages: [
                    { role: 'system', content: 'You write concise git commit messages following the Conventional Commits spec (type(scope): description). Output only the commit message — no explanation, no quotes, no extra text.' },
                    { role: 'user', content: `Write a commit message for this diff:\n\n${diffContent}` }
                  ],
                  temperature: 0.2,
                  max_tokens: 80,
                });
                const suggested = ((aiResponse.choices[0]?.message?.content) || '').trim().split('\n')[0].trim();
                if (suggested) {
                  console.log(`\n  ${pc.dim('Suggested:')} ${pc.cyan(suggested)}`);
                  const choice = await askLine(pc.dim('  [Enter] accept  [e] edit  [n] cancel: '));
                  if (choice.trim().toLowerCase() === 'n') {
                    console.log(pc.yellow('Commit cancelled.'));
                    await termExec({ command: 'git restore --staged .', timeout: 10, workdir: process.cwd() }, toolContext);
                    continue;
                  } else if (choice.trim().toLowerCase() === 'e') {
                    commitMsg = await askLine(pc.cyan('  Commit message: '));
                  } else {
                    commitMsg = suggested;
                  }
                }
              } catch {
                // Model unavailable — fall back to manual
              }
            }

            if (!commitMsg) {
              commitMsg = await askLine(pc.cyan('  Commit message: '));
            }
            if (!commitMsg.trim()) {
              console.log(pc.yellow('Commit cancelled — empty message.'));
              await termExec({ command: 'git restore --staged .', timeout: 10, workdir: process.cwd() }, toolContext);
              continue;
            }
          }
          const commitResult = await termExec({ command: `git commit -m ${JSON.stringify(commitMsg)}`, timeout: 10, workdir: process.cwd() }, toolContext);
          if (commitResult.success) {
            console.log(pc.green(`\n[OK] Commit: ${commitMsg.slice(0, 60)}`));
          } else {
            console.log(pc.red(`Commit failed: ${commitResult.error}`));
          }
        } catch (err: any) {
          console.log(pc.red(`[WARN] Commit error: ${err.message}`));
        }
        continue;
      }

      if (lowerInput === '/project') {
        const { loadProjectConfig } = await import('./tools/builtin/project-config.js');
        const cfg = loadProjectConfig(process.cwd());
        console.log(pc.bold('\n--- Project Config (.daedalus) ---'));
        console.log(JSON.stringify(cfg, null, 2));
        console.log(pc.bold('----------------------------------'));
        console.log(pc.gray('Use /project set <key> <value> to update'));
        continue;
      }
      if (lowerInput.startsWith('/project set ')) {
        const rest = trimmedInput.substring(13).trim();
        const eqIdx = rest.indexOf('=');
        let key: string, value: string;
        if (eqIdx >= 0) {
          key = rest.slice(0, eqIdx).trim();
          value = rest.slice(eqIdx + 1).trim();
        } else {
          const parts = rest.split(/\s+/);
          key = parts[0];
          value = parts.slice(1).join(' ');
        }
        if (!key || !value) {
          console.log(pc.red('[WARN] Usage: /project set <key> = <value>'));
        } else {
          const { loadProjectConfig, saveProjectConfig } = await import('./tools/builtin/project-config.js');
          const cfg = loadProjectConfig(process.cwd());
          (cfg as Record<string, any>)[key] = value;
          saveProjectConfig(cfg);
          console.log(pc.green(`[OK] Set ${key} = ${value}`));
        }
        continue;
      }

      if (lowerInput === '/test' || lowerInput.startsWith('/test ')) {
        const maxLoops = lowerInput.startsWith('/test ') ? parseInt(trimmedInput.substring(6).trim(), 10) || 3 : 3;
        const { loadProjectConfig } = await import('./tools/builtin/project-config.js');
        const { execute: termExec } = await import('./tools/builtin/terminal.js');
        const cfg = loadProjectConfig(process.cwd());
        const testCmd = cfg.testCommand || 'npm test';
        console.log(pc.bold(`\nTest-Run-Fix Loop (max ${maxLoops} iterations)`));
        console.log(pc.gray(`Test command: ${testCmd}\n`));
        for (let i = 0; i < maxLoops; i++) {
          console.log(pc.cyan(`\n--- Run ${i + 1}/${maxLoops} ---`));
          const result = await termExec({ command: testCmd, timeout: 120, workdir: process.cwd() }, toolContext);
          console.log(result.content?.slice(0, 2000) || pc.gray('(no output)'));
          if (result.success) {
            console.log(pc.green('\n[OK] All tests passed!'));
            break;
          }
          if (i === maxLoops - 1) {
            console.log(pc.yellow(`\n[WARN] Max loops (${maxLoops}) reached. Tests still failing.`));
            break;
          }
          const failureCtx = `Tests failed (run ${i + 1}/${maxLoops}). Output:\n\n${result.content?.slice(0, 8000) || 'Unknown failure'}\n\nAnalyze the failures and fix the code. Do not re-read files you already have in context.`;
          await callModelWithTools(`User Prompt: ${failureCtx}`);
          sessionManager.saveSessionState(messages, activeFiles, getSessionTodos(sessionId));
        }
        continue;
      }

      if (lowerInput.startsWith('/index')) {
        const args = trimmedInput.substring(6).trim().split(/\s+/);
        const opts: { exclude?: string[]; extensions?: string[] } = {};
        for (const arg of args) {
          if (arg.startsWith('--exclude=')) {
            opts.exclude = arg.split('=')[1].split(',');
          } else if (arg.startsWith('--ext=')) {
            opts.extensions = arg.split('=')[1].split(',');
          }
        }
        await handleIndex(opts);
        continue;
      }

      if (lowerInput.startsWith('/find ')) {
        const parts = trimmedInput.substring(6).trim().split(/\s+/);
        if (parts.length === 0) {
          console.log(pc.red('[WARN] Usage: /find <query> [limit]'));
        } else {
          const query = parts[0];
          const limit = parts[1] ? parseInt(parts[1], 10) : 30;
          if (isNaN(limit)) {
            console.log(pc.red('[WARN] Invalid limit'));
          } else {
            await handleFindSymbol(query, limit);
          }
        }
        continue;
      }

      if (lowerInput.startsWith('/refs ')) {
        const symbol = trimmedInput.substring(6).trim();
        if (!symbol) {
          console.log(pc.red('[WARN] Usage: /refs <symbol>'));
        } else {
          await handleGetReferences(symbol);
        }
        continue;
      }

      if (lowerInput.startsWith('/def ')) {
        const symbol = trimmedInput.substring(5).trim();
        if (!symbol) {
          console.log(pc.red('[WARN] Usage: /def <symbol>'));
        } else {
          await handleGetDefinition(symbol);
        }
        continue;
      }

      // User Message Processing
      try {
        const filesContext = buildFileContext();
        const indexCtx = await buildIndexContext(trimmedInput);
        const userContent = `${indexCtx}${filesContext}User Prompt: ${trimmedInput}`;
        printUserTurn(trimmedInput);
        await callModelWithTools(userContent);

        sessionManager.saveSessionState(messages, activeFiles, getSessionTodos(sessionId));

        await extractAndSave(router, sessionManager, messages);
      } catch (error: any) {
        try {
          const filesContext = buildFileContext();
          const userContent = `${filesContext}User Prompt: ${trimmedInput}`;
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
  }

  function buildFileContext(): string {
    if (activeFiles.size === 0) return '';
    let ctx = '--- ACTIVE FILES CONTEXT ---\n';
    for (const [absPath, filename] of activeFiles) {
      let content = '';
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
        const results = ftsSearch(indexDb, term, projectHash, 3);
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
