import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveChromePath, browsePage } from './browser.js';
import type { ToolContext } from '../../types.js';
import fs from 'fs';

vi.mock('fs');

describe('Browser Automation Tool (browse_page)', () => {
  const mockContext = {
    sessionId: 'test-session',
    projectRoot: 'd:/Daedalus',
  } as unknown as ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveChromePath', () => {
    it('returns custom CHROME_PATH if env var exists and is valid', () => {
      const orig = process.env.CHROME_PATH;
      process.env.CHROME_PATH = '/custom/path/chrome';
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const resolved = resolveChromePath();
      expect(resolved).toBe('/custom/path/chrome');

      process.env.CHROME_PATH = orig;
    });

    it('returns null if no standard Chrome paths exist', () => {
      const orig = process.env.CHROME_PATH;
      delete process.env.CHROME_PATH;
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const resolved = resolveChromePath();
      expect(resolved).toBeNull();

      process.env.CHROME_PATH = orig;
    });
  });

  describe('browsePage execution', () => {
    it('returns error when chrome is not found', async () => {
      const orig = process.env.CHROME_PATH;
      delete process.env.CHROME_PATH;
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = await browsePage({ url: 'http://localhost:3000' }, mockContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Chrome / Chromium not found');

      process.env.CHROME_PATH = orig;
    });
  });
});
