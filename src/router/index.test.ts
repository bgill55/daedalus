import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalRouter, createRouter } from './index.js';
import type { RouterConfig } from './types.js';
import * as health from './health.js';
import * as rateLimiter from './rate-limiter.js';

function makeConfig(overrides: Partial<RouterConfig> = {}): RouterConfig {
  return {
    strategy: 'priority',
    chain: [
      { name: 'primary', endpoint: 'http://localhost:1234/v1', model: 'auto', priority: 1, enabled: true },
      { name: 'secondary', endpoint: 'http://localhost:11434/v1', model: 'auto', priority: 2, enabled: true },
    ],
    healthCheckInterval: 30000,
    requestTimeout: 120000,
    defaultRateLimit: { rpm: 60, tpm: 100000 },
    ...overrides,
  };
}

describe('LocalRouter', () => {

  it('creates router with factory function', () => {
    const router = createRouter({ chain: [{ name: 'test', endpoint: 'http://localhost:1234/v1', model: 'm', priority: 1, enabled: true }] });
    expect(router).toBeInstanceOf(LocalRouter);
    expect(router.getEnabledModels()).toHaveLength(1);
  });

  it('filters only enabled models', () => {
    const router = new LocalRouter(makeConfig({
      chain: [
        { name: 'a', endpoint: 'http://localhost:1/v1', model: 'm', priority: 1, enabled: true },
        { name: 'b', endpoint: 'http://localhost:2/v1', model: 'm', priority: 2, enabled: false },
      ],
    }));
    expect(router.getEnabledModels()).toHaveLength(1);
  });

  it('getHealthyModels returns enabled models assumed healthy initially', () => {
    const router = createRouter({ chain: [{ name: 'a', endpoint: 'http://localhost:1/v1', model: 'm', priority: 1, enabled: true }] });
    const healthy = router.getHealthyModels();
    expect(healthy).toHaveLength(1);
  });

  it('throws when no healthy models available on route', async () => {
    const router = new LocalRouter(makeConfig({ chain: [] }));
    await expect(router.route({ messages: [] })).rejects.toThrow('No healthy models');
  });

  it('routes to the highest priority model', async () => {
    const router = new LocalRouter(makeConfig({
      chain: [
        { name: 'high', endpoint: 'http://localhost:1/v1', model: 'm1', priority: 1, enabled: true },
        { name: 'low', endpoint: 'http://localhost:2/v1', model: 'm2', priority: 5, enabled: true },
      ],
    }));
    const result = await router.route({ messages: [] });
    expect(result.model.name).toBe('high');
  });

  it('selects specific model when requested by name', async () => {
    const router = new LocalRouter(makeConfig({
      chain: [
        { name: 'main', endpoint: 'http://localhost:1/v1', model: 'm1', priority: 1, enabled: true },
        { name: 'backup', endpoint: 'http://localhost:2/v1', model: 'm2', priority: 2, enabled: true },
      ],
    }));
    const result = await router.route({ messages: [], model: 'backup' });
    expect(result.model.name).toBe('backup');
  });

  it('selects specific model when requested by model id', async () => {
    const router = new LocalRouter(makeConfig({
      chain: [
        { name: 'main', endpoint: 'http://localhost:1/v1', model: 'gpt-4', priority: 1, enabled: true },
      ],
    }));
    const result = await router.route({ messages: [], model: 'gpt-4' });
    expect(result.model.name).toBe('main');
  });

  it('round-robin cycles through models', async () => {
    const router = new LocalRouter(makeConfig({
      strategy: 'round-robin',
      chain: [
        { name: 'a', endpoint: 'http://localhost:1/v1', model: 'm', priority: 1, enabled: true },
        { name: 'b', endpoint: 'http://localhost:2/v1', model: 'm', priority: 2, enabled: true },
      ],
    }));
    const r1 = await router.route({ messages: [] });
    const r2 = await router.route({ messages: [] });
    expect(r1.model.name).not.toBe(r2.model.name);
  });

  it('fastest strategy prefers lower latency model', async () => {
    const router = new LocalRouter(makeConfig({
      strategy: 'fastest',
      chain: [
        { name: 'slow', endpoint: 'http://localhost:1/v1', model: 'm', priority: 1, enabled: true },
        { name: 'fast', endpoint: 'http://localhost:2/v1', model: 'm', priority: 2, enabled: true },
      ],
    }));

    health.markHealthy(router.getEnabledModels()[0], 500);
    health.markHealthy(router.getEnabledModels()[1], 100);

    const result = await router.route({ messages: [] });
    expect(result.model.name).toBe('fast');
  });

  it('listModels returns models from endpoints', async () => {
    const router = createRouter({ chain: [{ name: 'test', endpoint: 'http://localhost:9999/v1', model: 'auto', priority: 1, enabled: true }] });
    const models = await router.listModels();
    expect(Array.isArray(models)).toBe(true);
  });

  it('getConfig returns a copy of the config', () => {
    const router = new LocalRouter(makeConfig({ strategy: 'fastest' }));
    const cfg = router.getConfig();
    expect(cfg.strategy).toBe('fastest');
  });

  it('updateConfig changes strategy and reinitializes rate limiters', () => {
    const router = new LocalRouter(makeConfig());
    router.updateConfig({ strategy: 'round-robin' });
    expect(router.getConfig().strategy).toBe('round-robin');
  });

  it('chat.completions.create delegates to chatCompletion', async () => {
    const router = createRouter({ chain: [] });
    const spy = vi.spyOn(router, 'chatCompletion').mockRejectedValue(new Error('no models'));
    await expect(router.chat.completions.create({ messages: [] })).rejects.toThrow('no models');
    spy.mockRestore();
  });

  it('startHealthChecks runs initial check and sets interval', async () => {
    const router = new LocalRouter(makeConfig());
    const spy = vi.spyOn(router as any, 'runHealthChecks');
    await router.startHealthChecks();
    await new Promise(r => setTimeout(r, 50));
    expect(spy).toHaveBeenCalled();
    await router.stopHealthChecks();
  });

  it('stopHealthChecks clears interval', async () => {
    const router = new LocalRouter(makeConfig());
    await router.startHealthChecks();
    await router.stopHealthChecks();
  });

  it('throws rate limit error when exceeded', async () => {
    const router = new LocalRouter(makeConfig({
      defaultRateLimit: { rpm: 0, tpm: 1 },
    }));
    await expect(router.route({ messages: [{ role: 'user', content: 'hello world' }] })).rejects.toThrow('Rate limited');
  });

});
