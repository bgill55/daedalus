import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import { getMemoryStats, getDiskStats, formatBytes } from './sys-stats.js';

describe('sys-stats utility', () => {
  it('returns valid memory statistics', async () => {
    const stats = await getMemoryStats();
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.free).toBeGreaterThanOrEqual(0);
    expect(stats.used).toBeGreaterThanOrEqual(0);
    expect(stats.usagePercent).toBeGreaterThanOrEqual(0);
    expect(stats.usagePercent).toBeLessThanOrEqual(100);
  });

  it('returns valid disk statistics via fs.statfsSync', async () => {
    const stats = await getDiskStats(process.cwd());
    expect(stats.path).toBe(process.cwd());
    expect(stats.total).toBeGreaterThanOrEqual(0);
    expect(stats.free).toBeGreaterThanOrEqual(0);
  });

  it('handles disk stats fallback gracefully when statfs throws', async () => {
    const spy = vi.spyOn(fs, 'statfsSync').mockImplementation(() => {
      throw new Error('Permission denied');
    });
    const stats = await getDiskStats('/invalid/path');
    expect(stats.total).toBe(0);
    expect(stats.free).toBe(0);
    spy.mockRestore();
  });

  describe('formatBytes', () => {
    it('formats 0 and negative bytes safely', () => {
      expect(formatBytes(0)).toBe('0 Bytes');
      expect(formatBytes(-100)).toBe('0 Bytes');
      expect(formatBytes(NaN)).toBe('0 Bytes');
      expect(formatBytes(Infinity)).toBe('0 Bytes');
    });

    it('formats bytes, KB, MB, GB, TB accurately', () => {
      expect(formatBytes(500)).toBe('500 Bytes');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1048576)).toBe('1 MB');
      expect(formatBytes(1073741824)).toBe('1 GB');
    });
  });
});
