import { describe, it, expect } from 'vitest';
import { selectContextTools, CORE_ESSENTIAL_TOOLS } from './context-selector.js';
import { BUILTIN_TOOLS, POWER_TOOLS } from './definitions.js';

describe('selectContextTools', () => {
  const allTools = [...BUILTIN_TOOLS, ...POWER_TOOLS];

  it('returns all tools unchanged when enabled is false', () => {
    const result = selectContextTools(allTools, { enabled: false });
    expect(result.length).toBe(allTools.length);
  });

  it('always includes all core essential tools in basic context', () => {
    const result = selectContextTools(allTools, {
      userPrompt: 'fix the typo in readme',
      activeFiles: [],
    });

    const resultNames = new Set(result.map(t => t.function.name));
    for (const coreTool of CORE_ESSENTIAL_TOOLS) {
      expect(resultNames.has(coreTool)).toBe(true);
    }
  });

  it('promotes LSP tools when editing TypeScript files', () => {
    const result = selectContextTools(allTools, {
      userPrompt: 'check this function',
      activeFiles: ['src/model.ts'],
    });

    const resultNames = new Set(result.map(t => t.function.name));
    expect(resultNames.has('lsp_diagnostics')).toBe(true);
    expect(resultNames.has('lsp_hover')).toBe(true);
  });

  it('prioritizes LSP tools to top rank when compiler errors appear in recent messages', () => {
    const result = selectContextTools(allTools, {
      userPrompt: 'fix the build',
      recentMessages: [
        {
          role: 'user',
          content: 'Error: src/indexer.ts(45,12): error TS2322: Type "string" is not assignable to type "number".',
        },
      ],
    });

    const topTools = result.slice(0, 3).map(t => t.function.name);
    expect(topTools).toContain('lsp_diagnostics');
  });

  it('promotes symbol and call graph tools when prompt asks about references or symbols', () => {
    const result = selectContextTools(allTools, {
      userPrompt: 'find all references to selectContextTools and show who calls it',
    });

    const resultNames = new Set(result.map(t => t.function.name));
    expect(resultNames.has('find_symbol')).toBe(true);
    expect(resultNames.has('get_references')).toBe(true);
    expect(resultNames.has('get_call_graph')).toBe(true);
  });

  it('promotes web search tools when URL is present in prompt', () => {
    const result = selectContextTools(allTools, {
      userPrompt: 'read docs from https://docs.anthropic.com/en/api/overview',
    });

    const resultNames = new Set(result.map(t => t.function.name));
    expect(resultNames.has('web_search')).toBe(true);
    expect(resultNames.has('fetch_url')).toBe(true);
  });

  it('boosts tools invoked in recent turns to maintain workflow continuity', () => {
    const result = selectContextTools(allTools, {
      userPrompt: 'continue with the analysis',
      recentToolCalls: ['get_impact', 'lsp_hover'],
    });

    const resultNames = new Set(result.map(t => t.function.name));
    expect(resultNames.has('get_impact')).toBe(true);
    expect(resultNames.has('lsp_hover')).toBe(true);
  });
});
