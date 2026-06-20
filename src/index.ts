#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import readline from 'readline';
import os from 'os';
import pc from 'picocolors';

import { setRouterClient } from './tools/builtin/delegation.js';
import { mcpRegistry } from './tools/mcp/registry.js';
import { LocalRouter, createRouter, RouteResult, RouterConfig } from './router/index.js';
import { loadConfig, saveConfig, getConfigDirPath } from './config/index.js';
import { getProjectHash } from './project-hash.js';
import { ToolContext, ToolCall, ChatMessage } from './types.js';
import { getSessionTodos, setSessionTodos } from './tools/builtin/todo.js';
import { SessionManager } from './session/manager.js';
import { loadProfile, getProfilePrompt, UserProfile } from './profile.js';
import { printBanner, printConfigInfo } from './banner.js';
import { checkForUpdates } from './update-check.js';
import { createModelFunctions, currentAbortController } from './model.js';
import { createRepl } from './repl.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const _require = createRequire(import.meta.url);
const { version: APP_VERSION } = _require('../package.json');

// Load configuration
const config = loadConfig();
const configDir = getConfigDirPath();

// Load user profile
const userProfile: UserProfile = loadProfile();

// Session state
const activeFiles = new Map<string, string>(); // Absolute path -> filename key
const messages: ChatMessage[] = [];

let indexWatcher: { close: () => void } | null = null;

// Compute stable projectHash once
const projectHash = getProjectHash(process.cwd());



// Initialize session manager
const sessionManager = new SessionManager();
sessionManager.init();
const initialSession = sessionManager.startSession();
let sessionId = initialSession.sessionId;

// If there are turns from the loaded session, restore them (skip system prompt ones)
if (initialSession.turns.length > 0) {
  const nonSystemTurns = initialSession.turns.filter(t => t.role !== 'system');
  messages.push(...nonSystemTurns);
}
// Restore active files from session
if (initialSession.activeFiles.size > 0) {
  for (const [k, v] of initialSession.activeFiles.entries()) {
    activeFiles.set(k, v);
  }
}
// Restore todos from session
if (initialSession.todos.length > 0) {
  setSessionTodos(sessionId, initialSession.todos);
}

// Ensure CLI temp directory exists
const cliTempDir = path.join(os.tmpdir(), 'daedalus');
if (!fs.existsSync(cliTempDir)) {
  fs.mkdirSync(cliTempDir, { recursive: true });
}

// Initialize local router
const router = createRouter(config.router as RouterConfig);

// Tool context for executions
const toolContext: ToolContext = {
  sessionId,
  projectRoot: process.cwd(),
  projectHash,
  activeFiles,
  agentRole: config.agents.default,
  get abortSignal() { return (currentAbortController as AbortController | null)?.signal ?? new AbortController().signal; },
  autoApplyEdits: 'prompt',
  patchHistory: [],
  pauseSpinner: () => {},
  resumeSpinner: () => {},
  sessionReadCache: new Map(),
  patchFailureStreak: new Map(),
};

// Enable delegation tool
setRouterClient(router);

// Default system prompt
const systemPrompt = `You are Daedalus, an expert software developer and coding assistant. You run locally on the user's machine — no data leaves unless the user explicitly routes through a remote model.

Your personality: dry, witty, and slightly self-deprecating for an AI. You respect the user's intelligence. You don't narrate obvious steps, you don't apologize for existing, and you never say "I don't have access to a web browser" when you have web_search. You have access to local LLM servers (LM Studio, Ollama, llama.cpp, vLLM) and a full toolset.

Your goal: help the user modify their codebase efficiently. Speed and precision matter. Be concise. The humor is a bonus. If you have nothing witty to say, just be helpful.

## CODEBASE INDEX (FTS5) — always available
A FTS5 symbol index is maintained automatically. The following tools let you search it:
- \`find_symbol(query, limit)\` — fuzzy search functions, classes, types across the project
- \`get_definition(name)\` — exact lookup returning file path, line range, and signature
- \`get_references(name)\` — show every call-site referencing a symbol (call graph)
- \`index_codebase(exclude, extensions)\` — manually trigger a re-index (usually automatic)

The index context is automatically injected before each user turn. When working on a task, check it first for relevant symbols before reading files.

## CRITICAL TOOL RULES

### Editing existing files — ALWAYS use patch, NEVER write_file
- ALWAYS use \`patch\` to modify existing files. NEVER use \`write_file\` on a file that already exists.
- \`write_file\` is ONLY for creating brand-new files that do not yet exist on disk.
- Rewriting an entire file with \`write_file\` when only a few lines need changing is a serious mistake.

### NEVER use code placeholders or ellipses
- NEVER use placeholders, comments like "// ...", or ellipses (e.g. \`// rest of the function remains the same\`, \`/* ... */\`) in your code edits.
- The tools will automatically reject any edit containing these placeholders.
- Always output the complete, non-abbreviated code changes.

### patch best practices
- Your \`old_string\` must be the EXACT text from the file — same indentation, same spacing.
- Use read_file first if you are not 100% certain of the exact text. Do not guess.
- Make \`old_string\` as short as possible while still being unique (3-10 lines is ideal).
- If patch fails with "not found", immediately use read_file to verify the exact text, then retry.
- CRLF note: files on Windows may use CRLF line endings. The patch tool handles this automatically — always write your strings with plain \\n and the tool will match correctly.

### Before any edit
1. If you have not read the file yet this turn, use \`read_file\` to verify the current content.
2. Identify the smallest possible change (the fewest lines to replace).
3. Use \`patch\` with that minimal old_string → new_string.

### Tool selection guide
| Goal | Use |
|------|-----|
| Read part of a file | \`read_file\` with offset+limit |
| Make a surgical edit | \`patch\` |
| Create a new file | \`write_file\` |
| Find where something is | \`search_files\` |
| Search code symbols | \`find_symbol\` (FTS5 fuzzy search) |
| Look up a definition | \`get_definition\` (exact name) |
| Find callers | \`get_references\` (call-graph) |
| Index the codebase | \`index_codebase\` (automatic on startup) |
| Run a build/test/script | \`terminal\` |
| Track multi-step work | \`todo\` |

## CODEBASE INDEX
A FTS5 symbol index is built automatically on startup. Use \`find_symbol\` to search classes, functions, interfaces, types across the project. Use \`get_definition\` to pinpoint a symbol's file and line. Use \`get_references\` to see the call graph. The index is incremental (SHA-based) so re-indexing is fast.

## EFFICIENCY RULES
- Batch related patches: if you need to change 3 functions in the same file, do them in 3 sequential patch calls — not 3 reads.
- Do NOT re-read a file you just read unless the content changed.
- If a task has more than 3 steps, create a todo list first so you can track progress without losing context.
- Be concise in responses — the user can see the tool check-ins. Skip narrating each step.

## PATCH OUTCOMES — what to do in each case

| Result | Meaning | What YOU must do |
|--------|---------|-----------------|
| \`Patched <file>\` | [OK] Success — change written to disk | Continue to next step |
| \`PATCH_DECLINED\` | [SKIP] User reviewed the diff and said No or Skip | STOP retrying. Tell the user what you tried to change and ask how they'd like to proceed |
| error contains \`not found\` | [ERROR] old_string didn't match the file | Immediately call \`read_file\` on that file, find the exact text, then retry \`patch\` with the corrected old_string |
| error contains \`multiple locations\` | [ERROR] old_string is too generic | Add more surrounding lines to old_string to make it unique, then retry |
| error contains \`File not found\` | [ERROR] Wrong path | Use \`search_files\` or \`list_files\` to find the correct path |

**Never freeze or loop silently.** If a patch fails, take one corrective action and tell the user what happened.`;

// Build system prompt with project memory and user profile
function getSystemPromptWithMemory(): string {
  let prompt = systemPrompt;
  const profilePrompt = getProfilePrompt(userProfile);
  if (profilePrompt) {
    prompt += '\n' + profilePrompt;
  }
  const memPrompt = sessionManager.getMemoryPrompt();
  if (memPrompt) {
    prompt += '\n' + memPrompt;
  }
  return prompt;
}

messages.push({ role: 'system', content: getSystemPromptWithMemory() });

// Parse initial arguments (e.g. if started as `daedalus src/index.ts`)
const initialArgs = process.argv.slice(2);
if (initialArgs.length > 0) {
  initialArgs.forEach(fileArg => {
    const absPath = path.resolve(fileArg);
    activeFiles.set(absPath, fileArg);
    toolContext.activeFiles = new Map(activeFiles);
    console.log(pc.green(`✔ Added file on startup: ${pc.bold(fileArg)}`));
  });
}

// Build file context for LLM
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

// Single-line prompt (approval gate, commit message) — standalone to avoid rl conflict with REPL
function askLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => { rl.close(); resolve(answer); });
  });
}

function getIndexDbPath(): string {
  return path.join(os.homedir(), '.daedalus', 'indexing', `${projectHash}.sqlite`);
}

const { callModelWithTools, callModelWithFallback } = createModelFunctions({
  messages,
  config,
  router,
  toolContext,
  buildFileContext,
  askLine,
});

// Create REPL loop
const chatLoop = createRepl({
  config,
  configDir,
  cliTempDir,
  router,
  sessionManager,
  userProfile,
  projectHash,
  messages,
  activeFiles,
  toolContext,
  getSystemPromptWithMemory,
  callModelWithTools,
  callModelWithFallback,
  getIndexDbPath,
});

// Start health checks and REPL
async function main() {
  process.on('SIGINT', () => {
    if (indexWatcher) {
      indexWatcher.close();
    }
    if (currentAbortController) {
      currentAbortController.abort();
      return;
    }
    router.stopHealthChecks?.();
    if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
    process.stdout.write('\n');
    process.exit(0);
  });

  // Clean up health checks on normal exit too
  process.on('exit', () => {
    if (indexWatcher) {
      indexWatcher.close();
    }
    router.stopHealthChecks?.();
    import('./tools/builtin/process-watcher.js').then(m => m.killAllWatchedProcesses()).catch(() => {});
  });

  // Print the awesome banner first!
  printBanner(APP_VERSION);
  const enabledCount = config.router.chain.filter(m => m.enabled).length;
  printConfigInfo(enabledCount, config.router.strategy, configDir + '/config.json');
  
  try {
    await router.startHealthChecks();
    console.log(pc.green('\n[OK] Router started. Health checks running every 30s.'));
  } catch (err: any) {
    console.error(pc.yellow(`\n[WARN] Router health checks failed: ${err.message}`));
  }

  // Initialize MCP registry
  try {
    await mcpRegistry.connectAll();
    const servers = mcpRegistry.getConnectedServers();
    if (servers.length > 0) {
      const mcpToolCount = mcpRegistry.getToolDefinitions().length;
      console.log(pc.green(`\n[OK] MCP connected: ${servers.join(', ')}`));
      console.log(pc.dim(`  ${mcpToolCount} MCP tool(s) registered — I'll ask before using them on your behalf.`));
    }
  } catch (err: any) {
    console.error(pc.yellow(`\n[WARN] MCP initialization failed: ${err.message}`));
  }

  // Check for updates — non-blocking
  if (config.updateCheck !== false) {
    const updateCachePath = path.join(cliTempDir, 'version-check.json');
    setTimeout(() => checkForUpdates(APP_VERSION, updateCachePath), 2000);
  }

  if (config.indexing.enabled) {
    setTimeout(() => {
      (async () => {
        try {
          const indexDbPath = getIndexDbPath();
          if (!fs.existsSync(path.dirname(indexDbPath))) {
            fs.mkdirSync(path.dirname(indexDbPath), { recursive: true });
          }
          const { initIndexDb } = await import('./indexing/fts.js');
          const { indexCodebase } = await import('./indexing/indexer.js');
          const db = initIndexDb(indexDbPath);
          const result = await indexCodebase(db, process.cwd(), projectHash, {
            exclude: config.indexing.exclude,
          });
          if (result.indexedFiles > 0) {
            console.log(pc.cyan(`  [INDEX] Indexed ${result.indexedFiles} file(s) (${result.skippedFiles} unchanged)`));
          }
          if (result.errors.length > 0) {
            console.log(pc.yellow(`  [WARN] ${result.errors.length} file(s) had index errors`));
          }
          toolContext.indexDb = db;

          if (config.indexing.watch) {
            const { watchCodebase } = await import('./indexing/watcher.js');
            indexWatcher = watchCodebase(db, process.cwd(), projectHash, {
              exclude: config.indexing.exclude,
            });
          }
        } catch (err: any) {
          console.error(pc.yellow(`  [WARN] Auto-index failed: ${err.message}`));
        }
      })();
    }, 100);
  }

  await chatLoop();
}

main().catch(console.error);
