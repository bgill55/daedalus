#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import readline from 'readline';
import os from 'os';
import pc from 'picocolors';
import { execSafe } from './utils/spawn.js';
import { brand, dim, info, ok, warn, err } from './ui/theme.js';

import { setRouterClient } from './tools/builtin/delegation.js';
import { setRouteRouterClient, looksMultiPhase } from './tools/builtin/route.js';
import { createRouter, RouterConfig } from './router/index.js';
import { loadConfig, getConfigDirPath } from './config/index.js';
import { detectProjectStack, classifyStack } from './config/stack.js';
import { ToolContext, ChatMessage, ToolDefinition, ToolCall } from './types.js';
import { setSessionTodos } from './tools/builtin/todo.js';
import { SessionManager } from './session/manager.js';
import { loadProfile, getProfilePrompt, UserProfile } from './profile.js';
import { printBanner, printConfigInfo } from './banner.js';
import { getTipOfDay } from './tips.js';
import { checkForUpdates, checkChangelogOnUpgrade } from './update-check.js';
import { createModelFunctions, currentAbortController, abortTurn } from './model.js';
import { SigmaMemEngine } from './session/sigma-mem.js';
import { runBuildVerification } from './agents/orchestrator-verification.js';
import { createRepl } from './repl.js';
import { setFormattingConfig } from './formatting.js';
import { getProjectRules, systemPrompt } from './system-prompt.js';
import { getConstitutionSummary } from './config/constitution.js';
import { getSkillsSection, initSkillClassifier } from './skills/index.js';
import { BoundedMap } from './utils/bounded-map.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Save true original stream writes to global context for crash recovery
const _global = globalThis as { originalStdoutWrite?: typeof process.stdout.write; originalStderrWrite?: typeof process.stderr.write };
_global.originalStdoutWrite = process.stdout.write;
_global.originalStderrWrite = process.stderr.write;

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

const isCi = process.argv.includes('--ci');
if (isCi) {
  // CI/review mode: suppress ANSI color codes so captured stdout is clean
  // (e.g. when posted as a PR comment) and never present an interactive banner.
  process.env.NO_COLOR = '1';
}

// One-shot mode: `daedalus --goal "..."` or `daedalus run "..."` runs exactly
// one autonomous turn then exits. Non-interactive by design (headless/CI/batch).
// (A bare positional arg is intentionally NOT a goal — it is handled separately
// as a file to open, see initialArgs below.)
function parseGoalArg(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--goal' || a === '-g' || a === 'run') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) return next;
    } else if (a.startsWith('--goal=')) {
      return a.slice('--goal='.length);
    } else if (a.startsWith('-g=')) {
      return a.slice('-g='.length);
    }
  }
  return undefined;
}
const oneShotGoal = parseGoalArg(process.argv.slice(2));
if (oneShotGoal !== undefined) {
  // Force auto-approve so the single turn cannot stall on a plan/tool prompt.
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

let activeSigmaMemoryIds: string[] = [];



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
  sessionReadCache: new BoundedMap<string, number>(1000),
  patchFailureStreak: new BoundedMap<string, number>(1000),
};

// Enable delegation tool
setRouterClient(router);
setRouteRouterClient(router);

// MCP registry singleton ref — set after connectAll(), used by getSystemPromptWithMemory
let mcpRegistryRef: { getConnectedServers: () => string[]; getToolDefinitions: () => ToolDefinition[] } | null = null;

// Tracks the last request we already nudged about, so the nudge appears once
// per qualifying task rather than on every model turn for the same request.
let lastNudgeRequest = '';

// Build system prompt with project memory and user profile
// Tracks the current user request so the (per-turn) system prompt can inject
// matching skills even when getSystemPromptWithMemory() is called without an
// explicit argument (e.g. on context refresh mid-turn).
let currentUserRequest = '';

async function getSystemPromptWithMemory(userRequest?: string): Promise<string> {
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
        prompt += '\nREAD BEFORE WRITE: If the user asks you to read a file, listing a directory, or any read-only operation, use the appropriate read/query tool. Do NOT call write_file (or any MCP equivalent) to output the contents — they are returned automatically by the read tool. write_file is only for creating or modifying files.\n';
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
  if (sessionManager?.projectMemDb || sessionManager?.projectRoot) {
    const sigmaDb = SigmaMemEngine.resolveProjectMemDb(sessionManager, sessionManager.projectRoot);
    if (sigmaDb) {
      const sigmaRes = SigmaMemEngine.getPromptContext(sigmaDb, config.agents?.default ?? undefined, 0.60, 5, Array.from(activeFiles.values()));
      if (sigmaRes.prompt) {
        prompt += '\n' + sigmaRes.prompt;
      }
      activeSigmaMemoryIds = sigmaRes.activeMemoryIds;
      SigmaMemEngine.markMemoriesUsed(sigmaDb, activeSigmaMemoryIds);
    }
  }
  const stackPrompt = detectProjectStack(sessionManager.projectRoot);
  if (stackPrompt) {
    prompt += '\n' + stackPrompt;
  }
  const projectRules = getProjectRules(sessionManager.projectRoot);
  if (projectRules) {
    prompt += '\n' + projectRules;
  }

  // Codebase Constitution: programmatic, non-bypassable execution contracts that
  // govern agent tool calls, patch verification, and multi-agent orchestration.
  const constitution = getConstitutionSummary();
  if (constitution) {
    prompt += `\n\n## DAEDALUS CODEBASE CONSTITUTION\nThese principles are hard constraints on every action you take. The mechanisms that enforce them (test-suite lock, pre-flight dependency check, deterministic verification, git checkpoints, reviewer audit) are active — do not attempt to bypass them.\n${constitution}`;
  }

  // BETA: load-only skill playbooks (instructions only, trusted locations only)
  const req = userRequest ?? currentUserRequest ?? '';
  const skillsSection = await getSkillsSection(req);
  if (skillsSection) {
    prompt += skillsSection;
  }

  // Heuristic routing nudge: when the active agent is the coder (the role that
  // owns route_task) OR the configured single-agent default role, and the user's
  // request looks like a large multi-phase task, remind it that it may propose
  // routing to helper agents. Fired at most once per distinct qualifying request
  // so it doesn't repeat every turn. The agent still must ask the user for
  // permission before calling route_task.
  const nudgedRole = config.agents?.default ?? 'coder';
  if (userRequest && (toolContext.agentRole === 'coder' || toolContext.agentRole === nudgedRole) && looksMultiPhase(userRequest) && lastNudgeRequest !== userRequest) {
    lastNudgeRequest = userRequest;
    prompt += '\n\n## ROUTING NUDGE\nThis request looks like a multi-phase task. Remember you can propose routing independent pieces to helper agents (researcher / planner / reviewer / debugger) via `route_task` — but you MUST ask the user for approval with `ask_user` first, then call it with `confirmed: true`. Only route genuinely independent sub-tasks.';
  }

  // Non-interactive / autonomous mode: when autoApprovePlans is on (headless
  // test runs, CI), the agent must not stop to ask "Would you like me to proceed
  // with this plan?". It proceeds directly with implementation so a piped-stdin
  // session completes without stalling on an approval prompt it can't answer.
  if (config.safety?.autoApprovePlans) {
    prompt += '\n\n## AUTONOMOUS MODE (plans auto-approved)\nYou are running in non-interactive mode. Do NOT ask "Would you like me to proceed with this plan?" — proceed directly with implementation after presenting a brief plan. Treat every plan as pre-approved. Do not wait for user confirmation at any step.';
  }

  return prompt;
}

messages.push({ role: 'system', content: await getSystemPromptWithMemory() });

// Parse initial arguments (e.g. if started as `daedalus src/index.ts`)
const initialArgs = process.argv.slice(2).filter(a => !a.startsWith('-') && !a.startsWith('/'));
if (initialArgs.length > 0) {
  initialArgs.forEach(fileArg => {
    const absPath = path.resolve(fileArg);
    activeFiles.set(absPath, fileArg);
    toolContext.activeFiles = new Map(activeFiles);
    if (!isCi) {
      console.log(ok(`✔ Added file on startup: ${pc.bold(fileArg)}`));
    }
  });
}

// Build file context for LLM
function buildFileContext(): string {
  if (activeFiles.size === 0) return '';
  let ctx = '--- ACTIVE FILES CONTEXT ---\n';
  for (const [absPath, filename] of activeFiles) {
    let content: string;
    if (fs.existsSync(absPath)) {
      const ext = path.extname(absPath).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
        content = `[Binary Image File: ${filename} (${ext.toUpperCase().slice(1)}) — Note: Text-only model active. To process vision, use a vision-enabled model]`;
      } else {
        content = fs.readFileSync(absPath, 'utf8');
      }
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

const { callModelWithTools: rawCallModelWithTools, callModelWithFallback } = createModelFunctions({
  messages,
  config,
  router,
  toolContext,
  buildFileContext,
  askLine,
  refreshSystemPrompt: async () => {
    if (messages.length > 0 && messages[0].role === 'system') {
      messages[0] = { role: 'system', content: await getSystemPromptWithMemory() };
    }
  },
});

// Wire the skill classifier to the router (gated LLM seed-matching, Part B).
// classifySkillsWithModel only fires when the offline scorer finds nothing.
try {
  initSkillClassifier((opts) => router.chatCompletion(opts));
} catch {
  // Classifier disabled if router isn't ready; skills fall back to Option A only.
}

// Σ-Mem feedback proxy — rewards/penalizes active Σ-memories from patch outcomes per single-agent turn
async function callModelWithTools(userContent: string, imageBase64?: string): Promise<{ content: string; toolCalls: ToolCall[] }> {
  currentUserRequest = userContent;
  const prevPatches = toolContext.patchHistory?.length ?? 0;
  // Branch from base at the start of a single-agent task when the user opted in.
  // Only acts when sitting on the base branch with a clean tree, so it never
  // clobbers a branch the user deliberately checked out. Idempotent: once on a
  // work branch, subsequent turns are no-ops.
  if (config.git?.autoBranchFromBase) {
    try {
      const { ensureBranchFromBase } = await import('./git/safe-git.js');
      const branched = ensureBranchFromBase(toolContext.projectRoot);
      if (branched) {
        console.log(pc.green(`\n  ${ok('[OK]')} Branched from base into '${branched}' for this task.`));
      }
    } catch { /* branching must never break the turn */ }
  }
  const result = await rawCallModelWithTools(userContent, imageBase64);
  const memoryIds = activeSigmaMemoryIds;
  if (sessionManager?.projectMemDb) {
    try {
      const newPatches = toolContext.patchHistory?.length ?? 0;
      // Only grade a turn that actually changed source files — chat-only turns are
      // neither success nor failure. Mirror the multi-agent path (orchestrator.ts):
      // reliability rises on a VERIFIED green build and falls on a broken one. The
      // old signal was evaluatePatchOutcome (patch-count based) — it rewarded mere
      // editing activity, so a task that committed broken code still scored up. Now
      // a broken fix fails runBuildVerification and is penalized instead.
      if (newPatches > prevPatches && memoryIds.length > 0) {
        const root = toolContext.projectRoot || sessionManager?.projectRoot;
        const buildResult = await runBuildVerification({
          ...toolContext,
          projectRoot: root,
        });
        if (buildResult.success) {
          SigmaMemEngine.rewardSuccessfulPass(sessionManager.projectMemDb, memoryIds);
        } else {
          SigmaMemEngine.penalizeFailedAttempt(sessionManager.projectMemDb, memoryIds, buildResult.errorLogs?.slice(0, 280));
        }
      }
    } catch {
      // σ-mem feedback must never break the turn flow
    }
  }
  return result;
}

// Lazy repl — created inside main() after MCP connects, so piped stdin isn't consumed early
let chatLoop: () => Promise<void>;

async function main() {
  // Always restore canonical terminal mode (raw mode off) on every shutdown path.
  // A raw-mode feature that leaks (unrecognized key, exception, or an abort) would
  // otherwise leave the terminal stuck (^H/^C echo, no way to close it).
  const restoreTerminalMode = () => {
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
      if (process.stdin.isPaused()) process.stdin.resume();
    } catch { /* best-effort cleanup */ }
  };

  process.on('SIGINT', () => {
    if (indexWatcher) {
      indexWatcher.close();
    }
    if (currentAbortController) {
      abortTurn();
      restoreTerminalMode();
      // Return to the REPL in canonical mode rather than exiting — the user can
      // keep working. Raw mode must be off first or the REPL keys won't work.
      return;
    }
    router.stopHealthChecks?.();
    restoreTerminalMode();
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
    restoreTerminalMode();
  });

  // Belt-and-suspenders: if the process tears down for any other reason, make sure
  // the terminal is left usable.
  process.on('beforeExit', restoreTerminalMode);

  // Print the awesome banner first! (skip in CI/review mode so captured stdout stays clean)
  const enabledCount = config.router.chain.filter(m => m.enabled).length;
  if (!isCi) {
    printBanner(APP_VERSION);
    printConfigInfo(enabledCount, config.router.strategy, configDir + '/config.json');

    // Tip of the day (rotates daily, persisted under configDir)
    console.log(`  ${getTipOfDay(configDir)}`);

    // Load & log project-specific rules
    const filesToCheck = ['CLAUDE.md', '.cursorrules', '.daedalusrules', 'DAEDALUS.md'];
    for (const file of filesToCheck) {
      if (fs.existsSync(path.join(sessionManager.projectRoot, file))) {
        console.log(ok(`  ✔ Loaded project rules: ${pc.bold(file)}`));
      }
    }
  }

  // First-run detection: if no models configured, auto-trigger onboarding
  if (enabledCount === 0 && process.stdin.isTTY && !process.env.DAEDALUS_AUTO_APPROVE) {
    console.log(warn('\n  No models configured yet. Starting onboarding...\n'));
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
        rl: null as unknown as readline.Interface,
        initializeSessionState: () => {},
        buildFileContext,
        askLine,
        buildIndexContext: async () => '',
        getIndexDbPath,
      });
    }
  }
  
  // Start health checks (awaited so catalog-verified routing is live before turn 1)
  try {
    await router.startHealthChecks();
  } catch (err) {
    console.error(warn(`\n[WARN] Router health checks failed: ${(err as Error).message}`));
  }

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
        if (!isCi) {
          console.log(ok(`\nMCP connected: ${servers.join(', ')}`));
          console.log(dim(`  ${mcpToolCount} MCP tool(s) registered`));
        }
      }
    }
  } catch (err: unknown) {
    console.error(warn(`\nMCP initialization failed: ${err instanceof Error ? err.message : String(err)}`));
  }

  const isLoop = process.argv.includes('--loop') || process.argv.includes('--daemon');
  if (isLoop) {
    const { startLoopDaemon } = await import('./agents/loop.js');
    await startLoopDaemon(toolContext, config, router, sessionManager);
    return;
  }

  if (isCi) {
    const { runHeadlessCiReview, runHeadlessCiFix } = await import('./ci.js');
    const isFix = process.argv.includes('fix');
    if (isFix) {
      const res = await runHeadlessCiFix(sessionManager.projectRoot);
      console.log(res.message);
      process.exit(res.success ? 0 : 1);
    } else {
      const res = await runHeadlessCiReview(sessionManager.projectRoot);
      console.log(res.markdownReport);

      // Post to GitHub PR if gh CLI is available — write to temp file to avoid shell escaping issues
      const prNumber = process.env.PR_NUMBER || process.argv.find(a => /^\d+$/.test(a));
      if (prNumber) {
        try {
          const tmpFile = path.join(os.tmpdir(), `daedalus-ci-review-${Date.now()}.md`);
          fs.writeFileSync(tmpFile, res.markdownReport, 'utf8');
          execSafe(`gh pr comment ${prNumber} --body-file "${tmpFile}"`, { cwd: sessionManager.projectRoot });
          fs.unlinkSync(tmpFile);
          console.log(`\n✔ Posted CI review comment to PR #${prNumber}`);
        } catch {
          // gh CLI not available or not in a PR context, skip posting
        }
      }

      process.exit(res.passed ? 0 : 1);
    }
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
            console.log(info(`  [INDEX] Indexed ${result.indexedFiles} file(s) (${result.skippedFiles} unchanged)`));
          }
          if (result.errors.length > 0) {
            console.log(warn(`  [WARN] ${result.errors.length} file(s) had index errors`));
          }
          toolContext.indexDb = db;

          if (config.indexing.watch) {
            const { watchCodebase } = await import('./indexing/watcher.js');
            indexWatcher = watchCodebase(db, sessionManager.projectRoot, sessionManager.projectHash, {
              exclude: config.indexing.exclude,
            });
          }
        } catch (err: unknown) {
          console.error(warn(`  [WARN] Auto-index failed: ${err instanceof Error ? err.message : String(err)}`));
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
        projectStackTags: [...classifyStack(sessionManager.projectRoot)],
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
        projectStackTags: [...classifyStack(sessionManager.projectRoot)],
        oneShotGoal,
      });
    }

    try {
      await chatLoop();
      if (oneShotGoal !== undefined) {
        // One-shot mode completed its single turn — exit cleanly.
        process.exit(0);
      }
      break;
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'SWITCH_MODE_CLI') {
        currentMode = 'cli';
        console.clear();
        console.log(brand('\n  Daedalus') + dim(' Returned to CLI mode... Type ? for commands.'));
        continue;
      }
      if (err instanceof Error && err.message === 'SWITCH_MODE_TUI') {
        currentMode = 'tui';
        console.clear();
        continue;
      }
      throw err;
    }
  }
}

main().catch((err) => {
  if (_global.originalStdoutWrite) {
    process.stdout.write = _global.originalStdoutWrite;
  }
  if (_global.originalStderrWrite) {
    process.stderr.write = _global.originalStderrWrite;
  }
  console.error(err);
  process.exit(1);
});
