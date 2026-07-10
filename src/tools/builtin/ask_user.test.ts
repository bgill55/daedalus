import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { askUser } from './ask_user.js';
import type { ToolContext } from '../../types.js';

describe('ask_user tool', () => {
  const mockContext: ToolContext = {
    projectRoot: process.cwd(),
    sessionId: 'test',
    projectHash: 'test',
    activeFiles: new Map(),
    abortSignal: new AbortController().signal,
  } as ToolContext;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails when askLine is not defined in context', async () => {
    const result = await askUser({ question: 'What is your favorite color?' }, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Interactive input (askLine) is not available');
  });

  it('asks a free-form question and returns the answer', async () => {
    const askLineMock = vi.fn().mockResolvedValue('Blue ');
    const contextWithAsk = { ...mockContext, askLine: askLineMock };

    const result = await askUser({ question: 'What is your favorite color?' }, contextWithAsk);

    expect(askLineMock).toHaveBeenCalledTimes(1);
    expect(askLineMock.mock.calls[0][0]).toContain('What is your favorite color?');
    expect(result.success).toBe(true);
    expect(result.content).toBe('Blue');
  });

  it('asks a multiple-choice question and resolves selecting a valid index option', async () => {
    const askLineMock = vi.fn().mockResolvedValue(' 2 ');
    const contextWithAsk = { ...mockContext, askLine: askLineMock };

    const result = await askUser({
      question: 'Choose an approach:',
      options: ['Approach A', 'Approach B', 'Approach C'],
    }, contextWithAsk);

    expect(askLineMock).toHaveBeenCalledTimes(1);
    expect(askLineMock.mock.calls[0][0]).toContain('Approach A');
    expect(askLineMock.mock.calls[0][0]).toContain('Approach B');
    expect(askLineMock.mock.calls[0][0]).toContain('Approach C');
    expect(result.success).toBe(true);
    expect(result.content).toBe('Approach B');
  });

  it('asks a multiple-choice question and falls back to custom response for non-numeric input', async () => {
    const askLineMock = vi.fn().mockResolvedValue('Approach D');
    const contextWithAsk = { ...mockContext, askLine: askLineMock };

    const result = await askUser({
      question: 'Choose an approach:',
      options: ['Approach A', 'Approach B', 'Approach C'],
    }, contextWithAsk);

    expect(result.success).toBe(true);
    expect(result.content).toBe('Approach D');
  });

  it('asks a multiple-choice question and falls back to custom response for out-of-range numeric input', async () => {
    const askLineMock = vi.fn().mockResolvedValue('4');
    const contextWithAsk = { ...mockContext, askLine: askLineMock };

    const result = await askUser({
      question: 'Choose an approach:',
      options: ['Approach A', 'Approach B', 'Approach C'],
    }, contextWithAsk);

    expect(result.success).toBe(true);
    expect(result.content).toBe('4');
  });
});
