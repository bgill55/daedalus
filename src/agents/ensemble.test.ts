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

  it('runs multiple candidates and selects the highest scoring candidate', async () => {
    const mockConfig: any = {
      agents: {
        ensemble: {
          enabled: true,
          draftModel: 'lmstudio-default',
          criticModel: 'ollama-default',
          maxLoops: 1,
          candidatesCount: 2,
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
      choices: [{ message: { content: 'Candidate 1 draft', role: 'assistant' } }]
    } as any);

    createSpy.mockResolvedValueOnce({
      choices: [{ message: { content: 'Candidate 2 draft', role: 'assistant' } }]
    } as any);

    createSpy.mockResolvedValueOnce({
      choices: [{ message: { content: 'Review for Candidate 1\nSCORE: 6', role: 'assistant' } }]
    } as any);

    createSpy.mockResolvedValueOnce({
      choices: [{ message: { content: 'Review for Candidate 2\nSCORE: 9\nAPPROVED', role: 'assistant' } }]
    } as any);

    const execSyncMock = child_process.execSync as any;
    let appliedDiff = '';

    execSyncMock.mockImplementation((cmd: string, options?: any) => {
      if (cmd.includes('git diff')) {
        return 'candidate diff';
      }
      if (cmd.includes('git apply')) {
        if (options && options.input) {
          appliedDiff = options.input;
        }
        return '';
      }
      return '';
    });

    const mockContext: ToolContext = {
      activeFiles: new Map(),
      sessionHistory: [],
    } as any;

    await runEnsembleWorkflow('Add unit tests for file.ts', mockContext, mockConfig, mockRouter);

    expect(createSpy).toHaveBeenCalledTimes(4);
    expect(appliedDiff).toBe('candidate diff');
  });

  it('exits early if no candidates make changes', async () => {
    const mockConfig: any = {
      agents: {
        ensemble: {
          enabled: true,
          draftModel: 'lmstudio-default',
          criticModel: 'ollama-default',
          maxLoops: 1,
          candidatesCount: 2,
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

    createSpy.mockResolvedValue({
      choices: [{ message: { content: 'No changes draft', role: 'assistant' } }]
    } as any);

    const execSyncMock = child_process.execSync as any;
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes('git diff')) {
        return '';
      }
      return '';
    });

    const mockContext: ToolContext = {
      activeFiles: new Map(),
      sessionHistory: [],
    } as any;

    await runEnsembleWorkflow('Do nothing', mockContext, mockConfig, mockRouter);

    expect(createSpy).toHaveBeenCalledTimes(2);
  });
});
