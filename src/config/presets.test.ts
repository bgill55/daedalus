import { describe, it, expect } from 'vitest';
import { PRESETS, getPreset, applyPreset } from './presets.js';
import { DEFAULT_CONFIG } from './index.js';

describe('presets', () => {
  it('defines valid presets', () => {
    expect(PRESETS['local-free']).toBeDefined();
    expect(PRESETS['cloud-power']).toBeDefined();
    expect(PRESETS['hybrid']).toBeDefined();
    expect(PRESETS['privacy-strict']).toBeDefined();
  });

  it('retrieves preset by name case-insensitively', () => {
    expect(getPreset('HYBRID')?.id).toBe('hybrid');
    expect(getPreset('local-free')?.id).toBe('local-free');
    expect(getPreset('nonexistent')).toBeUndefined();
  });

  it('applies preset to config successfully', () => {
    const updated = applyPreset(DEFAULT_CONFIG, 'cloud-power');
    expect(updated.router.chain.length).toBeGreaterThan(0);
    expect(updated.router.chain[0].name).toBe('openai-gpt4');
  });

  it('throws error for invalid preset name', () => {
    expect(() => applyPreset(DEFAULT_CONFIG, 'invalid-preset')).toThrow(/Unknown preset/);
  });
});
