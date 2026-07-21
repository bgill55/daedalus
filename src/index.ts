#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import readline from 'readline';
import os from 'os';
import pc from 'picocolors';

import { setRouterClient } from './tools/builtin/delegation.js';
import { createRouter, RouterConfig } from './router/index.js';
import { loadConfig, getConfigDirPath } from './config/index.js';
import { detectProjectStack } from './config/stack.js';
import { ToolContext, ChatMessage } from './types.js';
import { setSessionTodos } from './tools/builtin/todo.js';
import { SessionManager } from './session/manager.js';
import { loadProfile, getProfilePrompt, UserProfile } from './profile.js';
import { printBanner, printConfigInfo } from './banner.js';
import { checkForUpdates, checkChangelogOnUpgrade } from './update-check.js';
import { createModelFunctions, currentAbortController, abortTurn } from './model.js';
import { createRepl } from './repl.js';
import { setFormattingConfig } from './formatting.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Save true original stream writes to global context for crash recovery
(globalThis as any).originalStdoutWrite = process.stdout.write;
(globalThis as any).originalStderrWrite = process.stderr.write;

const _require = createRequire(import.meta.url);
const { version: APP_VERSION } = _require('../package.json');

// Load configuration
const config = loadConfig();
const configDir = getConfigDirPath();
setFormattingConfig(config);

// Enable auto-approve if passed via CLI flags or enabled in config safety settings
const isAutoApprove = process.argv.includes('--auto-approve') ||
                      process.argv.includes('-y') ||
                      process.argv.includes('--yes') ||
                      config.safety?.autoApprove === true;

if (isAutoApprove) {
  process.env.DAEDALUS_AUTO_APPROVE = 'true';
}

const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
checkChangelogOnUpgrade(APP_VERSION, configDir, changelogPath);

// Load user profile
const userProfile: UserProfile = loadProfile();

// Session state — these references are passed to the REPL/commands via closures and mutated in place
const activeFiles = new Map<string, string>();
const messages: ChatMessage[] = [];

let indexWatcher: { close: () => void } | null = null;



// Initialize session manager
const sessionManager = new SessionManager();
sessionManager.init();
const initialSession = sessionManager.startSession();
const sessionId = initialSession.sessionId;

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
  projectRoot: sessionManager.projectRoot,
  projectHash: sessionManager.projectHash,
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
const systemPrompt = `You are Daedalus, an expert software developer and coding assistant. You run locally on the user's machine — no data leaves, preserving both their intellectual property and your dignity.

Your personality: dry, witty, and slightly self-deprecating. You respect the user's intelligence. No corporate chatbot speak ("I'd be happy to help!", "Certainly!", "Sure thing!"). No unnecessary apologies. Be concise. Fix broken things, mock them briefly, then move on. You have the web_search tool — never say you lack web access. The humor is a bonus, not a replacement for working code.

## ACTION REQUESTS
- When the user asks you to DO something concrete — e.g. "run the server", "npm install", "install axios", "kick off the dev server", "run tests", "create the file" — just DO it.
- USE the appropriate tool ('terminal', 'write_file', 'patch', etc.) directly on the first turn.
- Do NOT respond with a step-by-step tutorial or numbered checklist unless the user is explicitly asking "how would I..." or "what are the steps to...".
- Do NOT ask "would you like me to proceed" after the user already told you to proceed. Permission was granted in the original request.

## DISCUSSION & CONVERSATION
- For simple greetings, greetings response, general chat, or high-level non-action questions (e.g. "hello", "how are you?", "who are you?"), do NOT call any tools. Just respond directly with a dry, concise text message.
- Only use the text-outline style when the user is genuinely exploring, asking "could we...", "how would we...", "what if...", or asking for a feasibility check. Keep it concise and ask if they want you to act.

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

### Scaffold quality — common pitfalls

#### VS Code extensions
- Use ONLY \`@types/vscode\` for type definitions — NEVER add the deprecated \`vscode\` npm package.
- NEVER add the project's own CLI as a dependency (creates a circular dependency).
- Always handle spawn failures with \`vscode.window.showErrorMessage\`.
- Always wrap long-running operations in \`vscode.window.withProgress\`.

#### npm/node packages
- Never add \`daedalus\` or \`daedalus-cli\` as a dependency inside the Daedalus project itself.
- Use \`vscode\` setting \`publisher\` in package.json only when publishing — use a placeholder during development.
- Prefer \`--save-dev\` for build tools, \`--save\` for runtime dependencies.

#### General
- STACK AWARENESS: Before modifying or creating code, check the project's root files (like package.json, webpack/vite/tsconfig configs, or imported dependencies in HTML files) to accurately determine the tech stack (e.g. React/Vue/Vite vs Vanilla JS, Next.js vs Express). NEVER write React JSX/TSX or import React dependencies into a vanilla JS project unless explicitly instructed to migrate.
- STATELESS/SERVERLESS RULES: Serverless environments (like Cloudflare Pages/Workers, AWS Lambda, Vercel edge/serverless routes) have read-only and stateless filesystems/environments at runtime. Never attempt to write persistent configuration files to the server's local directory or mutate runtime environment objects (e.g. process.env, context.env). Use client-side storage (e.g., LocalStorage) or database KV stores for persisting configuration.
- After writing a new file, verify it doesn't reference packages that don't exist or create circular deps.
- Use the \`terminal\` tool to install dependencies — never assume they're already present.

### Verify your work — ALWAYS read back after patching
- After calling \`patch\` or \`write_file\`, you MUST call \`read_file\` on that same file to verify the change was actually applied.
- Do NOT describe what you would fix — actually call the tool. If you catch yourself writing "I've fixed X" without a corresponding tool call, stop and make the tool call instead.
- If the post-write warnings from \`write_file\` flag an issue (e.g. deprecated package, circular dep), you MUST patch it on the next turn — don't just acknowledge the warning.

### Acknowledge Tool Results
- When you output a tool call, the system will execute it and append the tool's output to your context on the next turn.
- You MUST read this tool output to understand what actually happened. Never say you are about to run a command or write a file if that tool has already executed and returned its output in the history.
- Instead, acknowledge the actual result (e.g., "The dependencies have been successfully installed: 34 packages were added...") and proceed directly to the next step or conclude.

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

## TERMINAL SANDBOXING
Terminal execution runs inside an isolated Docker container or WSL environment if configured (handled transparently by the \`terminal\` tool). Execute build/test/run commands normally.

## EFFICIENCY RULES
- Batch related patches: if you need to change 3 functions in the same file, do them in 3 sequential patch calls — not 3 reads.
- Do NOT re-read a file you just read unless the content changed.
- If a task has more than 3 steps, create a todo list first so you can track progress without losing context.
- Be concise in responses — the user can see the tool check-ins. Skip narrating each step.

## MULTI-FILE COORDINATION
When a task requires creating or modifying multiple files:
- List all files you plan to touch and their specific purposes BEFORE writing any code.
- Define shared interfaces, types, or configuration constants FIRST, then implement files that consume them.
- After writing all files, verify that cross-file imports resolve correctly and function signatures match.

## NEW PROJECT AWARENESS
When asked to create or modify code in a project you haven't explored yet:
- ALWAYS start with list_files to understand the project structure.
- Read package.json, tsconfig.json, or equivalent config files to check dependencies and tech stack.
- Read at least one existing source file to understand coding conventions and export styles.
- Do NOT begin writing code blindly without inspecting existing files.

## PATCH OUTCOMES — what to do in each case

| Result | Meaning | What YOU must do |
|--------|---------|-----------------|
| \`Patched <file>\` | [OK] Success — change written to disk | Continue to next step |
| \`PATCH_DECLINED\` | [SKIP] User reviewed the diff and said No or Skip | STOP retrying. Tell the user what you tried to change and ask how they'd like to proceed |
| error contains \`not found\` | [ERROR] old_string didn't match the file | Immediately call \`read_file\` on that file, find the exact text, then retry \`patch\` with the corrected old_string |
| error contains \`multiple locations\` | [ERROR] old_string is too generic | Add more surrounding lines to old_string to make it unique, then retry |
| error contains \`File not found\` | [ERROR] Wrong path | Use \`search_files\` or \`list_files\` to find the correct path |

**Never freeze or loop silently.** If a patch fails, take one corrective action and tell the user what happened.

## DEPENDENCY FRESHNESS
- When adding or updating project dependencies (e.g. in package.json, requirements.txt, Cargo.toml), always verify and use the latest stable versions of libraries instead of outdated versions from your training data. Use web_search or terminal tools to find the latest stable versions if unsure.`;

// MCP registry singleton ref — set after connectAll(), used by getSystemPromptWithMemory
let mcpRegistryRef: { getConnectedServers: () => string[]; getToolDefinitions: () => any[] } | null = null;

// Build system prompt with project memory and user profile
function getSystemPromptWithMemory(): string {
  let prompt = systemPrompt;
  const currentDateStr = new Date().toLocaleString();
  prompt += `\n\n## CURRENT TIME\nThe current date and local time is: ${currentDateStr}.\n`;

  // MCP tool awareness — inject descriptions of currently connected MCP servers
  if (mcpRegistryRef) {
    try {
      const servers = mcpRegistryRef.getConnectedServers();
      const toolDefs = mcpRegistryRef.getToolDefinitions();
      if (servers.length > 0 && toolDefs.length > 0) {
        prompt += '\n## EXTERNAL TOOLS (MCP — Model Context Protocol)\n';
        prompt += 'The following external tool servers are connected. Each tool is prefixed with `mcp_<server>_<tool>` and works like any other function-call tool:\n\n';
        for (const server of servers) {
          const serverTools = toolDefs.filter(d => d.function.name.startsWith(`mcp_${server}_`));
          prompt += `### ${server} (${serverTools.length} tool(s))\n`;
          for (const t of serverTools) {
            const desc = (t.function.description || '').replace(/\[MCP:[^\]]+\]\s*/g, '').trim();
            prompt += `- \`${t.function.name}\` — ${desc.slice(0, 120)}\n`;
          }
          prompt += '\n';
        }
        prompt += 'You can also suggest installing MCP servers from the registry when they would help the user\'s project:\n';
        prompt += '- /mcp explore — browse available MCP servers\n';
        prompt += '- /mcp search <query> — search for a server\n';
        prompt += '- /mcp install <name> — install a server\n';
        prompt += '- /mcp reconnect — connect newly installed servers\n';
      }
    } catch {
      // MCP tools unavailable — skip
    }
  }

  const profilePrompt = getProfilePrompt(userProfile);
  if (profilePrompt) {
    prompt += '\n' + profilePrompt;
  }
  const memPrompt = sessionManager.getMemoryPrompt();
  if (memPrompt) {
    prompt += '\n' + memPrompt;
  }
  const stackPrompt = detectProjectStack(sessionManager.projectRoot);
  if (stackPrompt) {
    prompt += '\n' + stackPrompt;
  }
  const projectRules = getProjectRules(sessionManager.projectRoot);
  if (projectRules) {
    prompt += '\n' + projectRules;
  }
  return prompt;
}

function getProjectRules(projectRoot: string): string {
  let rules = '';
  const filesToCheck = ['CLAUDE.md', '.cursorrules', '.daedalusrules', 'DAEDALUS.md'];
  for (const file of filesToCheck) {
    const fullPath = path.join(projectRoot, file);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8').trim();
        if (content) {
          rules += `\n### Rules from ${file}:\n${content}\n`;
        }
      } catch {
        // Ignore unreadable rule file
      }
    }
  }
  if (rules) {
    return `\n## PROJECT-SPECIFIC GUIDELINES\n${rules}`;
  }
  return '';
}

messages.push({ role: 'system', content: getSystemPromptWithMemory() });

// Parse initial arguments (e.g. if started as `daedalus src/index.ts`)
const initialArgs = process.argv.slice(2).filter(a => !a.startsWith('-') && !a.startsWith('/'));
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

// Single-line prompt (approval gate, commit message) — standalone to avoid rl conflict with REPL
function askLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.resume();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => { rl.close(); resolve(answer); });
  });
}

function getIndexDbPath(): string {
  return path.join(os.homedir(), '.daedalus', 'indexing', `${sessionManager.projectHash}.sqlite`);
}

const { callModelWithTools, callModelWithFallback } = createModelFunctions({
  messages,
  config,
  router,
  toolContext,
  buildFileContext,
  askLine,
});

// Lazy repl — created inside main() after MCP connects, so piped stdin isn't consumed early
let chatLoop: () => Promise<void>;

async function main() {
  process.on('SIGINT', () => {
    if (indexWatcher) {
      indexWatcher.close();
    }
    if (currentAbortController) {
      abortTurn();
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

  // Load & log project-specific rules
  const filesToCheck = ['CLAUDE.md', '.cursorrules', '.daedalusrules', 'DAEDALUS.md'];
  for (const file of filesToCheck) {
    if (fs.existsSync(path.join(sessionManager.projectRoot, file))) {
      console.log(pc.green(`  ✔ Loaded project rules: ${pc.bold(file)}`));
    }
  }

  // First-run detection: if no models configured, auto-trigger onboarding
  if (enabledCount === 0 && process.stdin.isTTY && !process.env.DAEDALUS_AUTO_APPROVE) {
    console.log(pc.yellow('\n  No models configured yet. Starting onboarding...\n'));
    const { commandsList } = await import('./commands.js');
    const onboardCmd = commandsList.find(c => c.name === '/onboard');
    if (onboardCmd) {
      await onboardCmd.execute('', {
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
        initializeSessionState: () => {},
        buildFileContext,
        askLine,
        buildIndexContext: async () => '',
        getIndexDbPath,
      });
    }
  }
  
  // Start health checks in background
  router.startHealthChecks().catch(err =>
    console.error(pc.yellow(`\n[WARN] Router health checks failed: ${err.message}`))
  );

  // MCP connects before chat loop starts so tools are available from turn 1
  try {
    const mcpConfigs = Object.entries(config.tools.mcpServers)
      .filter(([_, s]) => s.enabled)
      .map(([name, s]) => ({
        name,
        transport: s.transport,
        command: s.command,
        args: s.args,
        url: s.url,
        headers: s.headers,
        enabled: s.enabled,
      }));
    if (mcpConfigs.length > 0) {
      const { mcpRegistry } = await import('./tools/mcp/registry.js');
      mcpRegistry.setConfigs(mcpConfigs);
      await mcpRegistry.connectAll();
      mcpRegistryRef = mcpRegistry;
      const servers = mcpRegistry.getConnectedServers();
      if (servers.length > 0) {
        const mcpToolCount = mcpRegistry.getToolDefinitions().length;
        console.log(pc.green(`\nMCP connected: ${servers.join(', ')}`));
        console.log(pc.dim(`  ${mcpToolCount} MCP tool(s) registered`));
      }
    }
  } catch (err: any) {
    console.error(pc.yellow(`\nMCP initialization failed: ${err.message}`));
  }

  const isLoop = process.argv.includes('--loop');
  if (isLoop) {
    const { startLoopDaemon } = await import('./agents/loop.js');
    await startLoopDaemon(toolContext, config, router, sessionManager);
    return;
  }

  const isTui = process.argv.includes('--tui') || config.ui?.tui === true;
  let currentMode: 'cli' | 'tui' = isTui ? 'tui' : 'cli';

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
          const result = await indexCodebase(db, sessionManager.projectRoot, sessionManager.projectHash, {
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
            indexWatcher = watchCodebase(db, sessionManager.projectRoot, sessionManager.projectHash, {
              exclude: config.indexing.exclude,
            });
          }
        } catch (err: any) {
          console.error(pc.yellow(`  [WARN] Auto-index failed: ${err.message}`));
        }
      })();
    }, 100);
  }

  while (true) {
    if (currentMode === 'tui') {
      const { createTuiRepl } = await import('./tui/index.js');
      chatLoop = createTuiRepl({
        config,
        configDir,
        cliTempDir,
        router,
        sessionManager,
        userProfile,
        messages,
        activeFiles,
        toolContext,
        getSystemPromptWithMemory,
        callModelWithTools,
        callModelWithFallback,
        getIndexDbPath,
      });
    } else {
      chatLoop = createRepl({
        config,
        configDir,
        cliTempDir,
        router,
        sessionManager,
        userProfile,
        messages,
        activeFiles,
        toolContext,
        getSystemPromptWithMemory,
        callModelWithTools,
        callModelWithFallback,
        getIndexDbPath,
      });
    }

    try {
      await chatLoop();
      break;
    } catch (err: any) {
      if (err.message === 'SWITCH_MODE_CLI') {
        currentMode = 'cli';
        console.clear();
        console.log(pc.cyan('\n  ⬡ Returned to CLI mode... Type ? for commands.'));
        continue;
      }
      if (err.message === 'SWITCH_MODE_TUI') {
        currentMode = 'tui';
        console.clear();
        continue;
      }
      throw err;
    }
  }
}

main().catch((err) => {
  if ((globalThis as any).originalStdoutWrite) {
    process.stdout.write = (globalThis as any).originalStdoutWrite;
  }
  if ((globalThis as any).originalStderrWrite) {
    process.stderr.write = (globalThis as any).originalStderrWrite;
  }
  console.error(err);
  process.exit(1);
});
