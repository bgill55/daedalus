import { describe, it, expect } from 'vitest';
import { buildModelLabel } from './model-select.js';

const model = { name: 'qwen', endpoint: 'https://x/v1', model: 'qwen2.5' };

describe('buildModelLabel', () => {
  it('shows a green dot for a healthy model', () => {
    const label = buildModelLabel(model, { health: { healthy: true, lastCheck: 0, consecutiveFailures: 0 } });
    expect(label).toContain('{green-fg}●{/}');
    expect(label).toContain('qwen');
  });

  it('shows a red dot and the error for an unhealthy model', () => {
    const label = buildModelLabel(model, { health: { healthy: false, lastCheck: 0, consecutiveFailures: 1, error: 'not in the catalog' } });
    expect(label).toContain('{red-fg}●{/}');
    expect(label).toContain('not in the catalog');
  });

  it('marks blacklisted models with a yellow cross', () => {
    const label = buildModelLabel(model, { blacklistReason: '400 not-in-catalog' });
    expect(label).toContain('{yellow-fg}✕{/}');
    expect(label).toContain('blacklisted');
  });

  it('prioritizes blacklist over health', () => {
    const label = buildModelLabel(model, {
      blacklistReason: '400 not-in-catalog',
      health: { healthy: false, lastCheck: 0, consecutiveFailures: 1, error: 'down' },
    });
    expect(label).toContain('blacklisted');
    expect(label).not.toContain('down');
  });

  it('flags a slow model once its EMA meets the threshold', () => {
    const label = buildModelLabel(model, { emaMs: 50000, emaThresholdMs: 45000 });
    expect(label).toContain('{yellow-fg}●{/}');
    expect(label).toContain('slow 50000ms');
  });

  it('treats EMA below threshold as healthy', () => {
    const label = buildModelLabel(model, { emaMs: 1000, emaThresholdMs: 45000 });
    expect(label).toContain('{green-fg}●{/}');
  });
});
