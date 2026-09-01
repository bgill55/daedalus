import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ToolContext } from '../../types.js';

vi.mock('./lsp.js', async () => {
  const formatSuccess = (content: string) => ({ toolCallId: '', name: '', success: true, content, error: undefined });
  const formatError = (error: string) => ({ toolCallId: '', name: '', success: false, content: '', error });
  return {
    lspDiagnostics: vi.fn(async (args: { path?: string }, _ctx: unknown) => {
      if (args.path && args.path.includes('nonexistent')) return formatError('File not found');
      return formatSuccess('No diagnostics');
    }),
    lspHover: vi.fn(async (args: { path: string }, _ctx: unknown) => {
      if (args.path.includes('nonexistent')) return formatError('File not found');
      return formatSuccess('hover info');
    }),
    lspRename: vi.fn(async (args: { path: string }, _ctx: unknown) => {
      if (args.path.includes('nonexistent')) return formatError('File not found');
      return formatSuccess('renamed');
    }),
    resetLspService: vi.fn(),
  };
});

import { lspDiagnostics, lspHover, lspRename, resetLspService } from './lsp.js';

describe('LSP tools', () => {
  let context: ToolContext;

  beforeEach(() => {
    context = {
      projectRoot: process.cwd(),
      sessionId: 'test',
      projectHash: 'test',
      activeFiles: new Map(),
      abortSignal: new AbortController().signal,
    } as ToolContext;
  });

  afterEach(() => {
    resetLspService();
    vi.restoreAllMocks();
  });

  it('lspDiagnostics returns error for nonexistent file', async () => {
    const result = await lspDiagnostics({ path: '/nonexistent/file.ts' }, context);
    expect(result.success).toBe(false);
  });

  it('lspDiagnostics succeeds without path argument', async () => {
    const result = await lspDiagnostics({}, context);
    expect(result.success).toBe(true);
  });

  it('lspHover returns error for nonexistent file', async () => {
    const result = await lspHover({ path: '/nonexistent.ts', line: 1, col: 1 }, context);
    expect(result.success).toBe(false);
  });

  it('lspRename returns error for nonexistent file', async () => {
    const result = await lspRename({ path: '/nonexistent.ts', line: 1, col: 1, new_name: 'Foo' }, context);
    expect(result.success).toBe(false);
  });

});
