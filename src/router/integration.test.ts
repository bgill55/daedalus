import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo, Server } from 'node:net';
import type { RouterConfig } from './types.js';

/**
 * Integration tests for the router supply-chain path using a real local HTTP
 * server stubbing an OpenAI-compatible /v1/models (and /v1/chat/completions)
 * endpoint. These prove the catalog probe -> not-in-catalog mark-unhealthy ->
 * route-around chain works over actual fetch, which the mocked unit tests
 * cannot cover.
 */

interface ServerState {
  catalog: Set<string>;
  modelsStatus: number;
  chatStatus: number;
  chatBody: unknown;
}

function createServer(state: ServerState): Promise<Server> {
  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    if (url.includes('/models')) {
      res.writeHead(state.modelsStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: Array.from(state.catalog).map(id => ({ id })) }));
      return;
    }
    if (url.includes('/chat/completions')) {
      res.writeHead(state.chatStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state.chatBody));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function baseUrl(server: Server): string {
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/v1`;
}

function makeConfig(chain: Array<Omit<RouterConfig['chain'][number], 'endpoint'>>, endpoint: string): RouterConfig {
  return {
    strategy: 'priority',
    chain: chain.map(c => ({ ...c, endpoint })),
    healthCheckInterval: 30000,
    requestTimeout: 120000,
    defaultRateLimit: { rpm: 60, tpm: 100000 },
  };
}

const OK_CHAT = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
};

describe('Router supply-chain integration (real /v1/models fetch)', () => {
  let server: Server;
  let state: ServerState;

  beforeEach(async () => {
    state = { catalog: new Set(), modelsStatus: 200, chatStatus: 200, chatBody: OK_CHAT };
    server = await createServer(state);
    vi.resetModules();
  });

  afterEach(() => {
    server.close();
    vi.restoreAllMocks();
  });

  it('marks a configured model unhealthy when absent from the endpoint catalog', async () => {
    const { LocalRouter } = await import('./index.js');
    const { getCachedHealth, getEndpointCatalog } = await import('./health.js');
    const endpoint = baseUrl(server);
    // Catalog serves gpt-4.1 but NOT the configured gpt-4o
    state.catalog = new Set(['gpt-4.1']);
    const router = new LocalRouter(makeConfig(
      [{ name: 'primary', model: 'gpt-4o', priority: 1, enabled: true }],
      endpoint,
    ));

    await router.runHealthChecks();

    const health = getCachedHealth({ endpoint, model: 'gpt-4o' } as never);
    expect(health?.healthy).toBe(false);
    expect(health?.error).toMatch(/not in the catalog/i);
    // The catalog itself was fetched successfully (endpoint reachable)
    expect(await getEndpointCatalog(endpoint, undefined)).toEqual(new Set(['gpt-4.1']));
  });

  it('keeps a configured model healthy when present in the catalog', async () => {
    const { LocalRouter } = await import('./index.js');
    const { getCachedHealth } = await import('./health.js');
    const endpoint = baseUrl(server);
    state.catalog = new Set(['gpt-4.1']);
    const router = new LocalRouter(makeConfig(
      [{ name: 'primary', model: 'gpt-4.1', priority: 1, enabled: true }],
      endpoint,
    ));

    await router.runHealthChecks();

    const health = getCachedHealth({ endpoint, model: 'gpt-4.1' } as never);
    expect(health?.healthy).toBe(true);
  });

  it('does not poison sibling models when only one is catalog-missing (Bug #3 regression)', async () => {
    const { LocalRouter } = await import('./index.js');
    const { getCachedHealth } = await import('./health.js');
    const endpoint = baseUrl(server);
    // Endpoint is reachable and serves gpt-4.1, but the first configured model
    // (gpt-4o) is absent. The sibling gpt-4.1 must stay healthy.
    state.catalog = new Set(['gpt-4.1']);
    const router = new LocalRouter(makeConfig([
      { name: 'missing', model: 'gpt-4o', priority: 1, enabled: true },
      { name: 'present', model: 'gpt-4.1', priority: 2, enabled: true },
    ], endpoint));

    await router.runHealthChecks();

    const missing = getCachedHealth({ endpoint, model: 'gpt-4o' } as never);
    const present = getCachedHealth({ endpoint, model: 'gpt-4.1' } as never);
    expect(missing?.healthy).toBe(false);
    expect(present?.healthy).toBe(true);
  });

  it('routes around a catalog-missing model to a healthy one', async () => {
    const { LocalRouter } = await import('./index.js');
    const endpoint = baseUrl(server);
    state.catalog = new Set(['gpt-4.1']);
    const router = new LocalRouter(makeConfig([
      { name: 'missing', model: 'gpt-4o', priority: 1, enabled: true },
      { name: 'present', model: 'gpt-4.1', priority: 2, enabled: true },
    ], endpoint));

    await router.runHealthChecks();
    const routed = await router.route({ messages: [{ role: 'user', content: 'hi' }] });

    expect(routed.model.name).toBe('present');
  });

  it('treats auto-routed models as catalog-agnostic (always healthy on reachable endpoint)', async () => {
    const { LocalRouter } = await import('./index.js');
    const { getCachedHealth } = await import('./health.js');
    const endpoint = baseUrl(server);
    state.catalog = new Set(['something-else']);
    const router = new LocalRouter(makeConfig(
      [{ name: 'primary', model: 'auto', priority: 1, enabled: true }],
      endpoint,
    ));

    await router.runHealthChecks();

    const health = getCachedHealth({ endpoint, model: 'auto' } as never);
    expect(health?.healthy).toBe(true);
  });
});
