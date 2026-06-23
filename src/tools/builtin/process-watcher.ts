import { spawn, ChildProcess } from 'child_process';
import { ToolContext, ToolResult } from '../../types.js';

function formatError(error: string): ToolResult {
  return { toolCallId: '', name: '', success: false, content: '', error };
}

interface WatchedProcess {
  proc: ChildProcess;
  command: string;
  buffer: string[];
  startedAt: number;
  alive: boolean;
}

const RING_SIZE = 200;

const state: {
  watched: Map<string, WatchedProcess>;
  idCounter: number;
} = {
  watched: new Map(),
  idCounter: 0,
};

export function killAllWatchedProcesses(): void {
  for (const [, wp] of state.watched) {
    try { wp.proc.kill(); } catch { /* ignored */ }
  }
  state.watched.clear();
}

export async function watchProcess(
  args: { command: string; workdir?: string },
  context: ToolContext
): Promise<ToolResult> {
  try {
    const id = `proc_${++state.idCounter}`;
    const cwd = args.workdir ?? context.projectRoot;

    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/sh';
    const shellFlag = isWindows ? '/c' : '-c';

    const proc = spawn(shell, [shellFlag, args.command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    const wp: WatchedProcess = {
      proc,
      command: args.command,
      buffer: [],
      startedAt: Date.now(),
      alive: true,
    };

    const pushLine = (line: string) => {
      wp.buffer.push(line);
      if (wp.buffer.length > RING_SIZE) wp.buffer.shift();
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').forEach(l => pushLine(l));
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').forEach(l => pushLine(`[err] ${l}`));
    });
    proc.on('exit', code => {
      pushLine(`[exit] Process exited with code ${code}`);
      wp.alive = false;
    });

    state.watched.set(id, wp);

    return {
      toolCallId: '', name: 'watch_process', success: true,
      content: `Process started with id '${id}' (pid ${proc.pid}). Use read_process('${id}') to see output.`,
    };
  } catch (err: any) {
    return formatError(`watch_process failed: ${err.message}`);
  }
}

export async function readProcess(
  args: { id: string; lines?: number },
  _context: ToolContext
): Promise<ToolResult> {
  const wp = state.watched.get(args.id);
  if (!wp) return formatError(`No watched process with id '${args.id}'. Use watch_process first.`);

  const n = Math.min(args.lines ?? 50, RING_SIZE);
  const output = wp.buffer.slice(-n).join('\n') || '(no output yet)';
  const status = wp.alive ? 'running' : 'exited';
  return {
    toolCallId: '', name: 'read_process', success: true,
    content: `[${args.id}] ${wp.command} (${status})\n${'-'.repeat(40)}\n${output}`,
  };
}

export async function killProcess(
  args: { id: string },
  _context: ToolContext
): Promise<ToolResult> {
  const wp = state.watched.get(args.id);
  if (!wp) return formatError(`No watched process with id '${args.id}'.`);
  try {
    wp.proc.kill();
    wp.alive = false;
    state.watched.delete(args.id);
    return { toolCallId: '', name: 'kill_process', success: true, content: `Process '${args.id}' killed.` };
  } catch (err: any) {
    return formatError(`Failed to kill process: ${err.message}`);
  }
}
