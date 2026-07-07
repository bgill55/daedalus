import blessed from 'neo-blessed';
import pc from 'picocolors';
import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';
import type { ReplDeps } from '../repl.js';
import type { ChatMessage } from '../types.js';
import { executeCommand, CommandContext } from '../commands.js';
import { printUserTurn, turnSeparator } from '../formatting.js';
import { extractAndSave } from '../extraction.js';
import { getSessionTodos, setSessionTodos, buildTodoContext } from '../tools/builtin/todo.js';
import { resetTurnAborted } from '../model.js';

import { initMonitor } from './widgets/monitor.js';
import { initModelSelect } from './widgets/model-select.js';
import { initFileTree } from './widgets/file-tree.js';

export function createTuiRepl(deps: ReplDeps): () => Promise<void> {
  const {
    config, configDir, cliTempDir, router, sessionManager, userProfile,
    messages, activeFiles, toolContext,
    getSystemPromptWithMemory,
    callModelWithTools, callModelWithFallback, getIndexDbPath,
  } = deps;

  let sessionId = sessionManager.sessionId;

  // Set TUI active flag
  (globalThis as any).isTui = true;

  // Wrapper so blessed writes bypass the tuiWrite override of process.stdout.write
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  (globalThis as any).originalStdoutWrite = originalStdoutWrite;
  (globalThis as any).originalStderrWrite = originalStderrWrite;
  const customStdout = new Writable({
    write(chunk, encoding, callback) {
      originalStdoutWrite(chunk, encoding);
      callback();
    }
  });
  Object.defineProperties(customStdout, {
    isTTY: { value: true },
    columns: { value: (process.stdout as any).columns || 80 },
    rows: { value: (process.stdout as any).rows || 24 },
  });

  const screen = blessed.screen({
    smartCSR: true,
    title: 'Daedalus TUI',
    fullUnicode: true,
    output: customStdout as any,
    alternate: true,
    mouse: true,
  });

  // Create Log Box (Left Main Console)
  const logBox = blessed.log({
    parent: screen,
    top: 0,
    left: 0,
    width: '80%',
    height: 'shrink',
    bottom: 3,
    border: { type: 'line' },
    style: { border: { fg: 'dim' } },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: ' ',
      style: { bg: 'cyan' }
    },
    mouse: true,
    keys: true,
    ansi: true,
  });

  // Enable mouse wheel scrolling on main console log box
  logBox.on('wheelup', () => {
    logBox.scroll(-3);
    screen.render();
  });

  logBox.on('wheeldown', () => {
    logBox.scroll(3);
    screen.render();
  });

  // Create Input Box (Bottom Left)
  const inputField = blessed.textbox({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '80%',
    height: 3,
    border: { type: 'line' },
    style: {
      border: { fg: 'cyan' },
      focus: { border: { fg: 'green' } }
    },
    inputOnFocus: true,
    keys: true,
    mouse: true,
  });

  // Create Sidebar (Right Column)
  const sidebar = blessed.box({
    parent: screen,
    top: 0,
    right: 0,
    width: '20%',
    height: '100%',
  });

  // Initialize sidebar widgets
  initMonitor(sidebar);
  const modelList = initModelSelect(sidebar, config, router);
  const fileList = initFileTree(sidebar, sessionManager.projectRoot, activeFiles);

  // Focus cycling navigation
  const focusables = [inputField, modelList, fileList];
  let focusIndex = 0;

  // Sync focusIndex with Blessed focus events (e.g. if clicked with mouse)
  inputField.on('focus', () => { focusIndex = 0; });
  modelList.on('focus', () => { focusIndex = 1; });
  fileList.on('focus', () => { focusIndex = 2; });

  // Prevent textbox from inserting tab spaces and manually switch focus on Tab/S-Tab
  const originalListener = (inputField as any)._listener;
  (inputField as any)._listener = function(ch: string, key: any) {
    if (key) {
      if (key.name === 'tab' || key.name === 'S-tab') {
        if (key.name === 'tab') {
          focusIndex = (focusIndex + 1) % focusables.length;
        } else {
          focusIndex = (focusIndex - 1 + focusables.length) % focusables.length;
        }
        focusables[focusIndex].focus();
        screen.render();
        return;
      }
      if (key.name === 'pageup') {
        logBox.scroll(-10);
        screen.render();
        return;
      }
      if (key.name === 'pagedown') {
        logBox.scroll(10);
        screen.render();
        return;
      }
    }
    return originalListener.call(this, ch, key);
  };

  screen.key(['tab'], () => {
    focusIndex = (focusIndex + 1) % focusables.length;
    focusables[focusIndex].focus();
    screen.render();
  });

  screen.key(['S-tab'], () => {
    focusIndex = (focusIndex - 1 + focusables.length) % focusables.length;
    focusables[focusIndex].focus();
    screen.render();
  });

  // Global PageUp / PageDown bindings to scroll log box
  screen.key(['pageup'], () => {
    logBox.scroll(-10);
    screen.render();
  });

  screen.key(['pagedown'], () => {
    logBox.scroll(10);
    screen.render();
  });

  // Redirection function for stdout/stderr
  const tuiWrite = (chunk: any) => {
    // Strip carriage returns and filter ANSI spinner animations that look weird in standard log boxes
    const cleanStr = chunk.toString().replace(/\r/g, '').replace(/\u001b\[\d+D/g, '');
    if (cleanStr.trim() !== '') {
      logBox.log(cleanStr.replace(/\n$/, ''));
    }
    return true;
  };

  process.stdout.write = tuiWrite;
  process.stderr.write = tuiWrite;

  // Restore streams when exiting
  function restoreStreams() {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    delete (globalThis as any).isTui;
    delete (globalThis as any).originalStdoutWrite;
    delete (globalThis as any).originalStderrWrite;
  }

  // Keyboard navigation / Global exit
  screen.key(['C-c'], () => {
    restoreStreams();
    screen.destroy();
    process.exit(0);
  });

  // Input resolve callback
  let resolveInput: ((val: string) => void) | null = null;
  inputField.on('submit', (value: string) => {
    inputField.clearValue();
    inputField.focus();
    screen.render();
    if (resolveInput) {
      resolveInput(value);
      resolveInput = null;
    }
  });

  function readTuiInput(): Promise<string> {
    return new Promise((resolve) => {
      resolveInput = resolve;
      inputField.focus();
      screen.render();
    });
  }

  // Update CLI context settings to work nicely inside a TUI
  toolContext.askLine = (prompt: string) => {
    logBox.log(pc.yellow(`  ? ${prompt}`));
    return readTuiInput();
  };

  // Mock spinner controls to prevent background animations from writing garbage text to logs
  toolContext.pauseSpinner = () => {};
  toolContext.resumeSpinner = () => {};

  function initializeSessionState(loaded: {
    sessionId: string;
    turns: ChatMessage[];
    activeFiles: Map<string, string>;
    todos: any[];
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

    logBox.log(pc.gray(`Active files in context: ${activeFiles.size}`));
    logBox.log(pc.gray(`Loaded ${loaded.turns.length} message turn(s)`));
  }

  async function buildIndexContext(userMessage: string): Promise<string> {
    if (!config.indexing.enabled || !toolContext.indexDb) return '';
    const { searchSymbols } = await import('../indexing/fts.js');
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
        const results = searchSymbols(indexDb, term, sessionManager.projectHash, 3);
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
      // Index not available
    }

    if (count === 0) return '';
    ctx += '------------------------------------------\n\n';
    return ctx;
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

  async function chatLoop(): Promise<void> {
    // Initial welcome logs
    logBox.log(pc.cyan('  ⬡') + pc.bold(pc.white(' Daedalus TUI Active. Type your prompts below.')));
    logBox.log(pc.dim('  Press Ctrl+C to exit. Use Tab to switch focus. Use PageUp/PageDown to scroll logs.'));
    screen.render();

    while (true) {
      const input = await readTuiInput();
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
        rl: null as any,
        initializeSessionState,
        buildFileContext,
        askLine: (prompt: string) => toolContext.askLine!(prompt),
        buildIndexContext,
        getIndexDbPath,
      };

      // Try executing command
      try {
        const wasCommand = await executeCommand(trimmedInput, cmdContext);
        if (wasCommand) {
          screen.render();
          continue;
        }
      } catch (err: any) {
        if (err.message === 'SWITCH_MODE_CLI') {
          restoreStreams();
          screen.destroy();
        }
        throw err;
      }

      // User Message Processing
      try {
        const filesContext = buildFileContext();
        const indexCtx = await buildIndexContext(trimmedInput);
        const todoCtx = buildTodoContext(sessionId);
        const userContent = `${indexCtx}${todoCtx}${filesContext}User Prompt: ${trimmedInput}`;
        
        printUserTurn(trimmedInput);
        screen.render();

        await callModelWithTools(userContent);

        sessionManager.saveSessionState(messages, activeFiles, getSessionTodos(sessionId));
        await extractAndSave(router, sessionManager, messages);
      } catch {
        try {
          const filesContext = buildFileContext();
          const todoCtx = buildTodoContext(sessionId);
          const userContent = `${todoCtx}${filesContext}User Prompt: ${trimmedInput}`;
          logBox.log(pc.yellow('\n  [RETRY] Trying fallback mode...'));
          screen.render();

          const fallbackResult = await callModelWithFallback(userContent);
          if (fallbackResult) {
            sessionManager.saveSessionState(messages, activeFiles, getSessionTodos(sessionId));
            await extractAndSave(router, sessionManager, messages);
          }
        } catch (fallbackErr: any) {
          const firstLine = (fallbackErr.message || '').split('\n')[0];
          logBox.log(pc.red(`\n  ${pc.bold('[ERROR]')} Fallback also failed: ${firstLine}`));
        }
      }
      turnSeparator();
      screen.render();
    }
  }

  return chatLoop;
}
