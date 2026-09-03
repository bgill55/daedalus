import { describe, it, expect } from 'vitest';
import { LocalRouter } from './index.js';
import * as health from './health.js';
import type { RouterConfig, ModelEntry } from './types.js';

describe('Vision Routing with Model Override', () => {
  const chain: ModelEntry[] = [
    {
      name: 'text-model-pinned',
      endpoint: 'http://localhost:11434/v1',
      model: 'text-only',
      priority: 1,
      enabled: true,
      supportsTools: true,
      supportsVision: false,
      tier: 'intelligence'
    },
    {
      name: 'vision-model',
      endpoint: 'http://localhost:11434/v1',
      model: 'vision-capable',
      priority: 2,
      enabled: true,
      supportsTools: true,
      supportsVision: true,
      tier: 'intelligence'
    }
  ];

  const config: RouterConfig = {
    strategy: 'priority',
    chain,
    healthCheckInterval: 60000,
    requestTimeout: 5000,
    slowModelThresholdMs: 45000,
    blacklistTtlMs: 600000,
    blacklistPersist: false,
    defaultRateLimit: { rpm: 60, tpm: 100000 },
    autoEscalate: true,
    complexityRouting: true
  };

  it('routes to a vision-capable model when image is present even if text-only model is pinned', async () => {
    for (const m of chain) {
      health.markHealthy(m, 10);
    }
    const router = new LocalRouter(config);
    const selected = await router.route({
      model: 'text-model-pinned',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look at this screenshot' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,123' } }
          ]
        }
      ]
    });

    expect(selected.model.supportsVision).toBe(true);
    expect(selected.model.name).toBe('vision-model');
  });
});
