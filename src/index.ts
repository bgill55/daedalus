#!/usr/bin/env node
import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import readline from 'readline';
import os from 'os';
import pc from 'picocolors';

import { BUILTIN_TOOLS } from './tools/definitions.js';
import { executeToolCalls } from './tools/executor.js';
import { setRouterClient } from './tools/builtin/delegation.js';
import { mcpRegistry } from './tools/mcp/registry.js';
import { LocalRouter, createRouter, RouteResult, RouterConfig } from './router/index.js';
import { loadConfig, saveConfig, getConfigDirPath, discoverLocalServers } from './config/index.js';
import crypto from 'crypto';
import { ToolContext, ToolCall, ChatMessage } from './types.js';
import { getSessionTodos, setSessionTodos } from './tools/builtin/todo.js';
import { searchSymbols as ftsSearch } from './indexing/fts.js';
import { SessionManager } from './session/manager.js';
import { SqliteTodo } from './session/sqlite.js';
import { runOnboarding } from './onboarding/wizard.js';
import { DaedalusSpinner } from './tools/daedalus-spinner.js';
import { loadProfile, saveProfile, getProfilePrompt, UserProfile } from './profile.js';
import { extractAndSave } from './extraction.js';

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

// Token tracking for current turn
let currentTurnInputTokens = 0;
let currentTurnOutputTokens = 0;
let turnStartTime = 0;
let currentAbortController: AbortController | null = null;

// Compute stable projectHash once
const projectHash = crypto.createHash('sha256').update(path.resolve(process.cwd())).digest('hex').slice(0, 12);

// Max chars of tool output stored in message history (prevents context-window overflow)
const TOOL_RESULT_MAX_CHARS = 32_000;

// Single source of truth for the codebase index DB path — used by all REPL
// handlers AND the indexing tools so they always share the same database.
function getIndexDbPath(): string {
  return path.join(os.homedir(), '.daedalus', 'indexing', `${projectHash}.sqlite`);
}

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
const cliTempDir = path.join(os.homedir(), '.daedalus', 'temp');
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
  abortSignal: new AbortController().signal,
  autoApplyEdits: 'prompt',
  patchHistory: [],
  pauseSpinner: () => {},
  resumeSpinner: () => {},
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

// Setup Readline Interface with tab completion
const COMMANDS = [
  '/add', '/remove', '/context', '/clear',
  '/spawn', '/delegate', '/orchestrate',
  '/memory', '/fact', '/convention',
  '/extract',
  '/profile', '/style',
  '/index', '/find', '/refs', '/def',
  '/commit', '/undo', '/test', '/paste',
  '/models', '/tools', '/config', '/project', '/doctor', '/session', '/onboard',
  '/help', 'exit', 'quit', '?',
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

// ─────────────────────────────────────────────────────────────────────────────
//  B A N N E R
// ─────────────────────────────────────────────────────────────────────────────

// Each row of the block-letter art, rendered as segments so we can colour
// the left half cyan and the right half white for a pseudo-gradient effect.
const LOGO_ROWS = [
  ' ██████╗   █████╗  ███████╗ ██████╗   █████╗  ██╗     ██╗   ██╗ ███████╗ ',
  ' ██╔══██╗ ██╔══██╗ ██╔════╝ ██╔══██╗ ██╔══██╗ ██║     ██║   ██║ ██╔════╝ ',
  ' ██║  ██║ ███████║ █████╗   ██║  ██║ ███████║ ██║     ██║   ██║ ███████╗ ',
  ' ██║  ██║ ██╔══██║ ██╔══╝   ██║  ██║ ██╔══██║ ██║     ██║   ██║ ╚════██║ ',
  ' ██████╔╝ ██║  ██║ ███████╗ ██████╔╝ ██║  ██║ ███████╗╚██████╔╝ ███████║ ',
  ' ╚═════╝  ╚═╝  ╚═╝ ╚══════╝ ╚═════╝  ╚═╝  ╚═╝ ╚══════╝ ╚═════╝  ╚══════╝ ',
];

const W = 76; // inner width (between the border pipes)

function box(inner: string, borderColor: (s: string) => string): string {
  return borderColor('║') + inner + borderColor('║');
}

function hRule(l: string, r: string, fill: string, len: number, color: (s: string) => string): string {
  return color(l + fill.repeat(len) + r);
}

function centred(text: string, width: number, color: (s: string) => string): string {
  const pad = Math.max(0, width - text.length);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return ' '.repeat(left) + color(text) + ' '.repeat(right);
}

function printBanner(): void {
  const cyan  = pc.cyan.bind(pc);
  const white = pc.white.bind(pc);
  const bold  = pc.bold.bind(pc);
  const dim   = pc.dim.bind(pc);

  // Top border
  console.log(hRule('╔', '╗', '═', W, cyan));
  console.log(box(' '.repeat(W), cyan));

  // Logo rows — left half cyan, right half white, fading across
  LOGO_ROWS.forEach((row, i) => {
    const mid = Math.floor(row.length * (0.4 + i * 0.04)); // gradient cut shifts right each row
    const left  = cyan(row.slice(0, mid));
    const right = white(row.slice(mid));
    const inner = left + right;
    // Pad to exactly W chars
    const visLen = row.length;
    const padded = inner + ' '.repeat(Math.max(0, W - visLen));
    console.log(box(padded, cyan));
  });

  console.log(box(' '.repeat(W), cyan));

  // Tagline strip
  const tagline = '⬡  local-first  ·  embedded router  ·  multi-agent  ·  not sentient  ⬡';
  console.log(box(centred(tagline, W, dim), cyan));

  // Bottom border
  console.log(hRule('╚', '╝', '═', W, cyan));

  // Version / author badge — pill style
  const badge    = `  v${APP_VERSION}`;
  const author   = `bgill55_dev  `;
  const divider  = ` · `;
  console.log('');
  console.log(
    '  ' +
    pc.bgCyan(pc.black(bold(` DAEDALUS `))) +
    pc.bgBlack(pc.cyan(bold(badge))) +
    pc.bgBlack(dim(divider)) +
    pc.bgBlack(pc.white(author))
  );
  console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
//  S T A R T U P   I N F O
// ─────────────────────────────────────────────────────────────────────────────

function printConfigInfo(): void {
  const enabledCount = config.router.chain.filter(m => m.enabled).length;
  const strategy = config.router.strategy;
  const configPath = configDir + '/config.json';

  const contentLine = `strategy  ${strategy}    models  ${enabledCount}   config  ${configPath}`;
  const top = pc.dim('  ┌─ ') + pc.cyan('router') + pc.dim(' ' + '─'.repeat(Math.max(0, contentLine.length - 7)) + '┐');
  const mid = pc.dim('  │ ') + pc.white(contentLine) + pc.dim(' │');
  const bot = pc.dim('  └' + '─'.repeat(contentLine.length + 2) + '┘');

  console.log(top);
  console.log(mid);
  console.log(bot);
  console.log('');

  // ── Quick tip ────────────────────────────────────────────────────────────
  console.log(`  ${pc.dim('Type')} ${pc.cyan('?')} ${pc.dim('for commands  ·  Tab completes  ·  Be nice to your AI')}`);
  console.log('');
}

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

// Build index context — auto-inject relevant symbols from FTS5 index
async function buildIndexContext(userMessage: string): Promise<string> {
  if (!config.indexing.enabled || !toolContext.indexDb) return '';
  const indexDb = toolContext.indexDb;

  // Extract likely symbol names from the user message (camelCase, PascalCase, snake_case, class names)
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

// Initialize session state from a loaded session snapshot
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

// Handle /spawn and /delegate commands
async function handleSpawn(role: string, task: string): Promise<void> {
  const validRoles = ['coder', 'reviewer', 'debugger', 'researcher', 'planner'];
  if (!validRoles.includes(role)) {
    console.log(pc.red(`[WARN] Unknown role: ${role}. Valid: ${validRoles.join(', ')}`));
    return;
  }

  console.log(pc.cyan(`\n[SPAWN] Spawning ${role} agent for: ${task.slice(0, 80)}...`));

  const context = `Active files: ${Array.from(activeFiles.values()).join(', ') || 'none'}`;

  const fakeToolCall: ToolCall = {
    id: `call_${Date.now()}`,
    type: 'function',
    function: {
      name: 'delegate_task',
      arguments: JSON.stringify({ goal: task, context, role }),
    },
  };

  const results = await executeToolCalls([fakeToolCall], toolContext);
  
  for (const result of results) {
    const status = result.success ? pc.green('✔') : pc.red('✗');
    console.log(`\n${status} ${role} agent completed`);
    console.log(pc.white(result.content));
    if (!result.success && result.error) {
      console.log(pc.red(`Error: ${result.error}`));
    }
  }
}

// Handle /orchestrate command
async function handleOrchestrate(goal: string): Promise<void> {
  console.log(pc.cyan(`\n[ORCHESTRATE] Starting orchestration for: ${goal}`));
  
  const { Orchestrator } = await import('./agents/orchestrator.js');
  const orchestrator = new Orchestrator(router, messages, toolContext);
  
  const result = await orchestrator.run(goal);
  console.log(pc.white(`\n${result}`));
}

// Handle /models command
async function handleModels(): Promise<void> {
  console.log(pc.bold('\n--- Available Models ---'));
  
  const models = await router.listModels();
  if (models.length === 0) {
    console.log(pc.yellow('  No models found. Check your local servers (LM Studio, Ollama, etc.)'));
  } else {
    for (const model of models) {
      console.log(`  • ${pc.cyan(model)}`);
    }
  }
  
  const { checkModelHealth } = await import('./router/health.js');
  const healthyModels = router.getHealthyModels();
  console.log(pc.bold('\n--- Healthy Models ---'));
  for (const model of healthyModels) {
    const health = await checkModelHealth(model, 5000);
    const status = health?.healthy ? pc.green('●') : pc.red('●');
    console.log(`  ${status} ${pc.cyan(model.name)} (${model.endpoint}) - ${model.model}`);
  }
  console.log(pc.bold('----------------------\n'));
}

// Handle /config command
function handleConfig(): void {
  console.log(pc.bold('\n--- Current Configuration ---'));
  console.log(JSON.stringify(config, null, 2));
  console.log(pc.bold('-----------------------------'));
  console.log(pc.gray(`\nEdit ${configDir}/config.json to modify settings.`));
  console.log(pc.gray('Run `daedalus /doctor` to auto-discover local servers.'));
}

// Handle /doctor command
async function handleDoctor(): Promise<void> {
  console.log(pc.bold('\n--- Daedalus Doctor ---'));
  console.log(pc.gray('Checking local server connections...\n'));
  
  const discovered = await discoverLocalServers();
  
  if (discovered.length === 0) {
    console.log(pc.yellow('  No local servers detected.'));
    console.log(pc.gray('  Start one of:'));
    console.log(pc.gray('    • LM Studio (http://localhost:1234)'));
    console.log(pc.gray('    • Ollama (http://localhost:11434)'));
    console.log(pc.gray('    • llama.cpp server (--server, default :8080)'));
    console.log(pc.gray('    • vLLM (http://localhost:8000)'));
  } else {
    console.log(pc.green(`  Found ${discovered.length} running server(s):\n`));
    for (const server of discovered) {
      console.log(`  ${pc.green('●')} ${server.name} at ${server.endpoint}`);
      for (const model of server.models.slice(0, 5)) {
        console.log(`      - ${model}`);
      }
      if (server.models.length > 5) {
        console.log(pc.gray(`      ... and ${server.models.length - 5} more`));
      }
    }
  }
  
  console.log(pc.bold('\n--- Router Health ---'));
  const enabledModels = router.getEnabledModels();
  if (enabledModels.length === 0) {
    console.log(pc.yellow('  No models configured. Run /onboard to set one up.'));
  } else {
    for (const model of enabledModels) {
      const { checkModelHealth } = await import('./router/health.js');
      const health = await checkModelHealth(model, 5000);
      const status = health.healthy ? pc.green('●') : pc.red('●');
      const latency = health.latencyMs ? ` (${health.latencyMs}ms)` : '';
      const err = health.error ? ` ${pc.red(health.error)}` : '';
      console.log(`  ${status} ${model.name}: ${model.endpoint}${latency}${err}`);
    }
  }
  console.log(pc.bold('  Config:') + pc.gray(` ${configDir}\\config.json`));
  console.log(pc.bold('----------------------\n'));
} // end handleDoctor

async function handleIndex(opts: { exclude?: string[]; extensions?: string[] }): Promise<void> {
  console.log(pc.bold('\n--- Indexing Codebase ---'));
  console.log(pc.gray(`Project: ${process.cwd()}`));

  const indexDbPath = getIndexDbPath();

  if (!fs.existsSync(path.dirname(indexDbPath))) {
    fs.mkdirSync(path.dirname(indexDbPath), { recursive: true });
  }

  const { initIndexDb } = await import('./indexing/fts.js');
  const { indexCodebase } = await import('./indexing/indexer.js');

  const db = initIndexDb(indexDbPath);

  console.log(pc.gray('\nScanning files...'));
  const start = Date.now();

  try {
    const barWidth = 20;
    let lastPct = -1;
    const onProgress = ({ current, total, file }: { current: number; total: number; file: string }) => {
      const pct = Math.round((current / total) * 100);
      if (pct === lastPct) return;
      lastPct = pct;
      const filled = Math.round((current / total) * barWidth);
      const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);
      process.stdout.write(`\r  ${pc.cyan(bar)} ${pc.white(`${current}/${total}`)} ${pc.gray(file.slice(-40))}`);
    };

    const result = await indexCodebase(db, process.cwd(), projectHash, { ...opts, onProgress });
    process.stdout.write('\n');
    const elapsed = Date.now() - start;

    toolContext.indexDb = db;

    console.log(pc.green(`\n✔ Indexing complete in ${elapsed}ms`));
    console.log(pc.white(`  Total files:     ${result.totalFiles}`));
    console.log(pc.white(`  Indexed files:   ${result.indexedFiles}`));
    console.log(pc.white(`  Skipped (unchanged): ${result.skippedFiles}`));
    if (result.errors.length > 0) {
      console.log(pc.yellow(`\nErrors (${result.errors.length}):`));
      result.errors.slice(0, 10).forEach(e => console.log(pc.red(`  - ${e}`)));
      if (result.errors.length > 10) {
        console.log(pc.gray(`  ... and ${result.errors.length - 10} more`));
      }
    }
  } catch (err: any) {
    console.error(pc.red(`\n[ERROR] Indexing failed: ${err.message}`));
  }
}

async function handleFindSymbol(query: string, limit: number): Promise<void> {
  const indexDbPath = getIndexDbPath();

  if (!fs.existsSync(indexDbPath)) {
    console.log(pc.yellow('[WARN] No index found. Run /index first.'));
    return;
  }
  
  const { initIndexDb, searchSymbols } = await import('./indexing/fts.js');
  const db = initIndexDb(indexDbPath);

  console.log(pc.bold(`\n--- Symbol Search: "${query}" ---`));
  const symbols = searchSymbols(db, query, projectHash, limit);

  if (symbols.length === 0) {
    console.log(pc.gray('  No symbols found.'));
    return;
  }

  console.log(pc.white(`\nFound ${symbols.length} symbol(s):`));
  for (const s of symbols) {
    const kindColor = s.kind === 'function' ? pc.cyan : s.kind === 'class' ? pc.green : s.kind === 'interface' ? pc.blue : pc.white;
    const loc = `${s.file_path}:${s.line_start}${s.line_end !== s.line_start ? '-' + s.line_end : ''}`;
    console.log(`  ${kindColor(`[${s.kind}]`)} ${pc.bold(s.name)} ${pc.dim(`(${loc})`)}`);
    if (s.signature) {
      console.log(pc.dim(`    ${s.signature.slice(0, 100)}${s.signature.length > 100 ? '...' : ''}`));
    }
  }
}

async function handleGetReferences(symbol: string): Promise<void> {
  const indexDbPath = getIndexDbPath();

  if (!fs.existsSync(indexDbPath)) {
    console.log(pc.yellow('[WARN] No index found. Run /index first.'));
    return;
  }

  const { initIndexDb, findReferences } = await import('./indexing/fts.js');
  const db = initIndexDb(indexDbPath);

  console.log(pc.bold(`\n--- References to: ${symbol} ---`));
  const refs = findReferences(db, symbol, projectHash);

  if (refs.length === 0) {
    console.log(pc.gray('  No references found.'));
    return;
  }

  const byCaller = new Map<string, typeof refs>();
  for (const r of refs) {
    const key = `${r.caller_name} (${r.caller_file}:${r.caller_line})`;
    if (!byCaller.has(key)) byCaller.set(key, []);
    byCaller.get(key)!.push(r);
  }

  console.log(pc.white(`\nFound ${refs.length} reference(s) from ${byCaller.size} caller(s):`));
  for (const [caller, refs] of byCaller) {
    console.log(pc.cyan(`\n  ${caller}:`));
    for (const r of refs.slice(0, 5)) {
      console.log(pc.dim(`    ${r.callee_name} at ${r.callee_file}:${r.callee_line}`));
    }
    if (refs.length > 5) {
      console.log(pc.dim(`    ... and ${refs.length - 5} more`));
    }
  }
}

async function handleGetDefinition(symbol: string): Promise<void> {
  const indexDbPath = getIndexDbPath();

  if (!fs.existsSync(indexDbPath)) {
    console.log(pc.yellow('[WARN] No index found. Run /index first.'));
    return;
  }

  const { initIndexDb, findDefinitions } = await import('./indexing/fts.js');
  const db = initIndexDb(indexDbPath);

  console.log(pc.bold(`\n--- Definition: ${symbol} ---`));
  const defs = findDefinitions(db, symbol, projectHash);

  if (defs.length === 0) {
    console.log(pc.gray('  No definitions found.'));
    return;
  }

  console.log(pc.white(`\nFound ${defs.length} definition(s):`));
  for (const d of defs) {
    const kindColor = d.kind === 'function' ? pc.cyan : d.kind === 'class' ? pc.green : d.kind === 'interface' ? pc.blue : pc.white;
    const loc = `${d.file_path}:${d.line_start}${d.line_end !== d.line_start ? '-' + d.line_end : ''}`;
    console.log(`  ${kindColor(`[${d.kind}]`)} ${pc.bold(d.name)} ${pc.dim(`(${loc})`)}`);
    if (d.signature) {
      console.log(pc.dim(`    ${d.signature.slice(0, 120)}${d.signature.length > 120 ? '...' : ''}`));
    }
  }
}
function truncateToolResult(content: string): string {
  if (content.length <= TOOL_RESULT_MAX_CHARS) return content;
  const kept = content.slice(0, TOOL_RESULT_MAX_CHARS);
  const dropped = content.length - TOOL_RESULT_MAX_CHARS;
  return `${kept}\n... [truncated ${dropped} chars — use read_file with offset/limit to see more]`;
}

// ── Version update check ──────────────────────────────────────────────────────

const UPDATE_CACHE_PATH = path.join(os.homedir(), '.daedalus', 'temp', 'version-check.json');

function parseVersion(v: string): number[] {
  return v.replace(/^v/, '').split('.').map(Number);
}

function isNewerVersion(latest: string, current: string): boolean {
  const l = parseVersion(latest);
  const c = parseVersion(current);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const lv = l[i] || 0;
    const cv = c[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

async function checkForUpdates(): Promise<void> {
  try {
    // Check cache — only re-fetch every 24 hours
    if (fs.existsSync(UPDATE_CACHE_PATH)) {
      const cached = JSON.parse(fs.readFileSync(UPDATE_CACHE_PATH, 'utf8'));
      if (Date.now() - cached.timestamp < 86_400_000) {
        if (cached.latest && isNewerVersion(cached.latest, APP_VERSION)) {
          console.log(pc.cyan(`\n  ⬆ Update available: ${pc.bold(cached.latest)} (you have ${APP_VERSION})`));
          console.log(pc.dim(`  Run ${pc.cyan('npm update -g daedalus-cli')} to upgrade`));
        }
        return;
      }
    }

    const res = await fetch('https://registry.npmjs.org/daedalus-cli/latest');
    if (!res.ok) return;
    const data: any = await res.json();
    const latest = data.version;

    // Cache result
    fs.mkdirSync(path.dirname(UPDATE_CACHE_PATH), { recursive: true });
    fs.writeFileSync(UPDATE_CACHE_PATH, JSON.stringify({ latest, timestamp: Date.now() }), 'utf8');

    if (isNewerVersion(latest, APP_VERSION)) {
      console.log(pc.cyan(`\n  ⬆ Update available: ${pc.bold(latest)} (you have ${APP_VERSION})`));
      console.log(pc.dim(`  Run ${pc.cyan('npm update -g daedalus-cli')} to upgrade`));
    }
  } catch {
    // Network failure, stale cache, etc. — silently ignore
  }
}

// Streaming response handler with tool call support — iterative, not recursive
const MAX_TOOL_TURNS = 40;

async function callModelWithTools(
  userContent: string,
  imageBase64?: string,
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  // Push the user message as-is — callers in chatLoop are responsible for
  // pre-augmenting userContent with file context and index context.
  if (userContent) {
    if (imageBase64) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userContent },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
        ],
      } as any);
    } else {
      messages.push({ role: 'user', content: userContent });
    }
  }

  // Combine built-in tools with MCP tools (stable across turns)
  const allTools = [...BUILTIN_TOOLS, ...mcpRegistry.getToolDefinitions()];

  turnStartTime = Date.now();

  let lastContent = '';
  let turn = 0;

  while (turn < MAX_TOOL_TURNS) {
    const spinner = new DaedalusSpinner({ text: 'Daedalus thinking', color: (s) => pc.cyan(s) });
    spinner.start();

    let fullContent = '';
    const toolCallMap: Map<number, ToolCall> = new Map();
    let blockOpened = false;
    const turnStart = Date.now();

    const openBlock = () => {
      if (!blockOpened) {
        blockOpened = true;
        spinner.stop();
        openAssistantBlock();
      }
    };

    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    try {
      const stream = await router.chatStream({
        model: 'auto',
        messages: messages as any,
        temperature: 0.1,
        tools: allTools,
        tool_choice: 'auto',
        stream: true,
        signal,
      });

      for await (const chunk of stream) {
        if (signal.aborted) break;
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        if (delta.content) {
          openBlock();
          fullContent += delta.content;
          writeAssistantChunk(delta.content);
        }

        if (delta.tool_calls) {
          openBlock();
          for (const tc of delta.tool_calls) {
            const index = tc.index ?? 0;
            if (!toolCallMap.has(index)) {
              toolCallMap.set(index, {
                id: tc.id ?? `call_${Date.now()}_${index}`,
                type: 'function',
                function: { name: '', arguments: '' },
              });
            }
            const call = toolCallMap.get(index)!;
            if (tc.function?.name) call.function.name = tc.function.name;
            if (tc.function?.arguments) call.function.arguments += tc.function.arguments;
          }
        }

        if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop' || choice.finish_reason === 'length') {
          break;
        }
      }

      // Ensure spinner is stopped even if no output was produced
      if (!blockOpened) spinner.stop();

      // Check for user cancellation
      if (signal.aborted) {
        if (blockOpened) closeAssistantBlock(fullContent.length, Date.now() - turnStart);
        console.log(pc.dim('\n  [STOP] Stopped'));
        currentAbortController = null;
        return { content: fullContent, toolCalls: [] };
      }

    } catch (error: any) {
      if (signal.aborted) {
        spinner.stop();
        console.log(pc.dim('\n  [STOP] Stopped'));
        currentAbortController = null;
        return { content: '', toolCalls: [] };
      }
      spinner.stop();
      console.error(pc.red(`\n[ERROR] Error calling model: ${error.message}`));
      throw error;
    }

    currentAbortController = null;

    const toolCallArray = Array.from(toolCallMap.values()).filter(tc => tc.function.name);
    lastContent = fullContent;

    // Close assistant block after streaming, before tool results
    if (blockOpened) {
      closeAssistantBlock(fullContent.length, Date.now() - turnStart, toolCallArray.length);
    }

    if (toolCallArray.length === 0) {
      // No tool calls — model is done
      messages.push({ role: 'assistant', content: fullContent });
      return { content: fullContent, toolCalls: [] };
    }

    // Push assistant turn with tool calls
    messages.push({
      role: 'assistant',
      content: fullContent || '',
      tool_calls: toolCallArray,
    });

    // Ask user before executing dangerous tools
    const dangerousTools = ['terminal', 'write_file'];
    let turnApproved = false;
    const approvedCallIndices = new Set<number>();

    for (let i = 0; i < toolCallArray.length; i++) {
      const tc = toolCallArray[i];
      if (dangerousTools.includes(tc.function.name) && !turnApproved) {
        const args = tc.function.arguments;
        const preview = args.length > 120 ? args.slice(0, 120) + '...' : args;
        process.stdout.write(`\n  ${pc.yellow('[WARN]')} ${pc.bold(tc.function.name)} ${pc.dim(preview)}\n`);
        const line = await askLine(`  ${pc.dim('Allow? [y]es / [n]o / [a]ll for this turn: ')}`);
        const char = line.trim().toLowerCase().slice(0, 1);
        if (char === 'a') turnApproved = true;
        if (char === 'n') {
          console.log(`  ${pc.red('[FAIL]')} ${tc.function.name} ${pc.red(' — rejected')}`);
          continue;
        }
      }
      approvedCallIndices.add(i);
    }

    const approvedCalls = toolCallArray.filter((_, i) => approvedCallIndices.has(i));

    console.log(`\n  ${pc.dim('[TOOL]')} ${pc.dim(`Executing ${approvedCalls.length} tool call(s)...`)}`);
    const results = await executeToolCalls(approvedCalls, toolContext);

    for (const result of results) {
      messages.push({
        role: 'tool',
        content: truncateToolResult(result.content),
        tool_call_id: result.toolCallId,
      } as ChatMessage);

      const status = result.success ? pc.green('✔') : pc.red('✗');
      console.log(`  ${status} ${result.name}`);
      if (!result.success && result.error) {
        console.log(pc.red(`     Error: ${result.error}`));
      }
      // Show inline preview of successful tool results
      if (result.success && result.content) {
        const contentStr = result.content;
        const lines = contentStr.split('\n');
        const previewLines = lines.slice(0, 3);
        for (const line of previewLines) {
          const truncated = line.length > 120 ? line.slice(0, 120) + '…' : line;
          if (truncated.trim()) console.log(`  ${pc.dim('┃')} ${pc.gray(truncated)}`);
        }
        if (lines.length > 3) {
          console.log(`  ${pc.dim('┃')} ${pc.dim(`… ${lines.length - 3} more line${lines.length - 3 > 1 ? 's' : ''}`)}`);
        }
      }
    }

    turn++;
  }

  // Reached max turns without a clean stop
  console.log(`\n  ${pc.yellow('[WARN]')} ${pc.yellow(`Reached max tool turns (${MAX_TOOL_TURNS}). Stopping.`)}`);
  messages.push({ role: 'assistant', content: lastContent });
  return { content: lastContent, toolCalls: [] };
}

// Fallback: Structured output for models without tool support
async function callModelWithFallback(userContent: string, imageBase64?: string): Promise<string> {
  if (imageBase64) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userContent },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
      ],
    } as any);
  } else {
    messages.push({ role: 'user', content: userContent });
  }

  console.log(pc.gray('[THINK] Thinking (fallback mode)...'));

  try {
    const response = await router.chat.completions.create({
      model: 'auto',
      messages: messages as any,
      temperature: 0.1,
    });

    const reply = (response.choices[0] as any).message?.content || '';
    messages.push({ role: 'assistant', content: reply });
    openAssistantBlock();
    writeAssistantChunk(reply);
    const usage = (response as any).usage;
    const elapsed = Date.now() - turnStartTime;
    closeAssistantBlock(reply.length, elapsed);
    return reply;
  } catch (error: any) {
    console.error(pc.red(`\n[ERROR] Fallback error: ${error.message}`));
    throw error;
  }
}

// Single-line prompt (approval gate, commit message)
function askLine(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

// Multi-line input for main chat prompt — captures pasted text beyond the first newline.
// Uses a timing heuristic: lines arriving within 80ms are treated as part of a single paste.
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

// ── Clipboard helpers ──────────────────────────────────────────────────────────

function getClipboardText(): string {
  try {
    if (process.platform === 'win32') {
      return execSync('powershell -noprofile -command "Get-Clipboard"', { timeout: 5000, encoding: 'utf8' }).trim().slice(0, 100_000);
    } else if (process.platform === 'darwin') {
      return execSync('pbpaste', { timeout: 5000, encoding: 'utf8' }).trim().slice(0, 100_000);
    } else {
      return execSync('xclip -o -selection clipboard', { timeout: 5000, encoding: 'utf8' }).trim().slice(0, 100_000);
    }
  } catch {
    return '';
  }
}

function getClipboardImage(): string | null {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  const outPath = path.join(cliTempDir, `paste-${timestamp}-${random}.png`);
  try {
    if (process.platform === 'win32') {
      const safePath = outPath.replace(/[^a-zA-Z0-9_:.\\-]/g, '');
      const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img) {
  $img.Save('${safePath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output 'ok'
}`;
      const scriptPath = path.join(cliTempDir, `clip-img-${timestamp}-${random}.ps1`);
      fs.writeFileSync(scriptPath, psScript, 'utf8');
      const result = execSync(`powershell -noprofile -ExecutionPolicy Bypass -File "${scriptPath}"`, { timeout: 8000, encoding: 'utf8' }).trim();
      try { fs.unlinkSync(scriptPath); } catch {}
      if (result === 'ok' && fs.existsSync(outPath)) return outPath;
    } else if (process.platform === 'darwin') {
      execSync(`pngpaste "${outPath}"`, { timeout: 5000 });
      if (fs.existsSync(outPath)) return outPath;
    } else {
      const imgData = execSync(`xclip -selection clipboard -t image/png -o`, { timeout: 5000, encoding: 'buffer' }) as Buffer;
      if (imgData && imgData.length > 0) {
        fs.writeFileSync(outPath, imgData);
        return outPath;
      }
    }
  } catch {
    // No image in clipboard
  }
  return null;
}

// ── Visual formatting helpers ──────────────────────────────────────────────────

const termW = Math.max(50, (process.stdout.columns ?? 80) - 5);

function wrapLine(line: string, maxW: number): string[] {
  if (line.length <= maxW) return [line];
  const words = line.split(' ');
  const result: string[] = [];
  let cur = '';
  for (const word of words) {
    if (cur && cur.length + 1 + word.length <= maxW) {
      cur += ' ' + word;
    } else {
      if (cur) result.push(cur);
      cur = word;
      while (cur.length > maxW) {
        result.push(cur.slice(0, maxW));
        cur = cur.slice(maxW);
      }
    }
  }
  if (cur) result.push(cur);
  return result;
}

function printUserTurn(userMessage: string): void {
  const bdr = (s: string) => pc.dim(pc.yellow(s));
  const lines = userMessage.split('\n');
  const w = termW;
  console.log(`\n  ${bdr('╭─')} ${pc.yellow(pc.bold('⬡ You'))} ${bdr('─'.repeat(Math.max(0, w - 6)))}${bdr('╮')}`);
  for (const line of lines) {
    for (const part of wrapLine(line, w)) {
      console.log(`  ${bdr('│')} ${pc.white(part)}${' '.repeat(Math.max(0, w - part.length))}${bdr('│')}`);
    }
  }
  console.log(`  ${bdr('╰')}${bdr('─'.repeat(w + 1))}${bdr('╯')}`);
  console.log();
}

let _assistantLineBuf = '';

function openAssistantBlock(): void {
  const bdr = (s: string) => pc.dim(pc.cyan(s));
  const w = termW;
  console.log(`  ${bdr('╭─')} ${pc.dim('◇')} ${pc.dim('Daedalus')} ${bdr('─'.repeat(Math.max(0, w - 12)))}${bdr('╮')}`);
}

function writeAssistantChunk(chunk: string): void {
  _assistantLineBuf += chunk;
  const lines = _assistantLineBuf.split('\n');
  _assistantLineBuf = lines.pop() || '';
  const bdr = (s: string) => pc.dim(pc.cyan(s));
  const w = termW;
  for (const line of lines) {
    for (const part of wrapLine(line, w)) {
      console.log(`  ${bdr('│')} ${pc.white(part)}${' '.repeat(Math.max(0, w - part.length))}${bdr('│')}`);
    }
  }
}

function closeAssistantBlock(tokens: number, elapsedMs: number, toolCount?: number): void {
  const bdr = (s: string) => pc.dim(pc.cyan(s));
  const w = termW;
  if (_assistantLineBuf) {
    for (const part of wrapLine(_assistantLineBuf, w)) {
      console.log(`  ${bdr('│')} ${pc.white(part)}${' '.repeat(Math.max(0, w - part.length))}${bdr('│')}`);
    }
    _assistantLineBuf = '';
  }
  const meta = toolCount !== undefined
    ? `${toolCount} tool(s)  ·  ~${Math.round(tokens / 4)}t out  ·  ${elapsedMs}ms`
    : `~${Math.round(tokens / 4)}t out  ·  ${elapsedMs}ms`;
  console.log(`  ${bdr('╰')}${bdr('─'.repeat(w + 1))}${bdr('╯')}  ${pc.dim(meta)}`);
}

function turnSeparator(): void {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  console.log(`  ${pc.dim('─'.repeat(58))} ${pc.dim(ts)}`);
}

// Main chat loop — iterative, no recursive Promise chains
async function chatLoop(): Promise<void> {
  while (true) {
    const prompt = activeFiles.size > 0
      ? `\n${pc.cyan('  ⬡')} ${pc.dim(`[${activeFiles.size} file${activeFiles.size > 1 ? 's' : ''}]`)} ${pc.bold(pc.white('›'))} `
      : `\n${pc.cyan('  ⬡')} ${pc.bold(pc.white('›'))} `;
    const input = await readMultiLineInput(prompt);
    const trimmedInput = input.trim();
    if (!trimmedInput) continue;

    const lowerInput = trimmedInput.toLowerCase();

    // Handle Exit
    if (lowerInput === 'exit' || lowerInput === 'quit') {
      const todos = getSessionTodos(sessionId);
      sessionManager.saveSessionState(messages, activeFiles, todos);
      console.log(pc.dim('  [EXTRACT] Extracting facts from session...'));
      await extractAndSave(router as any, sessionManager, messages);
      console.log(pc.gray(`Session saved: ${sessionManager.sessionId}`));
      console.log(pc.yellow('\nEnding session. Goodbye!\n'));
      rl.close();
      process.exit(0);
    }

    // Command quickref
    if (lowerInput === '?' || lowerInput === 'help') {
      console.log(`\n  ${pc.bold('Commands')}`);
      console.log(`  ${pc.dim('────────────────────────────────────')}`);
      console.log(`  ${pc.cyan('/add')}      Add file to context`);
      console.log(`  ${pc.cyan('/remove')}   Remove file from context`);
      console.log(`  ${pc.cyan('/context')}  Show active file context`);
      console.log(`  ${pc.cyan('/commit')}   Stage and commit changes`);
      console.log(`  ${pc.cyan('/undo')}     Undo last file patch`);
      console.log(`  ${pc.cyan('/paste')}   Paste clipboard text/image as message`);
      console.log(`  ${pc.cyan('/test')}     Run tests and auto-fix failures`);
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

    // Command: /add <file>
    if (trimmedInput.startsWith('/add ')) {
      const fileArg = trimmedInput.substring(5).trim();
      if (!fileArg) {
        console.log(pc.red('[WARN] Please specify a file path. Example: /add src/App.tsx'));
      } else {
        const absPath = path.resolve(fileArg);
        activeFiles.set(absPath, fileArg);
        toolContext.activeFiles = new Map(activeFiles);
        console.log(pc.green(`[OK] Added file to context: ${pc.bold(fileArg)}`));
      }
      continue;
    }

    // Command: /remove <file>
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

    // Command: /paste — paste clipboard content (text or image)
    if (lowerInput === '/paste' || lowerInput.startsWith('/paste ')) {
      const extra = trimmedInput.startsWith('/paste ') ? trimmedInput.substring(7).trim() : '';

      // If extra looks like a file path, try reading it as an image
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
              console.error(pc.red(`\n[ERROR] Error: ${error.message}`));
              try {
                const filesContext = buildFileContext();
                const userContent = `${filesContext}User Prompt: ${message}`;
                console.log(pc.yellow('\n[RETRY] Trying fallback mode...'));
                await callModelWithFallback(userContent, base64);
                sessionManager.saveSessionState(messages, activeFiles, getSessionTodos(sessionId));
              } catch (fallbackErr: any) {
                console.error(pc.red(`\n[ERROR] Fallback also failed: ${fallbackErr.message}`));
              }
            }
            turnSeparator();
            continue;
          }
        }
      }

      // Try image first
      const imgPath = getClipboardImage();
      if (imgPath) {
        const imgBuffer = fs.readFileSync(imgPath);
        fs.unlinkSync(imgPath); // Clean up temp file
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
          console.error(pc.red(`\n[ERROR] Error: ${error.message}`));
          try {
            const filesContext = buildFileContext();
            const userContent = `${filesContext}User Prompt: ${message}`;
            console.log(pc.yellow('\n[RETRY] Trying fallback mode...'));
            await callModelWithFallback(userContent, base64);
            sessionManager.saveSessionState(messages, activeFiles, getSessionTodos(sessionId));
          } catch (fallbackErr: any) {
            console.error(pc.red(`\n[ERROR] Fallback also failed: ${fallbackErr.message}`));
          }
        }
        turnSeparator();
        continue;
      }

      // Fall back to text
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
        console.error(pc.red(`\n[ERROR] Error: ${error.message}`));
      }
      turnSeparator();
      continue;
    }

    // Command: /context
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

    // Command: /session list|load|new|delete
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

    // Command: /memory
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

    // Command: /fact <key> = <value>
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

    // Command: /convention <key> = <value>
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

    // Command: /extract — manually trigger fact extraction
    if (lowerInput === '/extract') {
      console.log(pc.dim('  [EXTRACT] Extracting facts from conversation...'));
      await extractAndSave(router as any, sessionManager, messages);
      continue;
    }

    // Command: /profile
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

    // Command: /style
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

    // Command: /clear
    if (lowerInput === '/clear') {
      messages.length = 0;
      messages.push({ role: 'system', content: getSystemPromptWithMemory() });
      console.log(pc.green('[OK] Conversation history cleared!'));
      continue;
    }

    // Command: /tools
    if (lowerInput === '/tools') {
      console.log(pc.bold('\n--- Available Tools ---'));
      BUILTIN_TOOLS.forEach(t => {
        console.log(`  • ${pc.cyan(t.function.name)}: ${t.function.description}`);
      });
      const mcpTools = mcpRegistry.getToolDefinitions();
      if (mcpTools.length > 0) {
        console.log(pc.bold('\n--- MCP Tools ---'));
        mcpTools.forEach(t => {
          console.log(`  • ${pc.cyan(t.function.name)}: ${t.function.description}`);
        });
      }
      console.log(pc.bold('-----------------------'));
      continue;
    }

    // Command: /spawn <role> <task>
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

    // Command: /delegate <task> to <role>
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

    // Command: /orchestrate <goal>
    if (lowerInput.startsWith('/orchestrate ')) {
      const goal = trimmedInput.substring(13).trim();
      if (!goal) {
        console.log(pc.red('[WARN] Usage: /orchestrate <goal>'));
      } else {
        await handleOrchestrate(goal);
      }
      continue;
    }

    // Command: /models
    if (lowerInput === '/models') {
      await handleModels();
      continue;
    }

    // Command: /config
    if (lowerInput === '/config') {
      handleConfig();
      continue;
    }

    // Command: /doctor
    if (lowerInput === '/doctor') {
      await handleDoctor();
      continue;
    }

    // Command: /onboard
    if (lowerInput === '/onboard') {
      console.log(pc.cyan('\n[RESTART] Re-running onboarding wizard...\n'));
      await runOnboarding(true);
      continue;
    }

    // Command: /undo — revert the last patch
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

    // Command: /commit — stage and commit changes
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
              const suggested = ((aiResponse.choices[0] as any)?.message?.content || '').trim().split('\n')[0].trim();
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

    // Command: /project — show/edit project-level config
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
        (cfg as any)[key] = value;
        saveProjectConfig(cfg);
        console.log(pc.green(`[OK] Set ${key} = ${value}`));
      }
      continue;
    }

    // Command: /test — run tests and auto-fix failures (TDD loop)
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

    // Command: /index [options]
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

    // Command: /find <query> [limit]
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

    // Command: /refs <symbol>
    if (lowerInput.startsWith('/refs ')) {
      const symbol = trimmedInput.substring(6).trim();
      if (!symbol) {
        console.log(pc.red('[WARN] Usage: /refs <symbol>'));
      } else {
        await handleGetReferences(symbol);
      }
      continue;
    }

    // Command: /def <symbol>
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

      // Persist session incrementally after every turn
      sessionManager.saveSessionState(messages, activeFiles, getSessionTodos(sessionId));

      // Fact extraction — learns from tool results and reasoning
      await extractAndSave(router as any, sessionManager, messages);
    } catch (error: any) {
      console.error(pc.red(`\n[ERROR] Error: ${error.message}`));
      try {
        const filesContext = buildFileContext();
        const userContent = `${filesContext}User Prompt: ${trimmedInput}`;
        console.log(pc.yellow('\n[RETRY] Trying fallback mode...'));
        const fallbackResult = await callModelWithFallback(userContent);
        if (fallbackResult) {
          // Persist session after fallback too
          sessionManager.saveSessionState(messages, activeFiles, getSessionTodos(sessionId));
          await extractAndSave(router as any, sessionManager, messages);
        }
      } catch (fallbackErr: any) {
        console.error(pc.red(`\n[ERROR] Fallback also failed: ${fallbackErr.message}`));
        console.error(pc.gray('Check that at least one local server is running.'));
      }
    }
    turnSeparator();
  }
}

// Start health checks and REPL
async function main() {
  process.on('SIGINT', () => {
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
    router.stopHealthChecks?.();
  });

  // Print the awesome banner first!
  printBanner();
  printConfigInfo();
  
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
    setTimeout(() => checkForUpdates(), 2000);
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
        } catch (err: any) {
          console.error(pc.yellow(`  [WARN] Auto-index failed: ${err.message}`));
        }
      })();
    }, 100);
  }

  await chatLoop();
}

main().catch(console.error);