import { describe, it, expect, vi } from 'vitest';
import { enhancePrompt, enhanceCommand } from './enhance.js';
import type { CommandContext } from './types.js';

describe('enhanceCommand', () => {
  it('has name, aliases, description, and usage', () => {
    expect(enhanceCommand.name).toBe('/enhance');
    expect(enhanceCommand.aliases).toContain('prompt');
    expect(enhanceCommand.aliases).toContain('refine');
    expect(enhanceCommand.description).toBeTruthy();
  });

  it('enhancePrompt expands raw prompt using callModelWithFallback', async () => {
    const mockCallModel = vi.fn().mockResolvedValue(
      'Structured Prompt: Review PromptVault architecture, tests, and top 3 fixes.'
    );

    const mockCtx = {
      callModelWithFallback: mockCallModel,
    } as any;

    const result = await enhancePrompt('look at this project', mockCtx);
    expect(result).toContain('Structured Prompt');
    expect(mockCallModel).toHaveBeenCalledTimes(1);
  });

  it('enhanceCommand asks for prompt if empty and handles user response', async () => {
    const mockRouter = {
      chat: vi.fn().mockResolvedValue({
        content: 'Enhanced prompt text',
      }),
    } as any;

    const askLineMock = vi.fn()
      .mockResolvedValueOnce('review server.ts') // raw prompt input
      .mockResolvedValueOnce('y'); // confirm y

    const mockCallModel = vi.fn().mockResolvedValue('Enhanced prompt text');

    const mockCtx = {
      callModelWithFallback: mockCallModel,
      askLine: askLineMock,
      messages: [],
    } as any;

    const shouldRun = await enhanceCommand.execute('', mockCtx);
    expect(shouldRun).toBe(true);
    expect(mockCtx.messages.length).toBe(1);
    expect(mockCtx.messages[0].content).toBe('Enhanced prompt text');
  });
});
