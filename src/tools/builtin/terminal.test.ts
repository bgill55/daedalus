import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import fs from 'fs';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
  },
}));

vi.mock('../../config/index.js', () => ({
  loadConfig: vi.fn(),
}));

import { spawn, execSync } from 'child_process';
import { execute, resetCachedShell, stripLeadingCd, translateUnixToCmd } from './terminal.js';
import { loadConfig } from '../../config/index.js';
import type { ToolContext } from '../../types.js';

const originalPlatform = process.platform;
const originalEnvShell = process.env.SHELL;
const originalEnvDaedalusShell = process.env.DAEDALUS_SHELL;

function makeMockProcess() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as any;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = { write: vi.fn(), end: vi.fn(), writable: true };
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

function makeContext(): ToolContext {
  return { projectRoot: '/tmp/test', name: '' } as unknown as ToolContext;
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  vi.clearAllMocks();
  resetCachedShell();
  (loadConfig as any).mockReturnValue({
    tools: {}
  });
  delete process.env.DAEDALUS_SHELL;
  delete process.env.SHELL;
  delete process.env.DAEDALUS_ALLOW_INSTALL;
  delete process.env.DAEDALUS_AUTO_APPROVE;
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  if (originalEnvShell !== undefined) {
    process.env.SHELL = originalEnvShell;
  } else {
    delete process.env.SHELL;
  }
  if (originalEnvDaedalusShell !== undefined) {
    process.env.DAEDALUS_SHELL = originalEnvDaedalusShell;
  } else {
    delete process.env.DAEDALUS_SHELL;
  }
  delete process.env.DAEDALUS_ALLOW_INSTALL;
  delete process.env.DAEDALUS_AUTO_APPROVE;
  (execSync as any).mockReset();
  (fs as any).existsSync.mockReset();
});


describe('stripLeadingCd', () => {
  it('strips a single leading `cd <dir> &&` so the breaker keys on the real command', () => {
    expect(stripLeadingCd('cd proj && npm install')).toBe('npm install');
    expect(stripLeadingCd('cd "my proj" && npm test')).toBe('npm test');
    expect(stripLeadingCd('cd proj ; npm run build')).toBe('npm run build');
  });
  it('strips chained leading cd switches', () => {
    expect(stripLeadingCd('cd a && cd b && npm run build')).toBe('npm run build');
  });
  it('leaves a bare `cd` (no chained command) untouched', () => {
    expect(stripLeadingCd('cd non_existent_dir')).toBe('cd non_existent_dir');
  });
  it('leaves a non-cd command untouched', () => {
    expect(stripLeadingCd('npm run build')).toBe('npm run build');
  });
});

describe('terminal execute', () => {
  it('executes command successfully', async () => {
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'echo hello' }, makeContext());

    mockProc.stdout.emit('data', Buffer.from('hello\n'));
    mockProc.emit('close', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.content).toBe('hello\n');
    expect(spawn).toHaveBeenCalledWith('/bin/bash', ['-c', 'echo hello'], expect.any(Object));
  });

  it('spawns the child with stdin ignored and (on Windows) a detached process group', async () => {
    // Regression guard for the intermittent 0xC0000142 / STATUS_CONTROL_C_EXIT
    // terminal crashes: the child must not inherit the parent's stdin pipe (so a
    // closed piped task can't deliver EOF/Ctrl-C) and, on Windows, must run in its
    // own process group so a console signal aimed at the parent doesn't kill the
    // spawned npm -> tsc tree.
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'npm run build' }, makeContext());
    mockProc.emit('close', 0);
    await resultPromise;

    const opts = (spawn as any).mock.calls[0][2];
    expect(opts.stdio[0]).toBe('ignore');
    expect(opts.stdio[1]).toBe('pipe');
    expect(opts.stdio[2]).toBe('pipe');
    expect(opts.detached).toBe(process.platform === 'win32');
    expect(opts.shell).toBe(false);
  });

  it('reports failure on non-zero exit', async () => {
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'false' }, makeContext());

    mockProc.stderr.emit('data', Buffer.from('error\n'));
    mockProc.emit('close', 1);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('Exit code: 1');
    expect(result.content).toContain('[stderr]');
    expect(result.content).toContain('error');
  });

  it('handles command timeout', async () => {
    vi.useFakeTimers();
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'sleep', timeout: 1 }, makeContext());
    vi.advanceTimersByTime(1000);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });

  it('handles abort signal', async () => {
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);
    const ac = new AbortController();

    const resultPromise = execute({ command: 'long-running' }, { ...makeContext(), abortSignal: ac.signal });

    ac.abort();

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('aborted');
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('handles spawn failure', async () => {
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'nonexistent' }, makeContext());
    mockProc.emit('error', new Error('ENOENT'));

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to start');
  });

  it('uses cmd.exe on Windows when no bash found', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    (execSync as any).mockImplementation(() => { throw new Error('not found'); });
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'dir' }, makeContext());
    mockProc.emit('close', 0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(spawn).toHaveBeenCalled();
    const shell = (spawn as any).mock.calls[0][0];
    expect(shell).toBe('cmd.exe');
  });

  it('translates common Unix commands to cmd.exe equivalents on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    (execSync as any).mockImplementation(() => { throw new Error('not found'); });
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'ls -la ./src && cat package.json' }, makeContext());
    mockProc.emit('close', 0);
    await resultPromise;

    const args = (spawn as any).mock.calls[0][1] as string[];
    const translated = args[args.length - 1];
    expect(translated).toContain('dir');
    expect(translated).not.toContain('ls -la');
    expect(translated).toContain('type package.json');
  });

  it('prefers shell specified in DAEDALUS_SHELL environment variable', async () => {
    process.env.DAEDALUS_SHELL = 'powershell.exe';
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'Get-Process' }, makeContext());
    mockProc.emit('close', 0);
    await resultPromise;

    expect(spawn).toHaveBeenCalledWith('powershell.exe', ['-NoProfile', '-Command', 'Get-Process'], expect.any(Object));
  });

  it('prefers shell specified in SHELL environment variable', async () => {
    process.env.SHELL = '/bin/zsh';
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'echo hello' }, makeContext());
    mockProc.emit('close', 0);
    await resultPromise;

    expect(spawn).toHaveBeenCalledWith('/bin/zsh', ['-c', 'echo hello'], expect.any(Object));
  });

  it('prefers shell specified in tools.shell configuration option', async () => {
    (loadConfig as any).mockReturnValue({
      tools: {
        shell: 'pwsh'
      }
    });
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'Get-ChildItem' }, makeContext());
    mockProc.emit('close', 0);
    await resultPromise;

    expect(spawn).toHaveBeenCalledWith('pwsh', ['-NoProfile', '-Command', 'Get-ChildItem'], expect.any(Object));
  });

  it('uses Docker sandbox when configured', async () => {
    (loadConfig as any).mockReturnValue({
      tools: {
        sandbox: 'docker',
        sandboxImage: 'custom-node:18',
      }
    });
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'echo hello' }, makeContext());
    mockProc.emit('close', 0);
    await resultPromise;

    expect(spawn).toHaveBeenCalledWith(
      'docker',
      [
        'run',
        '-i',
        '--rm',
        '-v',
        '/tmp/test:/workspace',
        '-w',
        '/workspace',
        'custom-node:18',
        'sh',
        '-c',
        'echo hello',
      ],
      expect.any(Object)
    );
  });

  it('uses WSL sandbox when configured on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    (loadConfig as any).mockReturnValue({
      tools: {
        sandbox: 'wsl',
        wslDistribution: 'Ubuntu',
      }
    });
    (execSync as any).mockReturnValue('/mnt/tmp/test');

    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'echo hello' }, makeContext());
    mockProc.emit('close', 0);
    await resultPromise;

    expect(spawn).toHaveBeenCalledWith(
      'wsl',
      ['-d', 'Ubuntu', '--cd', '/mnt/tmp/test', '--', 'sh', '-c', 'echo hello'],
      expect.any(Object)
    );
  });

  it('warns when npx references a non-dependency package', async () => {
    process.env.DAEDALUS_ALLOW_INSTALL = 'true';
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'npx eslint .' }, makeContext());
    mockProc.emit('close', 0);
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.content).toContain("[WARN] 'eslint' is not a declared dependency");
    expect(result.content).toContain("npm install --save-dev eslint");
  });

  it('does not warn when npx references a declared dependency', async () => {
    process.env.DAEDALUS_ALLOW_INSTALL = 'true';
    const mockFs = (await import('fs')).default as any;
    mockFs.existsSync.mockImplementation((p: string) => String(p).endsWith('package.json'));
    mockFs.readFileSync = () => JSON.stringify({ dependencies: { eslint: '^9.0.0' } });
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const resultPromise = execute({ command: 'npx eslint .' }, makeContext());
    mockProc.emit('close', 0);
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.content).not.toContain("[WARN] 'eslint' is not a declared dependency");
  });

  it('appends a checkpoint note for install commands in a git repo', async () => {
    process.env.DAEDALUS_ALLOW_INSTALL = 'true';
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    const realFs = await vi.importActual<typeof import('fs')>('fs');
    const realCp = await vi.importActual<typeof import('child_process')>('child_process');
    const tmpDir = realFs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-terminal-checkpoint-'));
    try {
      realCp.execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
      realCp.execSync('git config user.email test@daedalus.local', { cwd: tmpDir, stdio: 'ignore' });
      realCp.execSync('git config user.name "Daedalus Test"', { cwd: tmpDir, stdio: 'ignore' });
      realCp.execSync('git config core.autocrlf false', { cwd: tmpDir, stdio: 'ignore' });
      realFs.writeFileSync(path.join(tmpDir, 'a.txt'), 'v1\n');
      realCp.execSync('git add .', { cwd: tmpDir, stdio: 'ignore' });
      realCp.execSync('git commit -m init', { cwd: tmpDir, stdio: 'ignore' });
      realFs.writeFileSync(path.join(tmpDir, 'a.txt'), 'v2\n');

      (execSync as any).mockImplementation((cmd: string, opts?: any) => {
        if (cmd.startsWith('git ')) return realCp.execSync(cmd, opts);
        throw new Error('mocked execSync');
      });

      const mockProc = makeMockProcess();
      (spawn as any).mockReturnValue(mockProc);

      const ctx = { ...makeContext(), projectRoot: tmpDir };
      const resultPromise = execute({ command: 'npm install lodash', workdir: tmpDir }, ctx);
      mockProc.emit('close', 0);
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.content).toContain('[CHECKPOINT] Git snapshot created before install:');
      expect(result.content).toContain('roll back with: git checkout');
    } finally {
      delete process.env.DAEDALUS_ALLOW_INSTALL;
      realFs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('trips circuit breaker after 2 consecutive failures of the same command prefix', async () => {
    const ctx = makeContext();
    ctx.terminalFailureStreak = new Map<string, number>();
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    // First failure: streak -> 1, command still runs.
    let p1 = execute({ command: 'cd non_existent_dir' }, ctx);
    mockProc.emit('close', 1);
    const r1 = await p1;
    expect(r1.success).toBe(false);
    expect(spawn).toHaveBeenCalledTimes(1);

    // Second failure: streak -> 2.
    const mockProc2 = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc2);
    let p2 = execute({ command: 'cd non_existent_dir' }, ctx);
    mockProc2.emit('close', 1);
    const r2 = await p2;
    expect(r2.success).toBe(false);

    // Third attempt: circuit breaker trips BEFORE spawning.
    (spawn as any).mockClear();
    const r3 = await execute({ command: 'cd non_existent_dir' }, ctx);
    expect(spawn).not.toHaveBeenCalled();
    expect(r3.success).toBe(false);
    expect(r3.error).toContain('[CIRCUIT BREAKER]');
    expect(r3.error).toContain("command 'cd'");
  });

  it('does NOT trip the failure breaker on repeated failing verification commands (build/test/lint)', async () => {
    // Regression: a failing `npm run build` re-run after a fix is the agent's
    // verify loop, not a runaway. The breaker must not block it (this previously
    // wasted model upgrades on a trivial one-line fix).
    const ctx = makeContext();
    ctx.terminalFailureStreak = new Map<string, number>();
    const runFailing = async (cmd: string) => {
      const mockProc = makeMockProcess();
      (spawn as any).mockReturnValue(mockProc);
      const p = execute({ command: cmd }, ctx);
      mockProc.emit('close', 1);
      return p;
    };

    for (let i = 0; i < 4; i++) {
      (spawn as any).mockClear();
      const r = await runFailing('npm run build');
      expect(spawn).toHaveBeenCalledTimes(1); // never skipped by the breaker
      expect(r.success).toBe(false);
    }
  });

  it('trips a diversifying retry-loop breaker after 5 consecutive failures (different commands)', async () => {
    // Regression: a model stuck deleting a locked DB file varies the command each
    // time (rm, taskkill, wmic, pkill, Get-Process, del). The identical/same-prefix
    // breakers miss this; the consecutive-failure breaker must catch it. After 5
    // consecutive failures the NEXT command is blocked before spawning.
    const ctx = makeContext();
    ctx.terminalConsecutiveFails = 0;
    const cmds = ['rm -f data/prompts.db', 'taskkill /F /IM node.exe', 'wmic process delete', 'pkill node', 'Get-Process node', 'del data/prompts.db'];
    const runFail = async (cmd: string) => {
      const mockProc = makeMockProcess();
      (spawn as any).mockReturnValue(mockProc);
      const p = execute({ command: cmd, timeout: 1 }, ctx);
      mockProc.emit('close', 1);
      return p;
    };
    for (let i = 0; i < 5; i++) {
      (spawn as any).mockClear();
      const r = await runFail(cmds[i]);
      expect(spawn).toHaveBeenCalledTimes(1); // first 5 still run
    }
    // 6th attempt: breaker trips BEFORE spawning.
    (spawn as any).mockClear();
    const r6 = await execute({ command: cmds[5], timeout: 1 }, ctx);
    expect(spawn).not.toHaveBeenCalled();
    expect(r6.success).toBe(false);
    expect(r6.error).toContain('[CIRCUIT BREAKER]');
    expect(r6.error).toContain('retry loop');
  });

  it('resets the consecutive-failure counter on a successful command', async () => {
    const ctx = makeContext();
    ctx.terminalConsecutiveFails = 4; // one away from the breaker
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);
    const p = execute({ command: 'npm run build', timeout: 1 }, ctx);
    mockProc.emit('close', 0); // success resets it
    const r = await p;
    expect(r.success).toBe(true);
    expect(ctx.terminalConsecutiveFails).toBe(0);
    // Next failure is treated as first, not a breaker.
    (spawn as any).mockClear();
    const mockProc2 = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc2);
    const p2 = execute({ command: 'rm -f data/prompts.db', timeout: 1 }, ctx);
    mockProc2.emit('close', 1);
    await p2;
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('appends a wrong-shell nudge when a PowerShell/cmd command is rejected by bash', async () => {
    // Regression: the model emits `del`/`Remove-Item` into the bash shell; the
    // failure output should tell it to use bash syntax instead of looping.
    const ctx = makeContext();
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);
    const p = execute({ command: 'del data/prompts.db', timeout: 1 }, ctx);
    mockProc.stderr.emit('data', Buffer.from("bash: line 1: del: command not found\n"));
    mockProc.emit('close', 127);
    const r = await p;
    expect(r.success).toBe(false);
    expect(r.error).toContain('WRONG SHELL');
    expect(r.error).toContain("Use 'rm -f <file>'");
  });

  it('trips the verify-loop breaker on failing test->patch->failing-test loops (patches between do NOT reset it)', async () => {
    // Regression: the model loops as FAIL-test -> patch(source) -> FAIL-test -> patch,
    // where the intervening patch/write "succeeds" as a tool call, which would reset the
    // terminalConsecutiveFails counter. This streak must ignore patches and only reset on
    // a PASSING verify run. After 4 failing `npm test` runs (with patches between), the 5th
    // is blocked.
    const ctx = makeContext();
    ctx.verifyFailStreak = 0;
    const runFailingTest = async () => {
      const mockProc = makeMockProcess();
      (spawn as any).mockReturnValue(mockProc);
      const p = execute({ command: 'npm test', timeout: 1 }, ctx);
      mockProc.emit('close', 1); // test fails
      return p;
    };
    const runPatch = async () => {
      // Simulate a successful patch/write tool call between test runs (does NOT reset verifyFailStreak).
      (spawn as any).mockClear();
    };
    for (let i = 0; i < 4; i++) {
      const r = await runFailingTest();
      expect(spawn).toHaveBeenCalledTimes(1);
      await runPatch();
    }
    // 5th failing test: breaker trips BEFORE spawning.
    (spawn as any).mockClear();
    const r5 = await execute({ command: 'npm test', timeout: 1 }, ctx);
    expect(spawn).not.toHaveBeenCalled();
    expect(r5.success).toBe(false);
    expect(r5.error).toContain('[CIRCUIT BREAKER]');
    expect(r5.error).toContain('looping');
  });

  it('resets the verify-fail streak when a verify command PASSES (even after prior failures)', async () => {
    const ctx = makeContext();
    ctx.verifyFailStreak = 3; // one away from the breaker
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);
    const p = execute({ command: 'npm test', timeout: 1 }, ctx);
    mockProc.emit('close', 0); // test passes -> resets
    const r = await p;
    expect(r.success).toBe(true);
    expect(ctx.verifyFailStreak).toBe(0);
    // Next failing test is treated as first, not a breaker.
    (spawn as any).mockClear();
    const mockProc2 = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc2);
    const p2 = execute({ command: 'npm test', timeout: 1 }, ctx);
    mockProc2.emit('close', 1);
    await p2;
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('resets the streak on a successful command', async () => {
    const ctx = makeContext();
    ctx.terminalFailureStreak = new Map<string, number>([['cd', 1]]);
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const p = execute({ command: 'cd some_dir' }, ctx);
    mockProc.emit('close', 0);
    const r = await p;

    expect(r.success).toBe(true);
    expect(ctx.terminalFailureStreak.get('cd')).toBe(0);

    // A fresh failure afterward is treated as the first (streak 1), not a breaker.
    (spawn as any).mockClear();
    const mockProc2 = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc2);
    const p2 = execute({ command: 'cd other_dir' }, ctx);
    mockProc2.emit('close', 1);
    await p2;
    expect(ctx.terminalFailureStreak.get('cd')).toBe(1);
  });

  it('trips a no-progress breaker after 3 consecutive identical successful commands', async () => {
    const ctx = makeContext();
    ctx.terminalRepeatStreak = new Map<string, number>();

    // Use a safe, non-dev-server command so the dev-server gate does not preempt the
    // no-progress breaker under test.
    const cmd = 'node -e "console.log(1)"';
    for (let i = 0; i < 2; i++) {
      const mockProc = makeMockProcess();
      (spawn as any).mockReturnValue(mockProc);
      const p = execute({ command: cmd }, ctx);
      mockProc.emit('close', 0);
      const r = await p;
      expect(r.success).toBe(true);
    }

    // Third identical run: breaker trips BEFORE spawning (note it exits 0, so the
    // failure breaker would never catch this).
    (spawn as any).mockClear();
    const r3 = await execute({ command: cmd }, ctx);
    expect(spawn).not.toHaveBeenCalled();
    expect(r3.success).toBe(false);
    expect(r3.error).toContain('[CIRCUIT BREAKER]');
    expect(r3.error).toContain('has run 3 consecutive times');
  });

  it('does not trip when a different command is issued between runs', async () => {
    const ctx = makeContext();
    ctx.terminalRepeatStreak = new Map<string, number>();
    const runCmd = async (cmd: string) => {
      const mockProc = makeMockProcess();
      (spawn as any).mockReturnValue(mockProc);
      const p = execute({ command: cmd }, ctx);
      mockProc.emit('close', 0);
      return p;
    };

    // edit -> test -> edit: commands differ between runs, so no no-progress loop.
    // (Avoid dev-server patterns here — the dev-server gate preempts them now.)
    await runCmd('node -e "console.log(1)"');
    await runCmd('npm run build');
    await runCmd('node -e "console.log(2)"');

    expect(spawn).toHaveBeenCalledTimes(3);
  });
});

describe('terminal test-suite lock', () => {
  it('blocks cat > into a test file (shell bypass of write_file lock)', async () => {
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);

    const result = await execute({ command: "cat > tests/sort.test.ts <<'EOF'" }, makeContext());

    expect(spawn).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain('[TEST SUITE LOCK]');
    expect(result.error).toContain('sort.test.ts');
  });

  it('blocks tee/touch/sed -i writing a test file', async () => {
    for (const cmd of [
      'tee tests/db.test.ts',
      'touch tests/x.spec.ts',
      "sed -i 's/foo/bar/' tests/db.test.ts",
    ]) {
      (spawn as any).mockClear();
      const mockProc = makeMockProcess();
      (spawn as any).mockReturnValue(mockProc);
      const result = await execute({ command: cmd }, makeContext());
      expect(spawn).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toContain('[TEST SUITE LOCK]');
    }
  });

  it('blocks cp/mv into a test file path', async () => {
    (spawn as any).mockClear();
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);
    const result = await execute({ command: 'cp src/foo.ts tests/foo.test.ts' }, makeContext());
    expect(spawn).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain('[TEST SUITE LOCK]');
  });

  it('allows running a specific test file (no write operator)', async () => {
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);
    const resultPromise = execute({ command: 'vitest run tests/db.test.ts' }, makeContext());
    mockProc.emit('close', 0);
    const result = await resultPromise;
    expect(spawn).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('allows reading a test file (cat without redirect)', async () => {
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);
    const resultPromise = execute({ command: 'cat tests/db.test.ts' }, makeContext());
    mockProc.emit('close', 0);
    const result = await resultPromise;
    expect(spawn).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('does not block npm/vitest commands that merely mention "test"', async () => {
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);
    const resultPromise = execute({ command: 'npm run test' }, makeContext());
    mockProc.emit('close', 0);
    const result = await resultPromise;
    expect(spawn).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('allows the write when context.allowTestEdits is set', async () => {
    (spawn as any).mockClear();
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);
    const ctx = { ...makeContext(), allowTestEdits: true };
    const resultPromise = execute({ command: "cat > tests/sort.test.ts <<'EOF'" }, ctx);
    mockProc.emit('close', 0);
    const result = await resultPromise;
    expect(spawn).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});

describe('getResolvedShellType', () => {
  const origShell = process.env.SHELL;
  const origDaedalusShell = process.env.DAEDALUS_SHELL;
  afterEach(() => {
    if (origShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = origShell;
    if (origDaedalusShell === undefined) delete process.env.DAEDALUS_SHELL;
    else process.env.DAEDALUS_SHELL = origDaedalusShell;
  });

  it('returns bash when SHELL points to a bash path (Windows git-bash host)', async () => {
    process.env.SHELL = '/usr/bin/bash';
    process.env.DAEDALUS_SHELL = undefined as unknown as string;
    const mod = await import('./terminal.js');
    expect(mod.getResolvedShellType()).toBe('bash');
  });

  it('returns powershell when DAEDALUS_SHELL names powershell', async () => {
    process.env.DAEDALUS_SHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const mod = await import('./terminal.js');
    expect(mod.getResolvedShellType()).toBe('powershell');
  });

  describe('dev-server / backgrounded command gate', () => {
    it('blocks backgrounded dev-server spawn (npx tsx src/server.ts &)', async () => {
      const result = await execute({ command: 'cd /d/prompt-vault && npx tsx src/server.ts & sleep 3' }, makeContext());
      expect(result.success).toBe(false);
      expect(result.error).toContain('[BLOCKED]');
      expect(spawn).not.toHaveBeenCalled();
    });

    it('blocks npm run dev &', async () => {
      const result = await execute({ command: 'npm run dev &' }, makeContext());
      expect(result.success).toBe(false);
      expect(result.error).toContain('[BLOCKED]');
      expect(spawn).not.toHaveBeenCalled();
    });

    it('blocks a trailing & background redirect', async () => {
      const result = await execute({ command: 'node app.js &' }, makeContext());
      expect(result.success).toBe(false);
      expect(result.error).toContain('[BLOCKED]');
    });

    it('blocks nohup backgrounding', async () => {
      const result = await execute({ command: 'nohup npm run start' }, makeContext());
      expect(result.success).toBe(false);
      expect(result.error).toContain('[BLOCKED]');
    });

    it('still allows one-shot verification commands (tsc --noEmit)', async () => {
      const mockProc = makeMockProcess();
      (spawn as any).mockReturnValue(mockProc);
      const resultPromise = execute({ command: 'npx tsc --noEmit' }, makeContext());
      mockProc.emit('close', 0);
      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalled();
    });
  });



  it('treats `cd dir && npm run build` as a verification command (exempt from the breaker)', async () => {
    // A failing `cd proj && npm run build` is a verify-loop signal, not a runaway. After the
    // stripLeadingCd fix it is recognized as a verification command and never breaker-tripped.
    const ctx = makeContext();
    ctx.terminalFailureStreak = new Map<string, number>();

    const mock1 = makeMockProcess();
    (spawn as any).mockReturnValue(mock1);
    const p1 = execute({ command: 'cd proj && npm run build' }, ctx);
    mock1.emit('close', 1);
    await p1;

    (spawn as any).mockClear();
    const mock2 = makeMockProcess();
    (spawn as any).mockReturnValue(mock2);
    const p2 = execute({ command: 'cd proj && npm run build' }, ctx);
    mock2.emit('close', 1);
    await p2;
    // Verification commands are exempt from the prefix breaker — must still spawn.
    expect(spawn).toHaveBeenCalled();
  });

  it('normalizes Windows cmd cd /d syntax to plain cd', async () => {
    const ctx = makeContext();
    const mock = makeMockProcess();
    (spawn as any).mockReturnValue(mock);

    const p = execute({ command: 'cd /d D:\\some\\path && ls' }, ctx);
    mock.emit('close', 0);
    await p;

    expect(spawn).toHaveBeenCalled();
    const spawnArgs = (spawn as any).mock.calls[0][1];
    expect(spawnArgs.join(' ')).toContain('cd "D:/some/path" && ls');
  });

  it('quotes and forward-slashes an unquoted Windows drive-path cd (bash backslash mangling)', async () => {
    const ctx = makeContext();
    const mock = makeMockProcess();
    (spawn as any).mockReturnValue(mock);

    const p = execute({ command: 'cd D:\\daedalus-sandbox\\daedalus-scan && dir' }, ctx);
    mock.emit('close', 0);
    await p;

    expect(spawn).toHaveBeenCalled();
    const spawnArgs = (spawn as any).mock.calls[0][1];
    expect(spawnArgs.join(' ')).toContain('cd "D:/daedalus-sandbox/daedalus-scan"');
    expect(spawnArgs.join(' ')).not.toContain('D:\\daedalus-sandbox');
  });

  describe('translateUnixToCmd', () => {
    it('converts single quotes to double quotes for cmd.exe', () => {
      expect(translateUnixToCmd("cat 'src/file.ts'")).toBe('type "src\\file.ts"');
    });

    it('translates /dev/null to NUL', () => {
      expect(translateUnixToCmd('npm test > /dev/null 2>&1')).toBe('npm test > NUL 2>&1');
    });

    it('translates export to set and which to where', () => {
      expect(translateUnixToCmd('export NODE_ENV=test && which vitest')).toBe('set NODE_ENV=test && where vitest');
    });

    it('translates ls and cat forward slashes to backslashes for cmd built-ins', () => {
      expect(translateUnixToCmd('ls node_modules/vitest/package.json')).toBe('dir node_modules\\vitest\\package.json');
      expect(translateUnixToCmd('cat src/cli.ts')).toBe('type src\\cli.ts');
    });
  });

});

