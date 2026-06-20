import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lspDiagnostics, lspHover, lspRename } from './lsp.js';
import type { ToolContext } from '../../types.js';

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
