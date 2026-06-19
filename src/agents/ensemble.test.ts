import { describe, it, expect, vi, afterEach } from 'vitest';
import { runEnsembleWorkflow } from './ensemble.js';
import { createRouter } from '../router/index.js';
import { ToolContext } from '../types.js';
import * as child_process from 'child_process';

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof child_process>('child_process');
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

describe('Multi-Model Ensemble Drafting', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should run Coder -> Reviewer loop and stop when approved', async () => {
    const mockConfig: any = {
      agents: {
        ensemble: {
          enabled: true,
          draftModel: 'lmstudio-default',
          criticModel: 'ollama-default',
          maxLoops: 2,
        },
      },
    };

    const mockRouter = createRouter({
      chain: [
        { name: 'lmstudio-default', endpoint: 'http://localhost:1234/v1', model: 'auto', priority: 1, enabled: true },
        { name: 'ollama-default', endpoint: 'http://localhost:11434/v1', model: 'auto', priority: 2, enabled: true },
      ]
    });
    
    const createSpy = vi.spyOn(mockRouter, 'chatCompletion');
    
    // Turn 1 (Coder): Coder response
    createSpy.mockResolvedValueOnce({
      choices: [{ message: { content: 'Coder did changes', role: 'assistant' } }]
    } as any);

    // Turn 2 (Reviewer): Reviewer critiques
    createSpy.mockResolvedValueOnce({
      choices: [{ message: { content: 'Critique: missing tests', role: 'assistant' } }]
    } as any);

    // Turn 3 (Coder Loop 2): Coder updates
    createSpy.mockResolvedValueOnce({
      choices: [{ message: { content: 'Coder added tests', role: 'assistant' } }]
    } as any);

    // Turn 4 (Reviewer Loop 2): Reviewer approves
    createSpy.mockResolvedValueOnce({
      choices: [{ message: { content: 'APPROVED', role: 'assistant' } }]
    } as any);

    const execSyncMock = child_process.execSync as any;
    execSyncMock.mockReturnValueOnce('')
               .mockReturnValueOnce('some diff')
               .mockReturnValueOnce('')
               .mockReturnValueOnce('updated diff');

    const mockContext: ToolContext = {
      activeFiles: new Map(),
      sessionHistory: [],
    } as any;

    await runEnsembleWorkflow('Add unit tests for file.ts', mockContext, mockConfig, mockRouter);

    expect(createSpy).toHaveBeenCalledTimes(4);
    expect(createSpy.mock.calls[0][0].model).toBe('lmstudio-default');
    expect(createSpy.mock.calls[1][0].model).toBe('ollama-default');
    expect(createSpy.mock.calls[2][0].model).toBe('lmstudio-default');
    expect(createSpy.mock.calls[3][0].model).toBe('ollama-default');
  });

  it('should exit early if no changes are made by coder', async () => {
    const mockConfig: any = {
      agents: {
        ensemble: {
          enabled: true,
          draftModel: 'lmstudio-default',
          criticModel: 'ollama-default',
          maxLoops: 2,
        },
      },
    };

    const mockRouter = createRouter({
      chain: [
        { name: 'lmstudio-default', endpoint: 'http://localhost:1234/v1', model: 'auto', priority: 1, enabled: true },
        { name: 'ollama-default', endpoint: 'http://localhost:11434/v1', model: 'auto', priority: 2, enabled: true },
      ]
    });
    const createSpy = vi.spyOn(mockRouter, 'chatCompletion');
    
    createSpy.mockResolvedValueOnce({
      choices: [{ message: { content: 'No changes', role: 'assistant' } }]
    } as any);

    const execSyncMock = child_process.execSync as any;
    execSyncMock.mockReturnValueOnce('')
               .mockReturnValueOnce('');

    const mockContext: ToolContext = {
      activeFiles: new Map(),
      sessionHistory: [],
    } as any;

    await runEnsembleWorkflow('Do nothing', mockContext, mockConfig, mockRouter);

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0][0].model).toBe('lmstudio-default');
  });
});
