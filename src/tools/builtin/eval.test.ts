import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { evalCode } from './eval.js';
import type { ToolContext } from '../../types.js';

describe('eval_code tool', () => {

  const mockContext: ToolContext = {
    projectRoot: process.cwd(),
    sessionId: 'test',
    projectHash: 'test',
    activeFiles: new Map(),
    abortSignal: new AbortController().signal,
  } as ToolContext;

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true, writable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cancels when not approved (non-TTY)', async () => {
    const result = await evalCode({ code: 'console.log("hi")' }, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('cancelled');
  });

});
