import { describe, it, expect, vi, afterEach } from 'vitest';
import { search, fetchUrl } from './web.js';
import type { ToolContext } from '../../types.js';

const mockContext = {} as ToolContext;

describe('Web tools', () => {

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('search', () => {

    it('returns error when fetch fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
      const result = await search({ query: 'test' }, mockContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Search failed');
    });

    it('returns no results message when HTML has no results', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('<html><body>no results here</body></html>'),
      } as Response);

      const result = await search({ query: 'xyzzy_unknown' }, mockContext);
      expect(result.success).toBe(true);
      expect(result.content).toBe('No results found');
    });

    it('respects limit parameter', async () => {
      const repeated = Array.from({ length: 20 }, (_, i) =>
        `<div class="result__title"><a href="http://example.com/${i}">Result ${i}</a></div><div class="result__snippet"><a>snippet ${i}</a></div>`
      ).join('');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(`<html>${repeated}</html>`),
      } as Response);

      const result = await search({ query: 'test', limit: 5 }, mockContext);
      const lines = result.content.split('\n').filter(l => l.startsWith('1.') || l.startsWith('2.'));
      expect(lines.length).toBeLessThanOrEqual(5);
    });

  });

  describe('fetchUrl', () => {

    it('returns error when fetch fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));
      const result = await fetchUrl({ url: 'http://localhost:1' }, mockContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Fetch failed');
    });

    it('returns content on successful fetch', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/plain']]) as any,
        text: () => Promise.resolve('Hello, world!'),
      } as Response);

      const result = await fetchUrl({ url: 'http://example.com' }, mockContext);
      expect(result.success).toBe(true);
      expect(result.content).toContain('Hello, world!');
      expect(result.content).toContain('200');
    });

    it('includes error for non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Map([['content-type', 'text/html']]) as any,
        text: () => Promise.resolve('Not Found'),
      } as Response);

      const result = await fetchUrl({ url: 'http://example.com/404' }, mockContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
    });

    it('truncates long responses', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/plain']]) as any,
        text: () => Promise.resolve('x'.repeat(100000)),
      } as Response);

      const result = await fetchUrl({ url: 'http://example.com' }, mockContext);
      expect(result.content.length).toBeLessThan(60000);
      expect(result.content).toContain('[truncated]');
    });

  });

});
