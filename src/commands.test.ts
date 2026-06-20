import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeCommand } from './commands.js';
import type { CommandContext } from './commands.js';

vi.mock('./config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config/index.js')>();
  return {
    ...actual,
    saveConfig: vi.fn(),
  };
});

describe('Config Command', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = {
      config: {
        version: 1,
        router: {
          strategy: 'priority',
          chain: [
            { name: 'lmstudio-default', endpoint: 'http://localhost:1234/v1', model: 'auto', priority: 1, enabled: true },
          ],
          healthCheckInterval: 30000,
          requestTimeout: 120000,
          defaultRateLimit: { rpm: 60, tpm: 100000 },
        },
        indexing: {
          enabled: true,
          watch: true,
          exclude: ['node_modules'],
        },
      },
      configDir: process.cwd(),
      cliTempDir: process.cwd(),
      router: {} as any,
      sessionManager: {} as any,
      userProfile: {} as any,
      projectHash: 'testhash',
      messages: [],
      activeFiles: new Map(),
      toolContext: {} as any,
      getSystemPromptWithMemory: () => '',
      callModelWithTools: async () => ({ content: '', toolCalls: [] }),
      callModelWithFallback: async () => '',
      rl: {} as any,
      initializeSessionState: () => {},
      buildFileContext: () => '',
      askLine: async () => '',
      buildIndexContext: async () => '',
      getIndexDbPath: () => '',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the config when run without arguments', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handled = await executeCommand('/config', mockContext);
    expect(handled).toBe(true);
    expect(logSpy).toHaveBeenCalled();
    const call = logSpy.mock.calls.find(c => c[0] && c[0].includes('Current Configuration'));
    expect(call).toBeDefined();
  });

  it('updates a nested global config value successfully', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handled = await executeCommand('/config set router.strategy = round-robin', mockContext);
    expect(handled).toBe(true);
    expect(mockContext.config.router.strategy).toBe('round-robin');
    expect(logSpy).toHaveBeenCalled();
    const successCall = logSpy.mock.calls.find(c => c[0] && c[0].includes('Set global config'));
    expect(successCall).toBeDefined();
  });

  it('updates a model specific property successfully', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handled = await executeCommand('/config set model.lmstudio-default.tier = intelligence', mockContext);
    expect(handled).toBe(true);
    const model = mockContext.config.router.chain.find((m: any) => m.name === 'lmstudio-default');
    expect(model?.tier).toBe('intelligence');
    expect(logSpy).toHaveBeenCalled();
    const successCall = logSpy.mock.calls.find(c => c[0] && c[0].includes('Set global config'));
    expect(successCall).toBeDefined();
  });

  it('handles and warns on invalid values failing schema validation', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handled = await executeCommand('/config set router.strategy = invalid_strategy', mockContext);
    expect(handled).toBe(true);
    expect(logSpy).toHaveBeenCalled();
    const warnCall = logSpy.mock.calls.find(c => c[0] && c[0].includes('Invalid configuration value'));
    expect(warnCall).toBeDefined();
  });

  it('warns when setting model property on non-existent model', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handled = await executeCommand('/config set model.nonexistent.tier = intelligence', mockContext);
    expect(handled).toBe(true);
    expect(logSpy).toHaveBeenCalled();
    const warnCall = logSpy.mock.calls.find(c => c[0] && c[0].includes('not found in router chain'));
    expect(warnCall).toBeDefined();
  });
});

describe('Help Command', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = {
      config: {},
      configDir: '',
      cliTempDir: '',
      router: {} as any,
      sessionManager: {} as any,
      userProfile: {} as any,
      projectHash: '',
      messages: [],
      activeFiles: new Map(),
      toolContext: {} as any,
      getSystemPromptWithMemory: () => '',
      callModelWithTools: async () => ({ content: '', toolCalls: [] }),
      callModelWithFallback: async () => '',
      rl: {} as any,
      initializeSessionState: () => {},
      buildFileContext: () => '',
      askLine: async () => '',
      buildIndexContext: async () => '',
      getIndexDbPath: () => '',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs help command via /help, ?, and help', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const h1 = await executeCommand('/help', mockContext);
    const h2 = await executeCommand('?', mockContext);
    const h3 = await executeCommand('help', mockContext);

    expect(h1).toBe(true);
    expect(h2).toBe(true);
    expect(h3).toBe(true);

    expect(logSpy).toHaveBeenCalled();
    const calls = logSpy.mock.calls.filter(c => c[0] && c[0].includes('Available Commands'));
    expect(calls.length).toBe(3);
  });
});
