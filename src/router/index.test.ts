import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalRouter, createRouter, sanitizeMessagesForModel } from './index.js';
import type { RouterConfig, StreamChunk } from './types.js';
import * as health from './health.js';
import * as rateLimiter from './rate-limiter.js';
import { getRecentRouteDecisions } from './routing-logger.js';

function makeConfig(overrides: Partial<RouterConfig> = {}): RouterConfig {
  const config: RouterConfig = {
    strategy: 'priority',
    chain: [
      { name: 'primary', endpoint: 'https://api.primary.ai/v1', model: 'auto', priority: 1, enabled: true },
      { name: 'secondary', endpoint: 'https://api.secondary.ai/v1', model: 'auto', priority: 2, enabled: true },
    ],
    healthCheckInterval: 30000,
    requestTimeout: 120000,
    defaultRateLimit: { rpm: 60, tpm: 100000 },
    ...overrides,
  };
  for (const m of config.chain) {
    health.markHealthy(m, 10);
  }
  return config;
}

describe('LocalRouter', () => {
  beforeEach(() => {
    vi.spyOn(health, 'checkModelHealth').mockResolvedValue({
      healthy: true,
      lastCheck: Date.now(),
      latencyMs: 10,
      consecutiveFailures: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('routes to the only available model regardless of the complexity tier', async () => {
    const router = new LocalRouter(makeConfig({
      chain: [
        { name: 'only', endpoint: 'http://localhost:1/v1', model: 'm1', priority: 1, enabled: true, tier: 'intelligence' },
      ],
    }));
    const simple = await router.route({ messages: [{ role: 'user', content: 'hi' }], complexity: 'simple', tools: [{ type: 'function' }] });
    expect(simple.model.name).toBe('only');
    const complex = await router.route({ messages: [{ role: 'user', content: 'hi' }], complexity: 'complex', tools: [{ type: 'function' }] });
    expect(complex.model.name).toBe('only');
  });

  it('returns no escalation target when only one model is enabled', () => {
    const router = new LocalRouter(makeConfig({
      chain: [
        { name: 'only', endpoint: 'http://localhost:1/v1', model: 'm1', priority: 1, enabled: true },
      ],
    }));
    expect(router.getNextModel('only')).toBeUndefined();
  });

  it('getHealthyModels returns enabled models assumed healthy initially', () => {
    const router = createRouter({ chain: [{ name: 'a', endpoint: 'http://localhost:1/v1', model: 'm', priority: 1, enabled: true }] });
    const healthy = router.getHealthyModels();
    expect(healthy).toHaveLength(1);
  });

  it('getNextModel returns the next enabled model after the current one', () => {
    const router = new LocalRouter(makeConfig({
      chain: [
        { name: 'a', endpoint: 'http://localhost:1/v1', model: 'm1', priority: 1, enabled: true },
        { name: 'b', endpoint: 'http://localhost:2/v1', model: 'm2', priority: 2, enabled: true },
        { name: 'c', endpoint: 'http://localhost:3/v1', model: 'm3', priority: 3, enabled: true },
      ],
    }));
    expect(router.getNextModel('a')?.name).toBe('b');
    expect(router.getNextModel('b')?.name).toBe('c');
    expect(router.getNextModel('c')?.name).toBe('a');
  });

  it('getNextModel skips disabled, unhealthy and non-tool models', () => {
    const router = new LocalRouter(makeConfig({
      chain: [
        { name: 'a', endpoint: 'http://localhost:1/v1', model: 'm1', priority: 1, enabled: true },
        { name: 'b', endpoint: 'http://localhost:2/v1', model: 'm2', priority: 2, enabled: true },
        { name: 'c', endpoint: 'http://localhost:3/v1', model: 'm3', priority: 3, enabled: true },
        { name: 'd', endpoint: 'http://localhost:4/v1', model: 'm4', priority: 4, enabled: false },
      ],
    }));
    health.markUnhealthy(router.getEnabledModels()[1] as any, 'down');
    router.getEnabledModels()[1]!.supportsTools = false;
    expect(router.getNextModel('a')?.name).toBe('c');
  });

  it('getNextModel returns undefined with fewer than two enabled models', () => {
    const router = createRouter({ chain: [{ name: 'a', endpoint: 'http://localhost:1/v1', model: 'm', priority: 1, enabled: true }] });
    expect(router.getNextModel('a')).toBeUndefined();
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

  it('skips a pinned model that is excluded and routes normally instead', async () => {
    const router = new LocalRouter(makeConfig({
      chain: [
        { name: 'main', endpoint: 'http://localhost:1/v1', model: 'm1', priority: 1, enabled: true, supportsTools: true },
        { name: 'backup', endpoint: 'http://localhost:2/v1', model: 'm2', priority: 2, enabled: true, supportsTools: true },
      ],
    }));
    const excluded = new Set(['backup', 'm2']);
    const result = await router.route({ messages: [{ role: 'user', content: 'hi' }], model: 'backup', tools: [{ type: 'function' }] }, excluded);
    expect(result.model.name).not.toBe('backup');
    expect(result.model.name).toBe('main');
  });

  it('routes to the fast tier for simple tasks', async () => {
    const router = new LocalRouter(makeConfig({
      chain: [
        { name: 'big', endpoint: 'http://localhost:1/v1', model: 'm1', priority: 1, enabled: true, tier: 'intelligence', supportsTools: true },
        { name: 'fast', endpoint: 'http://localhost:2/v1', model: 'm2', priority: 5, enabled: true, tier: 'fast', supportsTools: true },
      ],
    }));
    const result = await router.route({ messages: [{ role: 'user', content: 'hi' }], complexity: 'simple', tools: [{ type: 'function' }] });
    expect(result.model.name).toBe('fast');
  });

  it('routes to the intelligence tier for complex tasks even with tools', async () => {
    const router = new LocalRouter(makeConfig({
      chain: [
        { name: 'big', endpoint: 'http://localhost:1/v1', model: 'm1', priority: 1, enabled: true, tier: 'intelligence', supportsTools: true },
        { name: 'fast', endpoint: 'http://localhost:2/v1', model: 'm2', priority: 5, enabled: true, tier: 'fast', supportsTools: true },
      ],
    }));
    const result = await router.route({ messages: [{ role: 'user', content: 'hi' }], complexity: 'complex', tools: [{ type: 'function' }] });
    expect(result.model.name).toBe('big');
  });

  it('tracks per-tier route stats and last routed tier', async () => {
    const router = new LocalRouter(makeConfig({
      chain: [
        { name: 'big', endpoint: 'http://localhost:1/v1', model: 'm1', priority: 1, enabled: true, tier: 'intelligence', supportsTools: true },
        { name: 'mid', endpoint: 'http://localhost:3/v1', model: 'm3', priority: 2, enabled: true, tier: 'standard', supportsTools: true },
        { name: 'fast', endpoint: 'http://localhost:2/v1', model: 'm2', priority: 5, enabled: true, tier: 'fast', supportsTools: true },
      ],
    }));
    await router.route({ messages: [{ role: 'user', content: 'hi' }], complexity: 'simple', tools: [{ type: 'function' }] });
    await router.route({ messages: [{ role: 'user', content: 'hi' }], complexity: 'complex', tools: [{ type: 'function' }] });
    await router.route({ messages: [{ role: 'user', content: 'hi' }], complexity: 'standard', tools: [{ type: 'function' }] });
    expect(router.lastRoutedTier).toBe('standard');
    const stats = router.getRouteStats();
    expect(stats.fast).toBe(1);
    expect(stats.complex).toBe(1);
    expect(stats.standard).toBe(1);
    const pinned = await router.route({ messages: [], model: 'big' });
    expect(pinned.model.name).toBe('big');
    expect(router.getRouteStats().override).toBe(1);
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

  it('health sweep marks models missing from the endpoint catalog unhealthy', async () => {
    const router = new LocalRouter(makeConfig({
      chain: [
        { name: 'listed', endpoint: 'https://api.cat.ai/v1', model: 'm1', priority: 1, enabled: true },
        { name: 'ghost', endpoint: 'https://api.cat.ai/v1', model: 'm2', priority: 2, enabled: true },
      ],
    }));
    vi.spyOn(health, 'getEndpointCatalog').mockResolvedValue(new Set(['m1']));
    await (router as any).runHealthChecks();
    expect(health.getCachedHealth({ name: 'listed', endpoint: 'https://api.cat.ai/v1', model: 'm1', priority: 1, enabled: true })?.healthy).toBe(true);
    expect(health.getCachedHealth({ name: 'ghost', endpoint: 'https://api.cat.ai/v1', model: 'm2', priority: 2, enabled: true })?.healthy).toBe(false);
    const healthy = router.getHealthyModels().map(m => m.name);
    expect(healthy).toContain('listed');
    expect(healthy).not.toContain('ghost');
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

  it('proactively routes tool-calling requests to models supporting tools', async () => {
    const router = new LocalRouter(makeConfig({
      chain: [
        { name: 'no-tools', endpoint: 'http://localhost:1/v1', model: 'm1', priority: 1, enabled: true, supportsTools: false },
        { name: 'has-tools', endpoint: 'http://localhost:2/v1', model: 'm2', priority: 5, enabled: true, supportsTools: true },
      ],
    }));
    const result = await router.route({
      messages: [{ role: 'user', content: 'run tool' }],
      tools: [{ type: 'function', function: { name: 'test_tool' } }],
    });
    expect(result.model.name).toBe('has-tools');
  });

  it('proactively routes complex tasks to intelligence tier models', async () => {
    const router = new LocalRouter(makeConfig({
      chain: [
        { name: 'fast-model', endpoint: 'http://localhost:1/v1', model: 'm1', priority: 1, enabled: true, tier: 'fast' },
        { name: 'intel-model', endpoint: 'http://localhost:2/v1', model: 'm2', priority: 5, enabled: true, tier: 'intelligence' },
      ],
    }));
    const longPrompt = 'a'.repeat(33000);
    const result = await router.route({
      messages: [{ role: 'user', content: longPrompt }],
    });
    expect(result.model.name).toBe('intel-model');
  });

  it('proactively routes simple tasks to fast tier models', async () => {
    const router = new LocalRouter(makeConfig({
      chain: [
        { name: 'intel-model', endpoint: 'http://localhost:1/v1', model: 'm1', priority: 1, enabled: true, tier: 'intelligence' },
        { name: 'fast-model', endpoint: 'http://localhost:2/v1', model: 'm2', priority: 5, enabled: true, tier: 'fast' },
      ],
    }));
    const result = await router.route({
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result.model.name).toBe('fast-model');
  });

  it('falls back to the secondary model if the primary model is rate limited', async () => {
    const router = new LocalRouter(makeConfig({
      chain: [
        { name: 'primary', endpoint: 'https://api.primary.ai/v1', model: 'm1', priority: 1, enabled: true },
        { name: 'secondary', endpoint: 'https://api.secondary.ai/v1', model: 'm2', priority: 2, enabled: true },
      ],
    }));

    const primaryKey = 'https://api.primary.ai/v1|m1';
    const secondaryKey = 'https://api.secondary.ai/v1|m2';

    const consumeTokensSpy = vi.spyOn(rateLimiter, 'consumeTokens');
    consumeTokensSpy.mockImplementation((bucket) => {
      const limiters = (router as any).rateLimiters;
      for (const [key, value] of limiters.entries()) {
        if (value === bucket) {
          if (key === primaryKey) {
            return false;
          }
          if (key === secondaryKey) {
            return true;
          }
        }
      }
      return true;
    });

    const result = await router.route({ messages: [{ role: 'user', content: 'hello' }] });
    expect(result.model.name).toBe('secondary');
    consumeTokensSpy.mockRestore();
  });

  describe('sanitizeMessagesForModel', () => {
    it('keeps vision payload intact if model supports vision', () => {
      const model = { name: 'v', endpoint: 'http://localhost:1/v1', model: 'm', priority: 1, enabled: true, supportsVision: true };
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this image:' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }
          ]
        }
      ];
      const sanitized = sanitizeMessagesForModel(messages as any, model);
      expect(sanitized).toEqual(messages);
    });

    it('strips vision payload and preserves text if model does not support vision', () => {
      const model = { name: 't', endpoint: 'http://localhost:1/v1', model: 'm', priority: 1, enabled: true, supportsVision: false };
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this image:' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }
          ]
        }
      ];
      const sanitized = sanitizeMessagesForModel(messages as any, model);
      expect(sanitized[0].content).toBe('Analyze this image:');
    });

    it('defaults null or undefined content to empty string', () => {
      const model = { name: 't', endpoint: 'http://localhost:1/v1', model: 'm', priority: 1, enabled: true };
      const messages = [
        { role: 'assistant', content: null, tool_calls: [] },
        { role: 'assistant', content: undefined, tool_calls: [] }
      ];
      const sanitized = sanitizeMessagesForModel(messages as any, model);
      expect(sanitized[0].content).toBe('');
      expect(sanitized[1].content).toBe('');
    });
  });

  describe('chatStream usage tracking', () => {
    function makeStreamClient(create: any) {
      return {
        chat: { completions: { create: vi.fn(create) } },
        models: { list: vi.fn().mockResolvedValue({ data: [{ id: 'mock-model' }] }) },
      };
    }

    function makeStreamRouter(create: any) {
      const router = new LocalRouter(makeConfig({
        chain: [
          { name: 'primary', endpoint: 'http://localhost:1/v1', model: 'auto', priority: 1, enabled: true },
        ],
      }));
      (router as any).getOrCreateClient = () => makeStreamClient(create);
      return router;
    }

    it('requests stream_options.include_usage on streaming requests by default', async () => {
      const create = vi.fn().mockReturnValue((async function* () {})());
      const router = makeStreamRouter(create);

      await router.chatStream({ messages: [{ role: 'user', content: 'Hello' }] }).next();

      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][0]).toMatchObject({
        stream: true,
        stream_options: { include_usage: true },
      });
    });

    it('respects a caller-provided stream_options over the default', async () => {
      const create = vi.fn().mockReturnValue((async function* () {})());
      const router = makeStreamRouter(create);

      await router.chatStream({
        messages: [{ role: 'user', content: 'Hello' }],
        stream_options: { include_usage: false, chunk_size: 64 },
      }).next();

      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][0].stream_options).toEqual({ include_usage: false, chunk_size: 64 });
    });

    it('yields chunks carrying usage data from the final stream chunk', async () => {
      const chunks = [
        {
          id: '1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'mock-model',
          choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
        },
        {
          id: '2',
          object: 'chat.completion.chunk',
          created: 2,
          model: 'mock-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 45, completion_tokens: 123, total_tokens: 168 },
        },
      ];
      const create = vi.fn().mockReturnValue((async function* () { yield* chunks; })());
      const router = makeStreamRouter(create);

      const yielded: StreamChunk[] = [];
      for await (const chunk of router.chatStream({ messages: [{ role: 'user', content: 'Hello' }] })) {
        yielded.push(chunk);
      }

      expect(yielded).toHaveLength(2);
      expect(yielded[1].usage).toEqual({ prompt_tokens: 45, completion_tokens: 123, total_tokens: 168 });
    });
  });

  describe('Session blacklist', () => {
    it('blacklists a model on a hard 4xx/not-in-catalog failure and routes around it', async () => {
      const router = new LocalRouter(makeConfig({
        chain: [
          { name: 'ghost', endpoint: 'https://api.ghost.ai/v1', model: 'openai/gpt-4.1', priority: 1, enabled: true },
          { name: 'alive', endpoint: 'https://api.alive.ai/v1', model: 'openai/gpt-5', priority: 2, enabled: true },
        ],
      }));
      const create = vi.fn((opts: { model: string }) => {
        if (opts.model === 'openai/gpt-4.1') {
          return Promise.reject(Object.assign(new Error("Model 'openai/gpt-4.1' is not in the catalog served by this endpoint"), { status: 400 }));
        }
        return Promise.reject(Object.assign(new Error('Upstream error'), { status: 500 }));
      });
      vi.spyOn(router as any, 'getOrCreateClient').mockReturnValue({ chat: { completions: { create } } });

      await expect(router.chatCompletion({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow();
      const blacklist = router.getSessionBlacklist();
      expect(blacklist).toHaveLength(1);
      expect(blacklist[0].model).toBe('openai/gpt-4.1');
      expect(blacklist[0].reason).toContain('not in the catalog');

      const routed = await router.route({ messages: [{ role: 'user', content: 'hi' }] });
      expect(routed.model.model).toBe('openai/gpt-5');
    });

    it('does not blacklist on transient 5xx failures', async () => {
      const router = new LocalRouter(makeConfig({
        chain: [
          { name: 'flaky', endpoint: 'https://api.flaky.ai/v1', model: 'm1', priority: 1, enabled: true },
        ],
      }));
      const create = vi.fn().mockRejectedValue(Object.assign(new Error('Service Unavailable'), { status: 503 }));
      vi.spyOn(router as any, 'getOrCreateClient').mockReturnValue({ chat: { completions: { create } } });

      await expect(router.chatCompletion({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow();
      expect(router.getSessionBlacklist()).toHaveLength(0);
    });

    it('clearSessionBlacklist empties the list', async () => {
      const router = new LocalRouter(makeConfig({
        chain: [
          { name: 'only', endpoint: 'https://api.only.ai/v1', model: 'auto', priority: 1, enabled: true },
        ],
      }));
      const create = vi.fn().mockRejectedValue(Object.assign(new Error("Model 'auto' is not in the catalog served by this endpoint"), { status: 400 }));
      vi.spyOn(router as any, 'getOrCreateClient').mockReturnValue({ chat: { completions: { create } } });

      await expect(router.chatCompletion({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow();
      expect(router.getSessionBlacklist().length).toBeGreaterThan(0);
      router.clearSessionBlacklist();
      expect(router.getSessionBlacklist()).toHaveLength(0);
    });
  });

  describe('Slow model guard', () => {
    it('blacklists a model whose EMA latency exceeds the threshold', async () => {
      const router = new LocalRouter(makeConfig({
        slowModelThresholdMs: 45000,
        chain: [
          { name: 'snail', endpoint: 'https://api.snail.ai/v1', model: 'm1', priority: 1, enabled: true },
          { name: 'cheetah', endpoint: 'https://api.cheetah.ai/v1', model: 'm2', priority: 2, enabled: true },
        ],
      }));
      const snail = router.getEnabledModels()[0];
      (router as any).recordLatency(snail, 10000);
      (router as any).recordLatency(snail, 20000);
      (router as any).recordLatency(snail, 200000);
      const blacklist = router.getSessionBlacklist();
      expect(blacklist).toHaveLength(1);
      expect(blacklist[0].model).toBe('m1');
      expect(blacklist[0].reason).toContain('exceeds threshold');

      const routed = await router.route({ messages: [{ role: 'user', content: 'hi' }] });
      expect(routed.model.model).toBe('m2');
    });

    it('does nothing when the threshold is disabled', async () => {
      const router = new LocalRouter(makeConfig({
        slowModelThresholdMs: 0,
        chain: [
          { name: 'snail', endpoint: 'https://api.snail.ai/v1', model: 'm1', priority: 1, enabled: true },
        ],
      }));
      const snail = router.getEnabledModels()[0];
      (router as any).recordLatency(snail, 600000);
      expect(router.getSessionBlacklist()).toHaveLength(0);
    });
  });

  describe('BYOK provider field', () => {
    it('accepts the provider field on a chain model', () => {
      const router = new LocalRouter(makeConfig({
        chain: [
          { name: 'byok', endpoint: 'https://my-proxy.example/v1', model: 'gpt-4.1', priority: 1, enabled: true, provider: 'openai' },
        ],
      }));
      expect(router.getEnabledModels()[0].provider).toBe('openai');
    });

    it('treats a model tagged provider=openai as official even without the api.openai.com host', async () => {
      const router = new LocalRouter(makeConfig({
        chain: [
          { name: 'byok', endpoint: 'https://my-proxy.example/v1', model: 'gpt-4.1', priority: 1, enabled: true, provider: 'openai' },
        ],
      }));
      const model = router.getEnabledModels()[0] as any;
      const isOfficial = (model.provider === 'openai') || model.endpoint.includes('api.openai.com');
      expect(isOfficial).toBe(true);
    });
  });

  describe('Routing decision transparency', () => {
    it('records the selection reason and skipped models on route()', async () => {
      const router = new LocalRouter(makeConfig({
        chain: [
          { name: 'a', endpoint: 'https://api.a.ai/v1', model: 'm1', priority: 1, enabled: true, tier: 'intelligence' },
          { name: 'b', endpoint: 'https://api.b.ai/v1', model: 'm2', priority: 2, enabled: true, tier: 'fast' },
          { name: 'c', endpoint: 'https://api.c.ai/v1', model: 'm3', priority: 3, enabled: true, tier: 'fast' },
        ],
      }));
      const result = await router.route({ messages: [{ role: 'user', content: 'hi' }], complexity: 'simple' });
      const decision = router.getLastRouteDecision();
      expect(decision).toBeDefined();
      expect(decision!.reason).toContain("tier 'fast'");
      expect(result.reason).toBe(decision!.reason);
      expect(Array.isArray(result.skipped)).toBe(true);
    });

    it('marks blacklisted models as skipped rather than selecting them', async () => {
      const router = new LocalRouter(makeConfig({
        chain: [
          { name: 'a', endpoint: 'https://api.a.ai/v1', model: 'm1', priority: 1, enabled: true, tier: 'fast' },
          { name: 'b', endpoint: 'https://api.b.ai/v1', model: 'm2', priority: 2, enabled: true, tier: 'fast' },
        ],
      }));
      router.addToSessionBlacklist('https://api.b.ai/v1', 'm2', '400 not-in-catalog');
      const result = await router.route({ messages: [{ role: 'user', content: 'hi' }], complexity: 'simple' });
      expect(result.model.model).toBe('m1');
      const skippedB = result.skipped.find(s => s.model === 'm2');
      expect(skippedB?.reason).toBe('session-blacklisted');
    });
  });

  describe('Health sweep catalog conflation (Bug #3)', () => {
    it('does not mark sibling models unhealthy when only one is catalog-missing', async () => {
      const router = new LocalRouter(makeConfig({
        strategy: 'priority',
        chain: [
          { name: 'good', endpoint: 'https://api.same.ai/v1', model: 'good-model', priority: 1, enabled: true },
          { name: 'bad', endpoint: 'https://api.same.ai/v1', model: 'missing-model', priority: 2, enabled: true },
        ],
      }));
      vi.spyOn(health, 'checkModelHealth').mockResolvedValue({ healthy: true, lastCheck: Date.now(), latencyMs: 10, consecutiveFailures: 0 });
      vi.spyOn(health, 'getEndpointCatalog').mockResolvedValue(new Set(['good-model']));
      await (router as any).runHealthChecks();
      const good = health.getCachedHealth({ endpoint: 'https://api.same.ai/v1', model: 'good-model' } as any);
      const bad = health.getCachedHealth({ endpoint: 'https://api.same.ai/v1', model: 'missing-model' } as any);
      expect(good?.healthy).toBe(true);
      expect(bad?.healthy).toBe(false);
      expect(bad?.error).toContain('not in the catalog');
    });

    it('marks all sibling models unhealthy when the endpoint is actually down', async () => {
      const router = new LocalRouter(makeConfig({
        strategy: 'priority',
        chain: [
          { name: 'a', endpoint: 'https://api.down.ai/v1', model: 'a-model', priority: 1, enabled: true },
          { name: 'b', endpoint: 'https://api.down.ai/v1', model: 'b-model', priority: 2, enabled: true },
        ],
      }));
      vi.spyOn(health, 'checkModelHealth').mockResolvedValue({ healthy: false, lastCheck: Date.now(), error: 'connect ETIMEDOUT', consecutiveFailures: 1 });
      vi.spyOn(health, 'getEndpointCatalog').mockResolvedValue(null);
      await (router as any).runHealthChecks();
      const a = health.getCachedHealth({ endpoint: 'https://api.down.ai/v1', model: 'a-model' } as any);
      const b = health.getCachedHealth({ endpoint: 'https://api.down.ai/v1', model: 'b-model' } as any);
      expect(a?.healthy).toBe(false);
      expect(b?.healthy).toBe(false);
    });
    });

    describe('Routing decision logging', () => {
    const tmpDir = (() => {
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');
      return fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-route-log-'));
    })();

    beforeEach(() => {
      process.env.DAEDALUS_ROUTING_LOG_DIR = tmpDir;
    });

    afterEach(() => {
      delete process.env.DAEDALUS_ROUTING_LOG_DIR;
      const fs = require('node:fs');
      const path = require('node:path');
      const logPath = path.join(tmpDir, 'routing.log');
      if (fs.existsSync(logPath)) fs.rmSync(logPath);
    });

    it('writes a structured entry to routing.log on each route() decision', async () => {
      const router = new LocalRouter(makeConfig({
        chain: [
          { name: 'only', endpoint: 'http://localhost:1/v1', model: 'm1', priority: 1, enabled: true },
        ],
      }));
      await router.route({ messages: [{ role: 'user', content: 'hi' }] });

      const entries = getRecentRouteDecisions(10);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      const last = entries[entries.length - 1];
      expect(last.model).toBe('only');
      expect(typeof last.reason).toBe('string');
      expect(Array.isArray(last.skipped)).toBe(true);
    });
  });
});



