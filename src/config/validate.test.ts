import { describe, it, expect } from 'vitest';
import { validateConfig, ConfigValidationError } from './validate.js';
import { DEFAULT_CONFIG } from './index.js';

describe('validateConfig', () => {
  it('accepts a valid default config', () => {
    const result = validateConfig(DEFAULT_CONFIG);
    expect(result).toBeDefined();
    expect(result.version).toBe(1);
  });

  it('rejects null config', () => {
    expect(() => validateConfig(null)).toThrow(ConfigValidationError);
    expect(() => validateConfig(null)).toThrow('Config must be a non-null object');
  });

  it('rejects non-object config', () => {
    expect(() => validateConfig('string')).toThrow(ConfigValidationError);
    expect(() => validateConfig([])).toThrow(ConfigValidationError);
    expect(() => validateConfig(123)).toThrow(ConfigValidationError);
  });

  it('rejects invalid router strategy', () => {
    expect(() => validateConfig({
      router: { strategy: 'invalid', chain: [] },
    })).toThrow(ConfigValidationError);
  });

  it('rejects invalid endpoint format', () => {
    expect(() => validateConfig({
      router: {
        strategy: 'priority',
        chain: [{ name: 'test', endpoint: 'not-a-url', model: 'auto', priority: 1, enabled: true }],
      },
    })).toThrow(ConfigValidationError);
  });

  it('rejects negative priority', () => {
    expect(() => validateConfig({
      router: {
        strategy: 'priority',
        chain: [{ name: 'test', endpoint: 'http://localhost:1234/v1', model: 'auto', priority: -1, enabled: true }],
      },
    })).toThrow(ConfigValidationError);
  });

  it('accepts minimal valid config', () => {
    const result = validateConfig({
      router: { strategy: 'priority', chain: [] },
    });
    expect(result.version).toBe(1);
    expect(result.router.healthCheckInterval).toBe(30000);
    expect(result.indexing.enabled).toBe(true);
  });
});
