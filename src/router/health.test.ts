import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  checkModelHealth,
  getCachedHealth,
  markHealthy,
  markUnhealthy,
} from './health.js';
import type { ModelEntry } from './types.js';

let modelCounter = 0;

function makeModel(overrides: Partial<ModelEntry> = {}): ModelEntry {
  modelCounter++;
  return {
    name: `test-model-${modelCounter}`,
    endpoint: `http://localhost:${9000 + modelCounter}/v1`,
    model: `test-llm-${modelCounter}`,
    priority: 1,
    enabled: true,
    ...overrides,
  };
}

describe('Model health checking', () => {

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns unhealthy when server is unreachable', async () => {
    const model = makeModel({ endpoint: 'http://localhost:1/v1' });
    const health = await checkModelHealth(model, 1000);
    expect(health.healthy).toBe(false);
    expect(health.consecutiveFailures).toBeGreaterThan(0);
  });

  it('increments consecutive failures via markUnhealthy', () => {
    const model = makeModel();
    markUnhealthy(model, 'error');
    const h1 = getCachedHealth(model);
    expect(h1!.consecutiveFailures).toBe(1);

    markUnhealthy(model, 'error again');
    const h2 = getCachedHealth(model);
    expect(h2!.consecutiveFailures).toBe(2);
  });

  it('returns cached health if recent', async () => {
    const model = makeModel();
    markHealthy(model, 10);
    const cached = getCachedHealth(model);
    expect(cached).toBeDefined();
    expect(cached!.healthy).toBe(true);
    expect(cached!.latencyMs).toBe(10);
  });

  it('getCachedHealth returns undefined for unknown model', () => {
    const model = makeModel({ name: 'unknown-model' });
    expect(getCachedHealth(model)).toBeUndefined();
  });

  it('markHealthy sets health state', () => {
    const model = makeModel({ name: 'fresh-model' });
    markHealthy(model, 42);
    const health = getCachedHealth(model);
    expect(health).toBeDefined();
    expect(health!.healthy).toBe(true);
    expect(health!.latencyMs).toBe(42);
    expect(health!.consecutiveFailures).toBe(0);
  });

  it('markUnhealthy increments consecutive failures', () => {
    const model = makeModel({ name: 'failing-model' });
    markUnhealthy(model, 'timeout');
    const h1 = getCachedHealth(model);
    expect(h1!.healthy).toBe(false);
    expect(h1!.consecutiveFailures).toBe(1);

    markUnhealthy(model, 'timeout again');
    const h2 = getCachedHealth(model);
    expect(h2!.consecutiveFailures).toBe(2);
  });

  it('markHealthy resets consecutive failures after markUnhealthy', () => {
    const model = makeModel({ name: 'recovery-model' });
    markUnhealthy(model, 'error');
    markHealthy(model, 100);
    const health = getCachedHealth(model);
    expect(health!.healthy).toBe(true);
    expect(health!.consecutiveFailures).toBe(0);
  });

  it('handles endpoint without protocol scheme', async () => {
    const model = makeModel({ endpoint: 'localhost:9999/v1' });
    const health = await checkModelHealth(model, 500);
    expect(health).toBeDefined();
    expect('healthy' in health).toBe(true);
  });

  it('includes Authorization header when apiKey is present', async () => {
    const model = makeModel({ apiKey: 'sk-test-key' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch failed'));
    await checkModelHealth(model, 500);
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

});
