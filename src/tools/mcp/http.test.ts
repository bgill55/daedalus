import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { HttpTransport } from './http.js';
import type { MCPServerConfig } from './types.js';

function makeConfig(overrides: Partial<MCPServerConfig> = {}): MCPServerConfig {
  return {
    name: 'http-server',
    transport: 'http',
    url: 'http://localhost:8080/mcp',
    enabled: true,
    ...overrides,
  };
}

function makePostResponse(data: any = {}) {
  return {
    ok: true,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HttpTransport', () => {
  it('throws if no URL is configured', async () => {
    const transport = new HttpTransport(makeConfig({ url: undefined as any }));
    await expect(transport.connect()).rejects.toThrow('requires url');
  });

  it('connects and initializes via SSE + POST', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const transport = new HttpTransport(makeConfig());

    const sseResponse = {
      ok: true,
      body: new ReadableStream({
        start(controller: ReadableStreamDefaultController) {
          controller.enqueue(new TextEncoder().encode(
            'data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{}}}\n\n'
          ));
          controller.close();
        },
      }),
    };

    (global.fetch as any)
      .mockResolvedValueOnce(sseResponse)
      .mockResolvedValueOnce(makePostResponse({}))
      .mockResolvedValueOnce(makePostResponse({}));

    await transport.connect();
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('sendAndWait resolves via SSE response', async () => {
    let sseController: ReadableStreamDefaultController | null = null;

    vi.stubGlobal('fetch', vi.fn());

    const transport = new HttpTransport(makeConfig());

    const sseResponse = {
      ok: true,
      body: new ReadableStream({
        start(controller: ReadableStreamDefaultController) {
          sseController = controller;
        },
      }),
    };

    (global.fetch as any)
      .mockResolvedValueOnce(sseResponse)
      .mockResolvedValueOnce(makePostResponse({}))
      .mockResolvedValueOnce(makePostResponse({}))
      .mockResolvedValue(makePostResponse({}));

    await transport.connect();

    const resultPromise = transport.sendAndWait({ method: 'ping' });
    await new Promise<void>(r => setTimeout(r, 20));
    sseController!.enqueue(new TextEncoder().encode(
      'data: {"jsonrpc":"2.0","id":2,"result":{"data":"ok"}}\n\n'
    ));

    const result = await resultPromise;
    expect(result.result.data).toBe('ok');
  });

  it('sendAndWait rejects on timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());

    const transport = new HttpTransport(makeConfig());

    (global.fetch as any).mockResolvedValue(makePostResponse({}));

    const resultPromise = transport.sendAndWait({ method: 'slow' });
    vi.advanceTimersByTime(30000);

    await expect(resultPromise).rejects.toThrow('timeout');
    vi.useRealTimers();
  });

  it('callTool throws on error response', async () => {
    let sseController: ReadableStreamDefaultController | null = null;

    vi.stubGlobal('fetch', vi.fn());

    const transport = new HttpTransport(makeConfig());

    const sseResponse = {
      ok: true,
      body: new ReadableStream({
        start(controller: ReadableStreamDefaultController) {
          sseController = controller;
        },
      }),
    };

    (global.fetch as any)
      .mockResolvedValueOnce(sseResponse)
      .mockResolvedValueOnce(makePostResponse({}))
      .mockResolvedValueOnce(makePostResponse({}))
      .mockResolvedValue(makePostResponse({}));

    await transport.connect();

    const resultPromise = transport.callTool('fail', {});

    await new Promise<void>(r => setTimeout(r, 20));
    sseController!.enqueue(new TextEncoder().encode(
      'data: {"jsonrpc":"2.0","id":2,"error":{"message":"bad request"}}\n\n'
    ));

    await expect(resultPromise).rejects.toThrow('bad request');
  });

  it('disconnect closes SSE client', async () => {
    let sseController: ReadableStreamDefaultController | null = null;

    vi.stubGlobal('fetch', vi.fn());

    const transport = new HttpTransport(makeConfig());

    const sseResponse = {
      ok: true,
      body: new ReadableStream({
        start(controller: ReadableStreamDefaultController) {
          sseController = controller;
        },
      }),
    };

    (global.fetch as any)
      .mockResolvedValueOnce(sseResponse)
      .mockResolvedValueOnce(makePostResponse({}))
      .mockResolvedValueOnce(makePostResponse({}));

    await transport.connect();
    expect((transport as any).sseClient).not.toBeNull();

    await transport.disconnect();
    expect((transport as any).sseClient).toBeNull();
  });
});
