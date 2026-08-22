import { describe, it, expect, vi } from 'vitest';
import { enhancePrompt, enhanceCommand, ENHANCE_SYSTEM_PROMPT } from './enhance.js';

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

  it('strips invented tool-name references (e.g. "using find_symbol and get_definition to ...")', async () => {
    // Regression: the enhancer emitted "using find_symbol and get_definition to locate
    // relevant source files" — tool names that don't exist in this Daedalus build. The
    // execution agent would attempt calls that fail. Rule 8 + stripInventedToolRefs
    // remove the "using X and Y to Z" / "via X" clauses so the agent is instructed by
    // ACTION, not by a fictional tool name.
    const mockCallModel = vi.fn().mockResolvedValue(
      'Analyze PromptVault by using find_symbol and get_definition to locate relevant source files. ' +
      'Cross-reference via grep_tool and summarize the findings in a report.'
    );
    const mockCtx = { callModelWithFallback: mockCallModel } as any;

    const result = await enhancePrompt('suggest UI/UX improvements for PromptVault', mockCtx);
    expect(result).not.toMatch(/find_symbol/);
    expect(result).not.toMatch(/get_definition/);
    expect(result).not.toMatch(/grep_tool/);
    expect(result).not.toMatch(/using\s+[\w_]+/i);
    // Action-based phrasing survives.
    expect(result).toMatch(/locate relevant source files/i);
  });

  it('caps a boilerplate bullet ramble at the top 12 distinct items (Rule 9)', async () => {
    // Regression: a "areas of improvement" ask produced ~150 near-duplicate "Add Prompt
    // Template Variables ..." bullets (4.5k-token copy-paste ramble). Rule 9 + capRepetition
    // keep the first 12 bullets and append a cap note instead of letting the list explode.
    const ramble = Array.from({ length: 60 }, (_, i) =>
      `- Add Prompt Template Variables ${i + 1}: description for variation ${i + 1}.`
    ).join('\n');
    const mockCallModel = vi.fn().mockResolvedValue(ramble);
    const mockCtx = { callModelWithFallback: mockCallModel } as any;

    const result = await enhancePrompt('identify areas for improvement in PromptVault', mockCtx);
    const bulletCount = (result.match(/^\s*(?:[-*•]|\d+\.)\s+/gm) || []).length;
    expect(bulletCount).toBeLessThanOrEqual(12);
    expect(result).toMatch(/list capped at the 12 highest-impact, distinct items/);
    // The cap note must be present and the ramble truncated.
    expect(result).not.toMatch(/Add Prompt Template Variables 60:/);
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

  it('ENHANCE_SYSTEM_PROMPT forbids pipe-delimited table output (Rules 3-4)', () => {
    // Regression: the enhancer produced ASCII pipe tables ("| Col | Col |") that are
    // noise for the CLI/agent to parse. The prompt must mandate clean Markdown
    // (## headings + - bullets) and ban pipe tables as an output format.
    expect(ENHANCE_SYSTEM_PROMPT).toContain('Do NOT use pipe-delimited tables');
    expect(ENHANCE_SYSTEM_PROMPT).toContain('Pipe tables are forbidden as an output format');
    expect(ENHANCE_SYSTEM_PROMPT).toContain('use `##` headings and `-` bullets');
  });

  it('strips any surviving pipe-table rows from the enhanced prompt (backstop)', async () => {
    // Even with the prompt ban, a model can still emit a pipe table. The backstop
    // must convert it to clean bullets/headings so it can't poison the execution turn.
    const pipeTable = [
      '## Proposed Enhancements',
      '| Enhancement | Impact | Effort |',
      '|-------------|--------|--------|',
      '| Add caching | High   | Low    |',
      '| Improve CLI output | Medium | Med |',
      '',
      'Next, inspect the codebase and populate each item.',
    ].join('\n');
    const mockCallModel = vi.fn().mockResolvedValue(pipeTable);
    const mockCtx = { callModelWithFallback: mockCallModel } as any;

    const result = await enhancePrompt('what would make this project more outstanding', mockCtx);
    // No pipe-table syntax survives.
    expect(result).not.toMatch(/^\s*\|.*\|\s*$/m);
    expect(result).not.toMatch(/\|[-:\s]+\|/);
    // The data rows become bullets/headings instead.
    expect(result).toContain('- Add caching: High: Low');
    expect(result).toContain('## Proposed Enhancements');
  });

  it('includes verified project context when ctx exposes active files', async () => {
    const mockCallModel = vi.fn().mockResolvedValue('Enhanced prompt grounded in the project.');
    // Point root at D:/Daedalus so buildEnhanceContext finds the real package.json
    // (TypeScript stack) and AGENTS.md — a genuine grounding signal, not a model claim.
    const mockCtx = {
      callModelWithFallback: mockCallModel,
      activeFiles: new Map<string, string>([['D:/Daedalus/src/index.ts', 'index.ts']]),
    } as any;

    // Capture the prompt passed to the model.
    let captured = '';
    const spy = vi.fn().mockImplementation(async (p: string) => { captured = p; return 'Enhanced prompt grounded in the project.'; });
    mockCtx.callModelWithFallback = spy;

    const result = await enhancePrompt('what would make this project more outstanding for an end user', mockCtx);
    expect(result).toBeTruthy();
    // Grounding block must be injected into the enhancement call.
    expect(captured).toContain('VERIFIED PROJECT CONTEXT');
    expect(captured).toContain('DETECTED STACK');
    expect(captured).toContain('AGENTS.md');
  });
});
