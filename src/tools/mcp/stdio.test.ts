import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
import { StdioTransport } from './stdio.js';
import type { MCPServerConfig } from './types.js';

function makeMockProcess() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter() as any;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = { write: vi.fn(), end: vi.fn(), writable: true };
  proc.kill = vi.fn();
  proc.pid = 9999;
  return proc;
}

function makeConfig(overrides: Partial<MCPServerConfig> = {}): MCPServerConfig {
  return {
    name: 'test-server',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    enabled: true,
    ...overrides,
  };
}

function emit(proc: any, data: string) {
  proc.stdout.emit('data', Buffer.from(data));
}

/** Attach the internal stdout data handler that connect() would register */
function attachStdoutHandler(transport: StdioTransport, mockProc: any) {
  mockProc.stdout?.on('data', (data: Buffer) => {
    (transport as any).buffer += data.toString();
    (transport as any).processBuffer();
  });
}

/** Full connect handshake helper */
async function connectTransport(transport: StdioTransport, mockProc: any) {
  const connectPromise = transport.connect();
  await new Promise<void>(r => setTimeout(r, 20));
  emit(mockProc, JSON.stringify({
    jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: {} },
  }) + '\n');
  await new Promise<void>(r => setTimeout(r, 20));
  emit(mockProc, JSON.stringify({
    jsonrpc: '2.0', id: 2, result: { tools: [] },
  }) + '\n');
  await connectPromise;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StdioTransport', () => {
  it('rejects command with shell metacharacters', async () => {
    const transport = new StdioTransport(makeConfig({ command: 'node; rm -rf /' }));
    await expect(transport.connect()).rejects.toThrow('shell metacharacters');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('throws if no command is configured', async () => {
    const transport = new StdioTransport(makeConfig({ command: undefined as any }));
    await expect(transport.connect()).rejects.toThrow('requires command');
  });

  it('connects and initializes successfully', async () => {
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);
    const transport = new StdioTransport(makeConfig());
    await connectTransport(transport, mockProc);
    expect(spawn).toHaveBeenCalledWith('node', ['server.js'], expect.any(Object));
    expect(mockProc.stdin.write).toHaveBeenCalled();
  });

  it('sendAndWait resolves with matching response', async () => {
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);
    const transport = new StdioTransport(makeConfig());

    (transport as any).process = mockProc;
    attachStdoutHandler(transport, mockProc);

    const resultPromise = transport.sendAndWait({ jsonrpc: '2.0', method: 'ping' });
    await new Promise<void>(r => setTimeout(r, 20));
    emit(mockProc, JSON.stringify({
      jsonrpc: '2.0', id: 1, result: { data: 'ok' },
    }) + '\n');

    expect(await resultPromise).toMatchObject({ result: { data: 'ok' } });
  });

  it('sendAndWait rejects on timeout', async () => {
    vi.useFakeTimers();
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);
    const transport = new StdioTransport(makeConfig());

    (transport as any).process = mockProc;
    attachStdoutHandler(transport, mockProc);

    const resultPromise = transport.sendAndWait({ method: 'slow' });
    vi.advanceTimersByTime(30000);

    await expect(resultPromise).rejects.toThrow('timeout');
    vi.useRealTimers();
  });

  it('callTool throws on error response', async () => {
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);
    const transport = new StdioTransport(makeConfig());

    (transport as any).process = mockProc;
    attachStdoutHandler(transport, mockProc);

    const resultPromise = transport.callTool('fail', {});
    await new Promise<void>(r => setTimeout(r, 20));
    emit(mockProc, JSON.stringify({
      jsonrpc: '2.0', id: 1, error: { message: 'oops' },
    }) + '\n');

    await expect(resultPromise).rejects.toThrow('oops');
  });

  it('disconnect kills process', async () => {
    const mockProc = makeMockProcess();
    (spawn as any).mockReturnValue(mockProc);
    const transport = new StdioTransport(makeConfig());
    (transport as any).process = mockProc;

    await transport.disconnect();
    expect(mockProc.kill).toHaveBeenCalled();
    expect((transport as any).process).toBeNull();
  });
});
