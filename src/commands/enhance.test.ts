import { describe, it, expect, vi } from 'vitest';
import { enhancePrompt, enhanceCommand } from './enhance.js';

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

  it('enhancePrompt does not pollute the shared messages history', async () => {
    const mockCallModel = vi.fn().mockResolvedValue('Structured audit prompt');
    const messages: any[] = [{ role: 'system', content: 'sys' }];
    const mockCtx = {
      callModelWithFallback: mockCallModel,
      messages,
    } as any;

    const result = await enhancePrompt('look at this project', mockCtx);
    expect(result).toBe('Structured audit prompt');
    // The enhance step must snapshot+restore history so the intermediate enhanced
    // prompt (a user+assistant pair) never leaks into the real conversation.
    expect(messages).toEqual([{ role: 'system', content: 'sys' }]);
    expect(mockCallModel).toHaveBeenCalledTimes(1);
  });

  it('preserves proposal intent: does not expand "ideas" ask into an implement mandate', async () => {
    // Regression: /prompt enhancer turned "come up with 3-5 ideas" into "implement these
    // in manageable sprints and deliver a comprehensive report" — which the execution turn
    // then obeyed as a build order, spiraling into a config-thrash death loop.
    const mockCallModel = vi.fn().mockResolvedValue(
      'Act as Daedalus and IMPLEMENT the following UI/UX enhancements in manageable sprints. ' +
      'Deliver a comprehensive Markdown report with sprint breakdowns and specific file modifications. ' +
      'Populate all sections with actual implementation plans. Proceed with implementing Sprint 1.1.'
    );
    const mockCtx = { callModelWithFallback: mockCallModel } as any;

    const result = await enhancePrompt('come up with 3-5 ideas to make this project outstanding', mockCtx);
    // The implement mandate must be stripped; the output stays a proposal/analysis ask.
    expect(result).not.toMatch(/implement the following/i);
    expect(result).not.toMatch(/manageable sprints?/i);
    expect(result).not.toMatch(/specific file modifications/i);
    expect(result).not.toMatch(/proceed with implementing/i);
    expect(result).not.toMatch(/deliver a comprehensive (markdown )?report/i);
  });

  it('does NOT strip implement-scope language when the raw request is a real build task', async () => {
    // A genuine implementation ask should keep its execution scope — the guard only fires
    // for proposal/ideation raw requests.
    const mockCallModel = vi.fn().mockResolvedValue(
      'Implement the following: add a /api/health route and run npm run build to verify.'
    );
    const mockCtx = { callModelWithFallback: mockCallModel } as any;

    const result = await enhancePrompt('add a health check route and verify the build', mockCtx);
    expect(result).toMatch(/implement the following/i);
  });

  it('enhanceCommand asks for prompt if empty and handles user response', async () => {
    const askLineMock = vi.fn()
      .mockResolvedValueOnce('review server.ts') // raw prompt input
      .mockResolvedValueOnce('y'); // confirm y

    const mockCallModel = vi.fn().mockResolvedValue('Enhanced prompt text');
    const mockCallTools = vi.fn().mockResolvedValue({ content: 'Model response', toolCalls: [] });
    const sysPromptSpy = vi.fn().mockReturnValue('system prompt');

    const mockCtx = {
      callModelWithFallback: mockCallModel,
      callModelWithTools: mockCallTools,
      getSystemPromptWithMemory: sysPromptSpy,
      askLine: askLineMock,
      // The REPL always seeds messages[0] with the system prompt before the
      // command runs; the enhance execution-turn guard relies on that.
      messages: [{ role: 'system', content: 'existing system prompt' }],
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
    // REGRESSION GUARD: the execution-turn system prompt must be rebuilt from the
    // USER'S ORIGINAL request, not the enhanced text. Using the enhanced text as the
    // skill-match key let an audit prompt's "Pre-Flight Audit" phrase spuriously match
    // the grade-and-fix-daedalus skill and hijack the turn (see a4c26bc regression).
    expect(sysPromptSpy).toHaveBeenCalledTimes(1);
    expect(sysPromptSpy).toHaveBeenCalledWith('review server.ts');
  });
});
