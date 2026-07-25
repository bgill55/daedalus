import { describe, it, expect } from 'vitest';
import { maskKey } from '../utils/apiKeyMask.js';
import { formatHealthTable } from '../utils/table.js';
import type { HealthPayload } from '../types.js';

describe('health utilities', () => {
  describe('maskKey', () => {
    it('returns MISSING for null, undefined, or empty string', () => {
      expect(maskKey(null)).toBe('MISSING');
      expect(maskKey(undefined)).toBe('MISSING');
      expect(maskKey('')).toBe('MISSING');
      expect(maskKey('   ')).toBe('MISSING');
    });

    it('masks short keys without stray spaces', () => {
      expect(maskKey('12345')).toBe('SET (***)');
    });

    it('masks standard API keys correctly', () => {
      expect(maskKey('sk-1234567890abcdef')).toBe('SET (sk-…cdef)');
    });
  });

  describe('formatHealthTable', () => {
    it('formats health payload into table string', () => {
      const payload: HealthPayload = {
        routerStrategy: 'priority',
        providers: {
          openai: {
            status: 'UP',
            avgLatencyMs: 120,
            apiKey: maskKey('sk-1234567890abcdef'),
          },
          ollama: {
            status: 'UP',
            avgLatencyMs: 15,
            apiKey: maskKey(null),
          },
        },
      };

      const output = formatHealthTable(payload);
      expect(output).toContain('Openai');
      expect(output).toContain('120 ms');
      expect(output).toContain('Ollama');
      expect(output).toContain('MISSING');
      expect(output).toContain('API-Key');
    });
  });
});
