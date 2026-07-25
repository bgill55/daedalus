import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalRouter } from './index.js';
import type { RouterConfig } from './types.js';
import * as health from './health.js';

describe('Multi-Model Fallback Chain (Sprint 1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('excludes previously failed model when fallback occurs during route()', async () => {
    const config: RouterConfig = {
      strategy: 'priority',
      chain: [
        { name: 'primary-model', endpoint: 'http://localhost:1111/v1', model: 'm1', priority: 1, enabled: true },
        { name: 'secondary-model', endpoint: 'http://localhost:2222/v1', model: 'm2', priority: 2, enabled: true },
      ],
      healthCheckInterval: 30000,
      requestTimeout: 120000,
      defaultRateLimit: { rpm: 60, tpm: 100000 },
    };

    for (const m of config.chain) {
      health.markHealthy(m, 10);
    }

    const router = new LocalRouter(config);

    // Initial route selects primary-model
    const firstRoute = await router.route({ messages: [] });
    expect(firstRoute.model.name).toBe('primary-model');

    // Route with excluded set excludes primary-model and falls back to secondary-model
    const excluded = new Set<string>(['primary-model']);
    const secondRoute = await router.route({ messages: [] }, excluded);
    expect(secondRoute.model.name).toBe('secondary-model');
  });

  it('falls back to secondary model in chatCompletion if primary fails with an error', async () => {
    const config: RouterConfig = {
      strategy: 'priority',
      chain: [
        { name: 'failing-primary', endpoint: 'http://localhost:1111/v1', model: 'm1', priority: 1, enabled: true },
        { name: 'working-secondary', endpoint: 'http://localhost:2222/v1', model: 'm2', priority: 2, enabled: true },
      ],
      healthCheckInterval: 30000,
      requestTimeout: 120000,
      defaultRateLimit: { rpm: 60, tpm: 100000 },
    };

    for (const m of config.chain) {
      health.markHealthy(m, 10);
    }

    const router = new LocalRouter(config);

    // Mock client calls: primary throws API error, secondary succeeds
    const mockPrimaryClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('Rate limit 429 exceeded')),
        },
      },
      models: { list: vi.fn() },
    };

    const mockSecondaryClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            id: 'res-2',
            choices: [{ message: { role: 'assistant', content: 'Fallback response' } }],
          }),
        },
      },
      models: { list: vi.fn() },
    };

    // Override getOrCreateClient behavior internally
    (router as any).getOrCreateClient = (model: any) => {
      if (model.name === 'failing-primary') return mockPrimaryClient;
      return mockSecondaryClient;
    };

    const response = await router.chatCompletion({ messages: [{ role: 'user', content: 'Hello' }] });
    expect(response.choices[0].message.content).toBe('Fallback response');
    expect(router.lastRoutedModelName).toBe('working-secondary');
  });
});
