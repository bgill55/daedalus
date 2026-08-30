import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scanAiReposCommands } from './scan-ai-repos.js';
import { scanAiRepos } from '../tools/builtin/scan-ai-repos.js';

vi.mock('../tools/builtin/scan-ai-repos.js', () => ({
  scanAiRepos: vi.fn(),
}));

const logSpy = vi.spyOn(console, 'log');

function makeCtx(over: Record<string, unknown> = {}) {
  return {
    config: {},
    configDir: 'D:/x',
    projectRoot: 'D:/Daedalus',
    toolContext: {
      sessionId: 's',
      projectRoot: 'D:/Daedalus',
      projectHash: 'h',
      agentRole: 'daedalus',
      activeFiles: new Map(),
      abortSignal: new AbortController().signal,
      ...over,
    },
  } as any;
}

describe('scan-ai-repos command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logSpy.mockImplementation(() => {});
    logSpy.mockClear();
  });
  afterEach(() => {
    logSpy.mockReset();
  });

  it('parses --top, --query, --issue, --repo and delegates to the tool', async () => {
    (scanAiRepos as any).mockResolvedValue({ success: true, content: 'REPORT' });
    const cmd = scanAiReposCommands[0];
    await cmd.execute('--top 5 --query "topic:ai" --issue --repo bgill55/daedalus', makeCtx());
    expect(scanAiRepos).toHaveBeenCalledWith(
      { top: 5, query: 'topic:ai', issue: true, repo: 'bgill55/daedalus' },
      expect.objectContaining({ projectRoot: 'D:/Daedalus' })
    );
    expect(logSpy).toHaveBeenCalledWith('REPORT');
  });

  it('prints red error text when the tool fails', async () => {
    (scanAiRepos as any).mockResolvedValue({ success: false, content: '', error: 'boom' });
    const cmd = scanAiReposCommands[0];
    await cmd.execute('', makeCtx());
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('boom');
  });
});
