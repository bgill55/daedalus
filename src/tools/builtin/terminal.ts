// Terminal execution tool

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import { DaedalusSpinner } from '../daedalus-spinner.js';
import { ToolContext, ToolResult } from '../../types.js';
import { loadConfig } from '../../config/index.js';
import { guardGitCommand } from '../git-guard.js';
import { guardCommitSecrets } from '../git-guard.js';
import { createGitCheckpoint } from '../git-checkpoint.js';
import { isTestFile, checkTestFileLock } from './patch-utils.js';

const SENSITIVE_ENV_KEYS = new Set([
  'AWS_SECRET_ACCESS_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SESSION_TOKEN',
  'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID',
  'GITHUB_TOKEN', 'GIT_TOKEN', 'NPM_TOKEN',
  'DATABASE_URL', 'DB_URL', 'MONGODB_URI', 'MYSQL_URL', 'PGURL',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY',
  'HF_TOKEN', 'HUGGINGFACE_TOKEN',
]);

const BLOCKED_ENV_KEYS = new Set([
  'NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES',
]);

// Commands that install third-party packages — requires DAEDALUS_ALLOW_INSTALL=true
const INSTALL_COMMAND_RE = /(?:^|\s)(?:npm\s+(?:install|i|ci|add)|npx\s|pip\d?\s+install|cargo\s+install|go\s+install|gem\s+install|brew\s+install|choco\s+install|winget\s+install|yarn\s+(?:add|install)|pnpm\s+(?:add|install|i|ci)|bun\s+(?:add|install)|npx\s+cypress|cypress\s+(?:run|open|install))(?:\s|$)/i;

// Commands that open GUI / interactive apps that should not run unattended
const GUI_LAUNCH_RE = /(?:^|\s)(?:cypress\s+open|cypress\s+run\s+--headed|playwright\s+test\s+--headed)(?:\s|$)/i;

// Block runaway backgrounded/dev-server commands. An agent will frequently try to
// "verify" a server by spawning `npx tsx src/server.ts & sleep 3` (or `npm run dev &`);
// the spawn times out, the model retries with a varied command, and the detached server
// process is never reaped — producing dozens of orphaned servers and burning huge token
// counts. Proactively refuse these and steer the agent to a one-shot verification command.
const DEV_SERVER_RE = /(?:^|\s)(?:npx\s+tsx(?:\s+watch)?\s+[\w./\-]+\.(?:ts|js|mjs)|npx\s+ts-node\s+[\w./\-]+\.(?:ts|js)|node\s+[\w./\-]+\.(?:ts|js|mjs)(?:\s|&)|npm\s+run\s+(?:dev|start|watch|serve)|yarn\s+(?:dev|start|watch|serve)|pnpm\s+(?:dev|start|watch|serve)|bun\s+(?:dev|start|watch|serve)|tsx\s+watch\s+[\w./\-]+|nodemon\s+[\w./\-]+)(?:\s|$)/i;
// A trailing `&` / `nohup` / `&>` backgrounds the process — always refuse.
const BACKGROUND_SPAWN_RE = /(?:^|\s)(?:nohup\s|&\s*(?:\d*>\s*\S+\s*)?$|\s+&\s*$)/;

// Captures the package name of a bare `npx <pkg>` invocation
const NPX_RE = /(?:^|\s)npx(?:\s|@)([A-Za-z0-9@._/+-]+)/;

function buildCheckpointNote(workdir: string): string {
  const cp = createGitCheckpoint(workdir);
  if (cp.ok && cp.hash) {
    return `\n[CHECKPOINT] Git snapshot created before install: ${cp.hash} — roll back with: git checkout ${cp.hash} -- .`;
  }
  return `\n[CHECKPOINT] skipped (${cp.reason ?? 'unknown'})`;
}

function buildNpxWarnNote(command: string, workdir: string): string {
  const match = command.match(NPX_RE);
  if (!match || !match[1]) return '';
  const pkg = match[1];
  let declared = false;
  try {
    const pkgPath = path.join(workdir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const allDeps = { ...parsed.dependencies, ...parsed.devDependencies };
      declared = pkg in allDeps;
    }
  } catch {
    // Ignore unreadable package.json
  }
  if (declared) return '';
  return `\n[WARN] '${pkg}' is not a declared dependency — npx will download the latest version, which may be incompatible. Prefer 'npm install --save-dev ${pkg}'.`;
}

function sanitizeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (BLOCKED_ENV_KEYS.has(key)) continue;
    if (SENSITIVE_ENV_KEYS.has(key)) continue;
    env[key] = value;
  }
  return env;
}

// Shell write operators that create or mutate a file. A terminal command that both
// names a test-file path and uses one of these is an attempt to write a test suite
// file via the shell — which would bypass the write_file/patchFile test-suite lock.
// We mirror that lock here so the protection is uniform across tools.
const TERMINAL_TEST_WRITE_OP_RE = /[>]\s*|>>\s*|<<\s*|\btee\b|\btouch\b|\bsed\s+-i\b/;

function extractTestFilePath(command: string): string | null {
  const norm = command.replace(/\\/g, '/');
  // Tokenize on whitespace/quotes/pipes so both `cat > tests/x.test.ts` and
  // glued forms like `cat>tests/x.test.ts` surface the path token.
  const tokens = norm.match(/[^\s'"()|&;]+/g) ?? [];
  for (const tok of tokens) {
    const cleaned = tok.replace(/^[>]+/, '').replace(/^['"]|['"]$/g, '');
    if (isTestFile(cleaned)) return cleaned;
  }
  return null;
}

// Blocks shell commands that write to a test-file path. Terminal `cat >` / `tee` /
// `touch` / `sed -i` / `cp` / `mv` are the known bypass vectors around the write_file/
// patchFile test-suite lock, so this gate blocks them unconditionally for any test
// path (there is no legitimate "scaffold a test via the shell" need — the agent should
// use the write_file tool, which allows first-time test creation but still locks
// MODIFYING an existing test file). Returns the same [TEST SUITE LOCK] message as the
// write_file/patchFile gate so the agent gets one consistent signal.
function checkTerminalTestWrite(command: string, context: ToolContext): string | null {
  const testPath = extractTestFilePath(command);
  if (!testPath) return null;
  const hasWriteOp =
    TERMINAL_TEST_WRITE_OP_RE.test(command) ||
    /\b(?:cp|mv)\b[^;|&]*(?:test|spec)[^;|&]*/i.test(command);
  if (!hasWriteOp) return null;
  if (context.allowTestEdits) return null;
  return (
    `[TEST SUITE LOCK] Writing to test file "${path.basename(testPath)}" via the terminal ` +
    `is blocked by default to prevent test-assertion weakening. Use the write_file tool to ` +
    `create the test, or include "update test" in your request. Do NOT attempt the write ` +
    `via cat > / tee / touch / sed -i / cp / mv to bypass this lock.`
  );
}

interface ShellConfig {
  shell: string;
  type: 'bash' | 'cmd' | 'powershell';
}

function getShellType(shellPath: string): 'bash' | 'cmd' | 'powershell' {
  const lower = shellPath.toLowerCase();
  if (lower.includes('powershell') || lower.includes('pwsh')) {
    return 'powershell';
  }
  if (lower.includes('cmd.exe') || lower.endsWith('cmd')) {
    return 'cmd';
  }
  return 'bash';
}

// Whether the resolved/active shell is a bash (Unix-compatible) interpreter. When true,
// Unix-style commands are passed through untouched; when false (cmd.exe on Windows), the
// caller should translate Unix-isms via translateUnixToCmd().
function isBashShell(): boolean {
  if (process.platform !== 'win32') return true;
  const envShell = process.env.DAEDALUS_SHELL || process.env.SHELL || '';
  let configShell: string | undefined;
  try {
    const config = loadConfig();
    configShell = config.tools?.shell;
  } catch { /* ignore */ }
  const shellRef = configShell || envShell;
  if (shellRef && /bash/i.test(shellRef)) return true;
  return false;
}

// Translate common Unix command-isms to Windows cmd.exe equivalents. Applied only when the
// active shell is cmd (not bash/git-bash). Handles the commands agents most often emit on
// a Unix assumption: ls, pwd, cat, cp, mv, mkdir -p, touch, grep, head, tail, rm (rm is
// handled separately via PowerShell). Pipeline-friendly: a leading Unix command in a chained
// command is translated; nested shells/quoted scripts are left alone.
export function translateUnixToCmd(command: string): string {
  let cmd = command;
  // /dev/null -> NUL
  cmd = cmd.replace(/\/dev\/null/g, 'NUL');
  // Convert single-quoted arguments/paths to double-quotes (cmd.exe treats ' as literal filename char)
  cmd = cmd.replace(/'([^']*)'/g, '"$1"');
  // export FOO=bar -> set FOO=bar
  cmd = cmd.replace(/\bexport\s+([A-Za-z_][A-Za-z0-9_]*)=/g, 'set $1=');
  // which <cmd> -> where <cmd>
  cmd = cmd.replace(/\bwhich\s+/g, 'where ');
  // mkdir -p -> mkdir (cmd mkdir is already recursive)
  cmd = cmd.replace(/\bmkdir\s+-p\b/gi, 'mkdir');
  // touch <file> -> create empty file
  cmd = cmd.replace(/\btouch\s+([^\s;&|]+)/gi, (_m, f) => `type nul > "${f.replace(/"/g, '').replace(/\//g, '\\')}"`);
  // cat <file> -> type <file> (cmd type requires backslashes for relative paths)
  cmd = cmd.replace(/\bcat\s+([^\s;&|]+)/gi, (_m, p) => `type ${p.replace(/\//g, '\\')}`);
  cmd = cmd.replace(/\bcat\s+/gi, 'type ');
  // pwd -> cd (prints current dir)
  cmd = cmd.replace(/\bpwd\b/gi, 'cd');
  // ls [opts] [path] -> dir [path] (cmd dir parses / as switch, so paths must use \)
  cmd = cmd.replace(/\bls\b([^;&|\r\n]*)/gi, (_m, rest) => {
    // Drop Unix ls flags (-l, -a, -la, --color, etc.) and convert forward slashes in path arguments
    const stripped = rest.replace(/\s+-+[a-zA-Z]+/g, ' ').trim();
    if (!stripped) return 'dir';
    const converted = stripped.replace(/([A-Za-z0-9_.\-~]+)\/([A-Za-z0-9_.\-\/\\]*)/g, (match: string) => match.replace(/\//g, '\\'));
    return `dir ${converted}`;
  });
  // cp -> copy, mv -> move with backslash paths
  cmd = cmd.replace(/\bcp\s+([^\s;&|]+)\s+([^\s;&|]+)/gi, (_m, s, d) => `copy ${s.replace(/\//g, '\\')} ${d.replace(/\//g, '\\')}`);
  cmd = cmd.replace(/\bmv\s+([^\s;&|]+)\s+([^\s;&|]+)/gi, (_m, s, d) => `move ${s.replace(/\//g, '\\')} ${d.replace(/\//g, '\\')}`);
  cmd = cmd.replace(/\bcp\b/g, 'copy');
  cmd = cmd.replace(/\bmv\b/g, 'move');
  // grep -> findstr
  cmd = cmd.replace(/\bgrep\b/g, 'findstr');
  // head -n N -> more +N (approximation)
  cmd = cmd.replace(/\bhead\s+-n\s+(\d+)/gi, 'more +$1');
  return cmd;
}

function getShellArgs(type: 'bash' | 'cmd' | 'powershell', command: string): string[] {
  switch (type) {
    case 'powershell':
      return ['-NoProfile', '-Command', command];
    case 'cmd':
      return ['/c', command];
    case 'bash':
    default:
      return ['-c', command];
  }
}

export const state: { cachedShell: ShellConfig | null } = {
  cachedShell: null,
};

export function resetCachedShell(): void {
  state.cachedShell = null;
}

/**
 * Resolve the shell the terminal tool actually executes commands in (bash on this
 * Windows host via git-bash/MSYS, or cmd/powershell if configured). This MUST be surfaced
 * to the model: the static tool description says "bash syntax", but on Windows the model
 * often overrides that and emits PowerShell/cmd syntax ($null, Select-String, { } blocks)
 * which the bash shell rejects — causing a retry → circuit-breaker → model-upgrade spiral.
 * Returning the real type lets the agent context state the exact syntax to use.
 */
export function getResolvedShellType(): 'bash' | 'cmd' | 'powershell' {
  if (state.cachedShell) return state.cachedShell.type;
  // Mirror the detection in execute()'s detectShell(): resolve the shell from env/config
  // or, on win32, prefer git-bash/MSYS if present, else cmd.
  try {
    const envShell = process.env.DAEDALUS_SHELL || process.env.SHELL;
    if (envShell) {
      if (/powershell|pwsh/i.test(envShell)) return 'powershell';
      if (/cmd/i.test(envShell)) return 'cmd';
      return 'bash';
    }
    let configShell: string | undefined;
    try {
      const config = loadConfig();
      configShell = config.tools?.shell;
    } catch { /* ignore */ }
    if (configShell) {
      if (/powershell|pwsh/i.test(configShell)) return 'powershell';
      if (/cmd/i.test(configShell)) return 'cmd';
      return 'bash';
    }
    if (process.platform === 'win32') {
      try {
        execSync('where bash.exe', { stdio: 'ignore' });
        return 'bash';
      } catch {
        return 'cmd';
      }
    }
    return 'bash';
  } catch {
    return 'bash';
  }
}

function normalizeCommandPrefix(command: string): string {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '(empty)';
  // `cd <dir>` collapses to `cd` so any failed cd trips the same breaker;
  // most other commands keep their first two tokens (e.g. `npm install`).
  if (tokens[0] === 'cd') return 'cd';
  return tokens.slice(0, 2).join(' ');
}

function normalizeCommandFull(command: string): string {
  // Full command with collapsed whitespace, used to detect no-progress loops
  // where the SAME command is re-issued (a reclassification runaway, e.g.
  // `cd x && npm run dev & sleep 3` repeated hundreds of times).
  return command.trim().replace(/\s+/g, ' ');
}
function stripLeadingCd(command: string): string {
  // A leading `cd <dir>` is a directory switch, not an operation whose success
  // matters — and `cd dir && realcmd` must breaker-track `realcmd`, not `cd`.
  // Otherwise `cd daedalus-scan && npm install` and `cd daedalus-scan && npm test`
  // both key to prefix `cd`, so a failing chained command trips
  // `command 'cd' failed` and blocks every `cd ... && ...` afterward (a hard stall
  // during greenfield setup). Strip leading `cd <dir> &&` / `cd <dir> ;` so the
  // breaker keys on the substantive command. Also lets `cd x && npm test` be seen
  // as a verification command (exempt from the breaker). The dir may be quoted
  // (e.g. `cd "my proj" && npm test`), so allow a quoted segment as the argument.
  let out = command.trim();
  const re = /^cd\s+(?:"[^"]*"|'[^']*'|[^\s&;|]+)\s*(?:&&|;)\s*/;
  while (re.test(out)) out = out.replace(re, '');
  return out;
}
export { stripLeadingCd };


// Verification commands (build / test / lint / type-check) are legitimately
// re-run after an edit to confirm a fix. The circuit breakers must NOT suppress
// them: a failing `npm run build` is the signal the agent acts on, not a loop.
// Exempting them stops the breaker from blocking the verify-after-fix iteration
// (which otherwise wastes model upgrades) while still catching genuine runaway
// respawn loops like `npm run dev & sleep 3`.
const VERIFICATION_COMMAND_RE = /^\s*(npm test|npm run (build|test|lint|check|typecheck|type-check)|npx (tsc|vitest|eslint|tsx)|(node_modules\/\.bin\/)?(tsc|vitest|eslint|tsx|jest)\b|tsc|vitest|jest|eslint)\b/i;
function isVerificationCommand(command: string): boolean {
  return VERIFICATION_COMMAND_RE.test(command);
}

// Detect a PowerShell/cmd command run inside the bash (git-bash/MSYS) shell.
// The model sometimes emits `del`, `Remove-Item`, `Get-Process`, `taskkill`,
// `wmic`, `pkill` (cmd/PowerShell) or bash-rejected PowerShell syntax ($null,
// "{ }" script blocks) into a bash shell, which rejects them. Detecting this on
// the FAILURE output lets us nudge the model to the correct shell instead of
// letting it loop through more wrong-shell commands.
const WRONG_SHELL_RE = /(command not found|not recognized as an internal or external|is not recognized|The term '[^']+' is not recognized|Cannot find path|Invalid argument\/option|syntax error near unexpected token)/i;
const WRONG_SHELL_CMD_RE = /\b(del|Remove-Item|Get-Process|Stop-Process|Where-Object|taskkill|wmic|pkill|Select-String|Write-Output)\b/i;
function isWrongShellFailure(stderr: string, command: string): boolean {
  const shell = getResolvedShellType();
  if (shell !== 'bash') return false; // only relevant when the real shell is bash
  const ranPowerShellCmd = WRONG_SHELL_CMD_RE.test(command);
  const bashRejected = WRONG_SHELL_RE.test(stderr);
  return ranPowerShellCmd && bashRejected;
}

function getTerminalStreakMap(context: ToolContext): Map<string, number> {
  if (!context.terminalFailureStreak) {
    context.terminalFailureStreak = new Map<string, number>();
  }
  return context.terminalFailureStreak;
}

function getTerminalRepeatMap(context: ToolContext): Map<string, number> {
  if (!context.terminalRepeatStreak) {
    context.terminalRepeatStreak = new Map<string, number>();
  }
  return context.terminalRepeatStreak;
}

function recordTerminalOutcome(context: ToolContext, prefix: string, success: boolean): void {
  const map = getTerminalStreakMap(context);
  if (success) {
    map.set(prefix, 0);
  } else {
    map.set(prefix, (map.get(prefix) ?? 0) + 1);
  }
}

export async function execute(args: { command: string; timeout?: number; workdir?: string }, context: ToolContext): Promise<ToolResult> {
  const timeout = args.timeout ?? 180;
  const workdir = args.workdir ?? context.projectRoot;
  const command = args.command;

  // Diversifying retry-loop breaker: the existing breakers only catch IDENTICAL or
  // same-prefix repeated commands. A model stuck on a failing goal (e.g. deleting a
  // locked DB file) will vary the command each time (rm, taskkill, wmic, pkill,
  // Get-Process, del...) — different commands, same failure — which those breakers
  // miss. After K consecutive terminal failures with no success in between, force a
  // reassess/stop. A passing run (incl. a legitimate build/test re-run) resets the
  // counter, so normal verify loops are unaffected.
  const consecutiveFails = context.terminalConsecutiveFails ?? 0;
  if (consecutiveFails >= 5) {
    return Promise.resolve({
      toolCallId: '',
      name: 'terminal',
      success: false,
      content: '',
      error: `[CIRCUIT BREAKER] Terminal has failed ${consecutiveFails} consecutive commands. You are likely in a retry loop varying the command at the same failing goal (e.g. a locked file, wrong shell syntax, or missing dependency). STOP varying the command — diagnose the root cause or ask the user. Do not keep re-issuing different commands.`,
    });
  }

  // Verify-loop breaker: a model can loop as FAIL-test -> patch -> FAIL-test -> patch,
  // where each failing `npm test` is separated by a (successful) patch/write. The
  // terminalConsecutiveFails counter resets on the patch's tool success, so it never
  // trips. This streak counts ONLY failing build/test/lint runs and resets only on a
  // PASSING verify run — so 4 consecutive failing test runs (with any number of patches
  // between) force a stop and a root-cause diagnosis instead of another patch-and-rerun.
  const verifyStreak = context.verifyFailStreak ?? 0;
  if (verifyStreak >= 4) {
    return Promise.resolve({
      toolCallId: '',
      name: 'terminal',
      success: false,
      content: '',
      error: `[CIRCUIT BREAKER] Build/test/lint has FAILED ${verifyStreak} consecutive times. You are looping: failing verify run -> edit -> failing verify run. STOP and diagnose the ROOT CAUSE (e.g. a locked DB file, seed/data conflict, a wrong test assertion, or a missing dependency) instead of patching-and-rerunning. Fix the underlying cause, or ask the user.`,
    });
  }
  // Terminal failure circuit breaker: if the same normalized command prefix has
  // failed 2+ consecutive times, stop retrying and let the agent inspect/adapt
  // instead of burning the global 5-failure budget on an identical failing command.
  // Verification commands (build/test/lint) are exempt: they are meant to be
  // re-run after a fix, and a failing one is the signal the agent acts on.
  const effectiveCommand = stripLeadingCd(command);
  const prefix = normalizeCommandPrefix(effectiveCommand);
  if (!isVerificationCommand(effectiveCommand)) {
    const streakMap = getTerminalStreakMap(context);
    if ((streakMap.get(prefix) ?? 0) >= 2) {
      return Promise.resolve({
        toolCallId: '',
        name: 'terminal',
        success: false,
        content: '',
        error: `[CIRCUIT BREAKER] command '${prefix}' failed 2 consecutive times. Inspect the terminal error output, fix the arguments, or switch approach instead of retrying the same command.`,
      });
    }
  }

  // Terminal repeat circuit breaker: detect a no-progress loop where the SAME
  // command is re-issued (the reclassification runaway seen when a weak-tier
  // model keeps re-spawning e.g. `npm run dev & sleep 3`). The command exits 0
  // so the failure breaker never trips; here we count consecutive IDENTICAL
  // commands and trip after 3. Legitimate iteration (edit -> test -> edit)
  // changes the command between runs, so it never false-trips. Verification
  // commands (build/test/lint) are exempt — re-running them after a fix is the
  // intended verify loop, not a runaway.
  const full = normalizeCommandFull(effectiveCommand);
  const repeatMap = getTerminalRepeatMap(context);
  if (!isVerificationCommand(effectiveCommand)) {
    if ((repeatMap.get(full) ?? 0) >= 2) {
      return Promise.resolve({
        toolCallId: '',
        name: 'terminal',
        success: false,
        content: '',
        error: `[CIRCUIT BREAKER] command '${full}' has run 3 consecutive times unchanged with no progress. Stop re-issuing it and reassess the approach (check the prior output instead of repeating).`,
      });
    }
  }
  // Count this command; reset every other command so only consecutive identical
  // runs accumulate.
  for (const key of repeatMap.keys()) {
    if (key !== full) repeatMap.set(key, 0);
  }
  repeatMap.set(full, (repeatMap.get(full) ?? 0) + 1);

  // Gate: destructive git commands are blocked (configurable via safety.protectGit)
  let protectGit = true;
  try {
    const config = loadConfig();
    protectGit = config.safety?.protectGit !== false;
  } catch { /* use default */ }
  if (protectGit) {
    const gitGuardError = guardGitCommand(command);
    if (gitGuardError) {
      return Promise.resolve({
        toolCallId: '',
        name: 'terminal',
        success: false,
        content: '',
        error: gitGuardError,
      });
    }
  }

  // Gate: block commits that would introduce a credential into the staged diff.
  const commitGuardError = guardCommitSecrets(command);
  if (commitGuardError) {
    return Promise.resolve({
      toolCallId: '',
      name: 'terminal',
      success: false,
      content: '',
      error: commitGuardError,
    });
  }

  // Gate: shell writes to test-suite files are blocked by default (mirrors the
  // write_file/patchFile test-suite lock) so an agent cannot weaken assertions
  // by writing tests via `cat >`, `tee`, `touch`, `sed -i`, or `cp`/`mv`.
  const testWriteError = checkTerminalTestWrite(command, context);
  if (testWriteError) {
    return Promise.resolve({
      toolCallId: '',
      name: 'terminal',
      success: false,
      content: '',
      error: testWriteError,
    });
  }

  // Gate: never let the shell print or write credential files (.env and friends).
  // Blocks `cat .env`, `type .env`, `echo x >> .env`, `tee .env`, etc. — defense
  // in depth so a missed secret-detector pattern can't surface tokens via terminal.
  if (/\.(env(\.[a-z0-9]+)?|npmrc|netrc|aws[\\/]credentials|service-account\.json|credentials\.(json|yml)|secrets\.json|id_(rsa|ed25519|ecdsa)|known_hosts)\b/i.test(command)) {
    return Promise.resolve({
      toolCallId: '',
      name: 'terminal',
      success: false,
      content: '',
      error: 'Refusing to run a command that targets a credential file (.env, .npmrc, .netrc, SSH keys, service-account, etc.). Secrets must stay in gitignored env files, not in terminal output or written via the shell.',
    });
  }

  // Gate: third-party install commands require user confirmation
  if (INSTALL_COMMAND_RE.test(command)) {
    if (process.env.DAEDALUS_ALLOW_INSTALL === 'true' || process.env.DAEDALUS_AUTO_APPROVE === 'true') {
      // env var bypass
    } else if (context.askLine) {
      const answer = await context.askLine(`\nAllow third-party install? [y/N] ${command.slice(0, 120)}: `);
      if (!answer.trim().toLowerCase().startsWith('y')) {
        return Promise.resolve({
          toolCallId: '',
          name: 'terminal',
          success: false,
          content: '',
          error: `Install command rejected by user: ${command.slice(0, 200)}`,
        });
      }
    } else {
      return Promise.resolve({
        toolCallId: '',
        name: 'terminal',
        success: false,
        content: '',
        error: `Install command blocked — non-interactive session without DAEDALUS_ALLOW_INSTALL=true: ${command.slice(0, 200)}`,
      });
    }
  }

  // Gate: GUI/interactive app launchers are blocked in non-interactive orchestration
  if (GUI_LAUNCH_RE.test(command)) {
    return Promise.resolve({
      toolCallId: '',
      name: 'terminal',
      success: false,
      content: '',
      error: `GUI launch blocked: ${command.slice(0, 200)}`,
    });
  }

  // Gate: backgrounded / dev-server commands are blocked. Spawning `npx tsx src/server.ts &`
  // (or `npm run dev &`, `node app.js &`, `nohup ...`) backgrounds a long-running process the
  // agent cannot observe; the spawn times out, the model retries, and the detached process is
  // never reaped — dozens of orphaned servers and a token-burning loop. Refuse and steer to a
  // one-shot verification command (tsc --noEmit, npm test, or read the file).
  if (DEV_SERVER_RE.test(command) || BACKGROUND_SPAWN_RE.test(command)) {
    return Promise.resolve({
      toolCallId: '',
      name: 'terminal',
      success: false,
      content: '',
      error: `[BLOCKED] Backgrounded/dev-server command refused: ${command.trim().slice(0, 160)}. ` +
        `Do NOT spawn a long-running server to verify code — it backgrounds a process that times out ` +
        `and loops. Use a one-shot check instead: 'npx tsc --noEmit', 'npm test', or read the file.` +
        `If you must run the server, start it ONCE via the shell (not this tool) and probe it with a ` +
        `separate curl/health check — never re-issue this command in a loop.`,
    });
  }

  // Best-effort checkpoint before install, plus an npx footgun warning
  let execCommand = command;
  if (isBashShell()) {
    // Normalize Windows cmd-style `cd /d <path>` to `cd <path>` so bash/PowerShell subshells don't error
    execCommand = execCommand.replace(/\bcd\s+\/d\s+/gi, 'cd ');
    // Normalize unquoted Windows drive paths in `cd` so bash (MSYS/git-bash) doesn't mangle backslashes
    execCommand = execCommand.replace(/\bcd\s+([A-Za-z]:[\\/][^"'\s&|;]*)/g, (_m, p) => `cd "${p.replace(/\\/g, '/')}"`);
  } else if (process.platform === 'win32') {
    // In cmd.exe, ensure drive changes use /d and backslashes
    execCommand = execCommand.replace(/\bcd\s+(?:(?:\/d\s+)?)"?([A-Za-z]:[^"'\s&|;]*)"?/gi, (_m, p) => `cd /d "${p.replace(/\//g, '\\')}"`);
    // Agents routinely emit Unix-style commands (ls, cat, mkdir -p, cp, mv, grep, ...)
    // even on Windows. When the active shell is cmd.exe (not bash/git-bash), translate the
    // common Unix-isms to cmd equivalents so headless Windows runs don't die on `ls`.
    execCommand = translateUnixToCmd(execCommand);
  }
  if (process.platform === 'win32' && /^rm\s+/i.test(execCommand.trim())) {
    const rmMatch = execCommand.trim().match(/^rm\s+(?:-[a-z]+\s+)?(.+)$/i);
    if (rmMatch && rmMatch[1]) {
      const targetPath = rmMatch[1].trim().replace(/'/g, '');
      execCommand = `powershell -Command "Remove-Item -Recurse -Force '${targetPath}'"`;
    }
  }

  let notes = '';
  if (INSTALL_COMMAND_RE.test(execCommand)) {
    notes += buildCheckpointNote(workdir);
  }
  notes += buildNpxWarnNote(execCommand, workdir);

  return new Promise((resolve) => {
    let output = notes;
    let errorOutput = '';
    let exited = false;

    function detectShell(): { shell: string; args: string[] } {
      if (!state.cachedShell) {
        const envShell = process.env.DAEDALUS_SHELL || process.env.SHELL;
        if (envShell) {
          state.cachedShell = { shell: envShell, type: getShellType(envShell) };
        } else {
          let configShell: string | undefined;
          try {
            const config = loadConfig();
            configShell = config.tools?.shell;
          } catch {
            // Ignore config load errors
          }

          if (configShell) {
            state.cachedShell = { shell: configShell, type: getShellType(configShell) };
          } else if (process.platform === 'win32') {
            // Native Windows shell is cmd.exe: node/npm are cmd-native, and it avoids the
            // MSYS/Git-bash path-translation gotcha (a Unix-style "/foo" gets rewritten to
            // Git's root, causing spurious "Permission denied"). Only use bash when the user
            // explicitly configures it (tools.shell or SHELL env), since bash implies a
            // deliberate Unix-like workflow.
            let detected = 'cmd.exe';
            let type: 'bash' | 'cmd' | 'powershell' = 'cmd';
            if (configShell && /bash/i.test(configShell)) {
              detected = configShell;
              type = 'bash';
            } else {
              try {
                const whereOut = execSync('where bash.exe', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
                const resolved = whereOut.split(/\r?\n/)[0]?.trim();
                if (resolved && fs.existsSync(resolved) && process.env.SHELL && /bash/i.test(process.env.SHELL)) {
                  detected = resolved;
                  type = 'bash';
                }
              } catch { /* keep cmd.exe */ }
            }
            state.cachedShell = { shell: detected, type };
          } else {
            state.cachedShell = { shell: '/bin/bash', type: 'bash' };
          }
        }
      }

      const active = state.cachedShell!;
      return { shell: active.shell, args: getShellArgs(active.type, execCommand) };
    }

    function getExecutionShell(): { shell: string; args: string[] } {
      let config;
      try {
        config = loadConfig();
      } catch {
        return detectShell();
      }
      const sandbox = config.tools?.sandbox ?? 'none';
      const sandboxImage = config.tools?.sandboxImage ?? 'node:20';
      const wslDistribution = config.tools?.wslDistribution;

      if (sandbox === 'docker') {
        const rel = path.relative(context.projectRoot, workdir);
        const containerWorkdir = rel ? `/workspace/${rel.replace(/\\/g, '/')}` : '/workspace';
        const dockerArgs = [
          'run',
          '-i',
          '--rm',
          '-v',
          `${context.projectRoot}:/workspace`,
          '-w',
          containerWorkdir,
          sandboxImage,
          'sh',
          '-c',
          execCommand,
        ];
        return { shell: 'docker', args: dockerArgs };
      }

      if (sandbox === 'wsl' && process.platform === 'win32') {
        let wslWorkdir: string;
        try {
          wslWorkdir = execSync(`wsl wslpath -u "${workdir}"`, { encoding: 'utf8', stdio: 'pipe' }).trim();
        } catch {
          const letter = workdir.charAt(0).toLowerCase();
          const rest = workdir.slice(3).replace(/\\/g, '/');
          wslWorkdir = `/mnt/${letter}/${rest}`;
        }
        const wslArgs = [];
        if (wslDistribution) {
          wslArgs.push('-d', wslDistribution);
        }
        wslArgs.push('--cd', wslWorkdir, '--', 'sh', '-c', execCommand);
        return { shell: 'wsl', args: wslArgs };
      }

      return detectShell();
    }

    const { shell, args: shellArgs } = getExecutionShell();

    const isInstallCmd = INSTALL_COMMAND_RE.test(execCommand);
    const label = isInstallCmd ? 'Package installation' : 'Command';
    const cmdSpinner = new DaedalusSpinner({
      text: isInstallCmd
        ? `Installing dependencies (${execCommand.slice(0, 60)}...)`
        : `Running: ${execCommand.slice(0, 60)}${execCommand.length > 60 ? '...' : ''}`,
      color: (s) => pc.cyan(s),
    });
    cmdSpinner.start();

    const child = spawn(shell, shellArgs, {
      cwd: workdir,
      env: sanitizeEnv(),
      shell: false,
      // Ignore stdin so a closed parent stdin pipe (e.g. a piped task that hits
      // EOF) can't deliver EOF/Ctrl-C into the child. On Windows, run the child
      // in its own detached process group so a console/Ctrl-C signal aimed at
      // the parent does not kill the whole spawned tree (npm -> tsc) with an
      // 0xC0000142 / STATUS_CONTROL_C_EXIT crash. This is the root cause of
      // intermittent terminal failures when Daedalus is launched non-interactively.
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true,
    });

    let childClosed = false;

    const killTimer = setTimeout(() => {
      if (!exited) {
        exited = true;
        if (cmdSpinner) {
          cmdSpinner.stop();
          console.log(pc.red(`[FAIL] ${label} timed out after ${timeout}s`));
        }
        if (process.platform === 'win32') {
          try {
            execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' });
          } catch {
            try { child.kill('SIGKILL'); } catch { /* Ignore process kill error if process already exited */ }
          }
        } else {
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!childClosed) {
              try { child.kill('SIGKILL'); } catch { /* Ignore process kill error if process already exited */ }
            }
          }, 5000);
        }
        recordTerminalOutcome(context, prefix, false);
        context.terminalConsecutiveFails = (context.terminalConsecutiveFails ?? 0) + 1;
        resolve({
          toolCallId: '',
          name: 'terminal',
          success: false,
          content: output + errorOutput,
          error: `Command timed out after ${timeout}s`,
        });
      }
    }, timeout * 1000);

    child.stdout?.on('data', (data) => {
      output += data.toString();
    });

    child.stderr?.on('data', (data) => {
      errorOutput += data.toString();
    });

    child.on('error', (err) => {
      if (!exited) {
        exited = true;
        clearTimeout(killTimer);
        if (cmdSpinner) {
          cmdSpinner.stop();
          console.log(pc.red(`[FAIL] ${label} error: ${err.message}`));
        }
        recordTerminalOutcome(context, prefix, false);
        context.terminalConsecutiveFails = (context.terminalConsecutiveFails ?? 0) + 1;
        resolve({
          toolCallId: '',
          name: 'terminal',
          success: false,
          content: '',
          error: `Failed to start command: ${err.message}`,
        });
      }
    });

    child.on('close', (code) => {
      childClosed = true;
      if (!exited) {
        exited = true;
        clearTimeout(killTimer);
        if (cmdSpinner) {
          cmdSpinner.stop();
          if (code === 0) {
            if (isInstallCmd) console.log(pc.green(`\n[OK] Package installation completed successfully.`));
          } else {
            if (isInstallCmd) console.log(pc.red(`\n[FAIL] Package installation failed with exit code ${code}.`));
          }
        }
        const fullOutput = output + (errorOutput ? `\n[stderr]\n${errorOutput}` : '');
        let diagHint = '';
        if (code !== 0 && (fullOutput.includes('ERR_MODULE_NOT_FOUND') || fullOutput.includes('Cannot find package') || fullOutput.includes('Cannot find module'))) {
          const match = fullOutput.match(/Cannot find package ['"]([^'"]+)['"]/) || fullOutput.match(/Cannot find module ['"]([^'"]+)['"]/);
          if (match && match[1]) {
            const pkgOrFile = match[1];
            const isLocal = pkgOrFile.startsWith('.') || pkgOrFile.startsWith('/') || pkgOrFile.startsWith('\\') || /^[A-Za-z]:/.test(pkgOrFile);
            if (isLocal) {
              diagHint = ` — DIAGNOSTIC HINT: Local module file '${pkgOrFile}' was not found on disk. Ensure the file is created with a .ts/.js extension in the correct directory.`;
            } else {
              diagHint = ` — DIAGNOSTIC HINT: Missing npm package '${pkgOrFile}'. Run 'npm install ${pkgOrFile}' or check package.json dependencies. Do NOT attempt source file string patches to fix missing npm packages.`;
            }
          }
        } else if (code !== 0 && command.includes('zip') && (fullOutput.includes('is not recognized') || fullOutput.includes('command not found') || code === 127)) {
          diagHint = ` — DIAGNOSTIC HINT: Linux 'zip' command is unavailable on Windows cmd/powershell. Use PowerShell 'Compress-Archive -Path .\\* -DestinationPath archive.zip -Force' instead.`;
        }
        const succeeded = code === 0;
        recordTerminalOutcome(context, prefix, succeeded);
        // Diversifying retry-loop guard: count consecutive failures across all commands.
        // A success (incl. a legitimate build/test re-run) resets it.
        context.terminalConsecutiveFails = succeeded ? 0 : (context.terminalConsecutiveFails ?? 0) + 1;
        // Verify-loop guard: only build/test/lint runs feed this streak. A PASSING verify
        // run resets it; a FAILING one increments it (patches/edits in between do NOT reset
        // it, which is the whole point — it catches patch->test->patch->test loops).
        if (isVerificationCommand(command)) {
          context.verifyFailStreak = succeeded ? 0 : (context.verifyFailStreak ?? 0) + 1;
          // Track whether the most recent verify run was GREEN so a later "tests pass /
          // clean state" claim cannot omit a failing overall suite.
          context.lastVerifyPassed = succeeded;
          // Capture the ACTUAL passing-test count from a successful verify run so a later
          // summary cannot fabricate a different number. Parse "Tests X passed (Y)" /
          // "X/Y passing" / "X tests passed".
          if (succeeded) {
            const m = fullOutput.match(/(\d+)\s*(?:passed|passing|\/\s*\d+\s*passing)|Tests\s+(\d+)\s+passed/i);
            if (m) {
              const n = parseInt(m[1] ?? m[2] ?? '', 10);
              if (!Number.isNaN(n)) context.lastVerifyPassCount = n;
            }
          }
        }
        // Runtime-failure capture: remember a FAILED run of the built artifact (node dist/cli.js,
        // npm run start, a runtime probe, etc.) so the completion guard can reject a later
        // "project works / CLI executed / verified" claim that is contradicted by the agent's
        // OWN failed run. Only records genuine failures (non-zero exit WITH a hard error signature),
        // never benign non-zero exits (grep no-match, `test -f` false). Cleared by any success.
        if (succeeded) {
          context.lastRuntimeFailure = null;
        } else if (fullOutput.trim()) {
          const looksLikeRun = /\b(node\s|npm\s+run|npx\s|deno\s|bun\s|python\s|dist[/\\]|build[/\\]|java\s|dotnet\s|go\s+run|cargo\s+run)\b/i.test(command);
          const hardErr = /(ERR_[A-Z_]+|Cannot find|MODULE_NOT_FOUND|ENOENT|SyntaxError|TypeError|ReferenceError|Exception|Error:|throw new|exit code \d|Command failed)/i.test(fullOutput);
          if (looksLikeRun && hardErr) {
            context.lastRuntimeFailure = {
              command: command.trim().slice(0, 200),
              error: fullOutput.replace(/\s*\n+\s*/g, ' ').trim().slice(0, 400),
            };
          }
        }
        // Wrong-shell nudge: a PowerShell/cmd command rejected by the bash shell. Point
        // the model at the correct syntax instead of letting it loop more wrong-shell cmds.
        if (!succeeded && isWrongShellFailure(errorOutput, command)) {
          diagHint += ` — WRONG SHELL: this terminal runs BASH (git-bash/MSYS), not PowerShell/cmd. Use 'rm -f <file>' not 'del'/'Remove-Item'; use 'kill <pid>' not 'taskkill'/'Get-Process'; never use '$null' or '{ }' script blocks.`;
        }
        resolve({
          toolCallId: '',
          name: 'terminal',
          success: succeeded,
          content: fullOutput || '(no output)',
          error: code !== 0 ? `Exit code: ${code}${diagHint}` : undefined,
        });
      }
    });

    // Handle abort signal
    context.abortSignal?.addEventListener('abort', () => {
      if (!exited) {
        exited = true;
        clearTimeout(killTimer);
        child.kill('SIGTERM');
        recordTerminalOutcome(context, prefix, false);
        resolve({
          toolCallId: '',
          name: 'terminal',
          success: false,
          content: output + errorOutput,
          error: 'Command aborted',
        });
      }
    });
  });
}