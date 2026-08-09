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
    const askLineMock = vi.fn()
      .mockResolvedValueOnce('review server.ts') // raw prompt input
      .mockResolvedValueOnce('y'); // confirm y

    const mockCallModel = vi.fn().mockResolvedValue('Enhanced prompt text');
    const mockCallTools = vi.fn().mockResolvedValue({ content: 'Model response', toolCalls: [] });

    const mockCtx = {
      callModelWithFallback: mockCallModel,
      callModelWithTools: mockCallTools,
      askLine: askLineMock,
      messages: [],
    } as any;

    const shouldRun = await enhanceCommand.execute('', mockCtx);
    expect(shouldRun).toBe(true);
    expect(mockCallTools).toHaveBeenCalledTimes(1);
    const dispatched = mockCallTools.mock.calls[0][0] as string;
    expect(dispatched).toContain('Enhanced prompt text');
    // The enhanced prompt must be dispatched as a TASK TO EXECUTE, not re-labeled as a
    // user prompt to enhance — otherwise the model re-enhances instead of answering.
    expect(dispatched).toMatch(/Execute the following task:/);
    expect(dispatched).not.toMatch(/User Prompt:\s*Enhanced prompt text/);
  });
});
