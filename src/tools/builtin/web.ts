// Web search and fetch tools

import { ToolContext, ToolResult } from '../../types.js';

const DEFAULT_UA = 'Daedalus/0.1.0';

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { 'User-Agent': DEFAULT_UA },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function search(args: { query: string; limit?: number }, _context: ToolContext): Promise<ToolResult> {
  // Use DuckDuckGo HTML scraping as a simple no-API-key search
  // In production, could use a proper search API
  const query = encodeURIComponent(args.query);
  const url = `https://html.duckduckgo.com/html/?q=${query}`;
  const limit = args.limit ?? 10;

  try {
    const res = await fetchWithTimeout(url, 15000);
    const html = await res.text();

    // Parse DDG results (simplified)
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const regex = /class="result__title".*?href="(.*?)".*?>(.*?)<\/a>.*?class="result__snippet".*?>(.*?)<\/a>/gs;
    let match;
    while ((match = regex.exec(html)) && results.length < limit) {
      results.push({
        url: match[1],
        title: match[2].replace(/<[^>]+>/g, ''),
        snippet: match[3].replace(/<[^>]+>/g, ''),
      });
    }

    if (results.length === 0) {
      return { toolCallId: '', name: 'web_search', success: true, content: 'No results found' };
    }

    const output = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
    return { toolCallId: '', name: 'web_search', success: true, content: output };
  } catch (err: any) {
    return { toolCallId: '', name: 'web_search', success: false, content: '', error: `Search failed: ${err.message}` };
  }
}

export async function fetchUrl(args: { url: string; timeout?: number }, _context: ToolContext): Promise<ToolResult> {
  const timeout = (args.timeout ?? 30) * 1000;

  try {
    const res = await fetchWithTimeout(args.url, timeout);
    const contentType = res.headers.get('content-type') ?? 'unknown';
    const text = await res.text();

    // Truncate if too long
    const maxChars = 50000;
    const truncated = text.length > maxChars ? text.slice(0, maxChars) + '\n\n... [truncated]' : text;

    return {
      toolCallId: '',
      name: 'fetch_url',
      success: res.ok,
      content: `URL: ${args.url}\nStatus: ${res.status}\nContent-Type: ${contentType}\n\n${truncated}`,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err: any) {
    return { toolCallId: '', name: 'fetch_url', success: false, content: '', error: `Fetch failed: ${err.message}` };
  }
}