import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the FTS index module so we control searchSymbols without a real DB.
vi.mock('../../indexing/fts.js', () => ({
  initIndexDb: vi.fn(() => ({ fake: true })),
  searchSymbols: vi.fn(() => []),
}));

// Mock child_process so the --issue gh call is a no-op we can assert on.
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => 'https://github.com/bgill55/daedalus/issues/999'),
}));

import { scanAiRepos } from './scan-ai-repos.js';
import { searchSymbols } from '../../indexing/fts.js';

function makeContext(overrides: Record<string, unknown> = {}) {
  const fakeDb = { fake: true };
  return {
    sessionId: 's',
    projectRoot: 'D:/some-project',
    projectHash: 'abc123',
    indexDb: fakeDb,
    agentRole: 'daedalus',
    activeFiles: new Map(),
    abortSignal: new AbortController().signal,
    ...overrides,
  } as any;
}

const SAMPLE_ITEMS = [
  { full_name: 'org/alpha', html_url: 'https://github.com/org/alpha', description: 'machine learning assistant', stargazers_count: 5000, language: 'TypeScript', topics: ['cli', 'agents'] },
  { full_name: 'org/beta', html_url: 'https://github.com/org/beta', description: 'workflow automation', stargazers_count: 3000, language: 'Python', topics: ['automation'] },
];

describe('scan_ai_repos tool', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: SAMPLE_ITEMS }),
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('scans GitHub and returns a ranked, project-analyzed report', async () => {
    const ctx = makeContext();
    const result = await scanAiRepos({ top: 2 }, ctx);
    expect(result.success).toBe(true);
    expect(result.content).toContain('org/alpha'); // top by stars first
    expect(result.content).toContain('org/beta');
    // file-specific findings (NOT the generic "Universal Code Assistant" template)
    expect(result.content).not.toContain('Universal Code Assistant');
    expect(result.content).toContain('NOT in this project'); // alpha/beta not in index
  });

  it('uses project index to mark present patterns', async () => {
    (searchSymbols as any).mockReturnValue([{ file_path: 'src/cli.ts', name: 'run', kind: 'function' }]);
    const ctx = makeContext();
    const result = await scanAiRepos({ top: 1 }, ctx);
    expect(result.success).toBe(true);
    expect(result.content).toContain('ALREADY PRESENT');
    expect(result.content).toContain('src/cli.ts');
  });

  it('does not read .env — uses process.env.GITHUB_TOKEN only', async () => {
    const ctx = makeContext();
    await scanAiRepos({ top: 1 }, ctx);
    const fetchCall = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(fetchCall).toContain('api.github.com/search/repositories');
  });

  it('creates a GitHub issue when --issue is set', async () => {
    const { execFileSync } = await import('node:child_process');
    const ctx = makeContext();
    const result = await scanAiRepos({ top: 1, issue: true, repo: 'bgill55/daedalus' }, ctx);
    expect(result.success).toBe(true);
    expect(execFileSync).toHaveBeenCalled();
    const callArgs = (execFileSync as any).mock.calls[0];
    expect(callArgs[0]).toBe('gh');
    expect(callArgs[1]).toContain('issue');
    expect(callArgs[1]).toContain('bgill55/daedalus');
  });

  it('returns failure (not throw) when GitHub API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' }));
    const ctx = makeContext();
    const result = await scanAiRepos({ top: 1 }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('GitHub search failed');
  });
});
