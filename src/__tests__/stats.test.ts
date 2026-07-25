import { describe, it, expect } from 'vitest';
import { handleStatsCommand } from '../commands/stats.js';

describe('handleStatsCommand', () => {
  it('returns a formatted statistics report containing expected session metrics', () => {
    const result = handleStatsCommand();
    expect(result).toContain('Session & System Statistics');
    expect(result).toContain('Uptime:');
    expect(result).toContain('Interactions:');
    expect(result).toContain('Total Tokens:');
    expect(result).toContain('Error Count:');
  });
});
