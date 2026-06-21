import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { executeCommand, commandsList } from './commands.js';
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

describe('Session Command', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = {
      config: {},
      configDir: '',
      cliTempDir: '',
      router: {} as any,
      sessionManager: {
        sessionId: 'session-123',
        sessionTitle: 'Test Session',
        getSessionsForProject: vi.fn().mockReturnValue([
          { id: 'session-123', title: 'Test Session', updated_at: 1000 },
          { id: 'session-456', title: 'Other Session', updated_at: 2000 }
        ]),
        startSession: vi.fn().mockReturnValue({ sessionId: 'session-456', turns: [], activeFiles: new Map(), todos: [] }),
        saveSessionState: vi.fn(),
        deleteSession: vi.fn(),
      } as any,
      userProfile: {} as any,
      projectHash: '',
      messages: [],
      activeFiles: new Map(),
      toolContext: { sessionId: 'session-123' } as any,
      getSystemPromptWithMemory: () => '',
      callModelWithTools: async () => ({ content: '', toolCalls: [] }),
      callModelWithFallback: async () => '',
      rl: {} as any,
      initializeSessionState: vi.fn(),
      buildFileContext: () => '',
      askLine: async () => '',
      buildIndexContext: async () => '',
      getIndexDbPath: () => '',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists sessions', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handled = await executeCommand('/session list', mockContext);
    expect(handled).toBe(true);
    expect(mockContext.sessionManager.getSessionsForProject).toHaveBeenCalled();
    const call = logSpy.mock.calls.find(c => c[0] && c[0].includes('Past Sessions'));
    expect(call).toBeDefined();
  });

  it('loads a session', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handled = await executeCommand('/session load session-456', mockContext);
    expect(handled).toBe(true);
    expect(mockContext.sessionManager.saveSessionState).toHaveBeenCalled();
    expect(mockContext.sessionManager.startSession).toHaveBeenCalledWith('session-456', 'Other Session');
    expect(mockContext.initializeSessionState).toHaveBeenCalled();
    const successCall = logSpy.mock.calls.find(c => c[0] && c[0].includes('Loaded session'));
    expect(successCall).toBeDefined();
  });

  it('starts a new session', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handled = await executeCommand('/session new My New Session', mockContext);
    expect(handled).toBe(true);
    expect(mockContext.sessionManager.saveSessionState).toHaveBeenCalled();
    expect(mockContext.sessionManager.startSession).toHaveBeenCalledWith(undefined, 'My New Session');
    expect(mockContext.initializeSessionState).toHaveBeenCalled();
    const successCall = logSpy.mock.calls.find(c => c[0] && c[0].includes('Started new session'));
    expect(successCall).toBeDefined();
  });

  it('deletes a session', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handled = await executeCommand('/session delete session-456', mockContext);
    expect(handled).toBe(true);
    expect(mockContext.sessionManager.deleteSession).toHaveBeenCalledWith('session-456');
    const successCall = logSpy.mock.calls.find(c => c[0] && c[0].includes('Deleted session'));
    expect(successCall).toBeDefined();
  });
});

describe('Changelog Command', () => {
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

  it('prints warning if CHANGELOG.md is not found', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const handled = await executeCommand('/changelog', mockContext);
    expect(handled).toBe(true);
    expect(existsSpy).toHaveBeenCalled();
    const warnCall = logSpy.mock.calls.find(c => c[0] && c[0].includes('CHANGELOG.md not found'));
    expect(warnCall).toBeDefined();
  });

  it('prints the latest changes if CHANGELOG.md exists', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(
      '# 1.11.0 (2026-06-21)\n\n### Features\n\n* cool new feature\n\n## 1.10.1 (2026-06-20)\n\n### Bug Fixes\n\n* small bug fix\n\n# 1.10.0 (2026-06-20)\n\n### Features\n\n* another feature\n\n## 1.9.7 (2026-06-20)\n\n### Bug Fixes\n\n* old bug fix\n'
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const handled = await executeCommand('/changelog', mockContext);
    expect(handled).toBe(true);
    expect(existsSpy).toHaveBeenCalled();
    expect(readSpy).toHaveBeenCalled();

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('1.11.0');
    expect(output).toContain('1.10.1');
    expect(output).toContain('1.10.0');
    expect(output).not.toContain('1.9.7');
  });
});

describe('Orchestrate Command Aliases', () => {
  it('has correct aliases defined for /orchestrate', () => {
    const cmd = commandsList.find(c => c.name === '/orchestrate');
    expect(cmd).toBeDefined();
    expect(cmd?.aliases).toContain('/orc');
    expect(cmd?.aliases).toContain('/run');
    expect(cmd?.aliases).toContain('/o');
  });
});


