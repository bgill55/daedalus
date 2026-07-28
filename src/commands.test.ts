import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { executeCommand, commandsList } from './commands.js';
import type { CommandContext } from './commands.js';
import type { DaedalusConfig } from './config/index.js';

vi.mock('./config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config/index.js')>();
  return {
    ...actual,
    saveConfig: vi.fn(),
  };
});

let mockOrchestratorRun: ReturnType<typeof vi.fn>;

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
          languages: ['typescript'],
          exclude: ['node_modules'],
        },
      } as DaedalusConfig,
      configDir: process.cwd(),
      cliTempDir: process.cwd(),
      router: { updateConfig: vi.fn() } as any,
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
      config: {} as DaedalusConfig,
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
    const calls = logSpy.mock.calls.filter(c => c[0] && c[0].includes('Daedalus Commands'));
    expect(calls.length).toBe(3);
  });
});

describe('Session Command', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = {
      config: {} as DaedalusConfig,
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

  it('exports a session to markdown', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    
    mockContext.messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi', tool_calls: [] }
    ];

    const handled = await executeCommand('/session export test-export.md', mockContext);
    expect(handled).toBe(true);
    expect(writeSpy).toHaveBeenCalled();
    const successCall = logSpy.mock.calls.find(c => c[0] && c[0].includes('Session transcript exported to'));
    expect(successCall).toBeDefined();
  });
});

describe('Changelog Command', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = {
      config: {} as DaedalusConfig,
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

describe('TUI Command', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = {
      config: {} as DaedalusConfig,
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
      rl: {} as any, // CLI mode has rl defined
      initializeSessionState: () => {},
      buildFileContext: () => '',
      askLine: async () => '',
      buildIndexContext: async () => '',
      getIndexDbPath: () => '',
    };
  });

  it('throws SWITCH_MODE_TUI when run in CLI mode', async () => {
    await expect(executeCommand('/tui', mockContext)).rejects.toThrow('SWITCH_MODE_TUI');
  });

  it('throws SWITCH_MODE_CLI when run in TUI mode', async () => {
    mockContext.rl = null as any; // TUI mode has rl falsy
    await expect(executeCommand('/tui', mockContext)).rejects.toThrow('SWITCH_MODE_CLI');
  });
});

describe('/undo command', () => {
  let mockContext: CommandContext;
  const testFile1 = 'test_undo_1.txt';
  const testFile2 = 'test_undo_2.txt';

  beforeEach(() => {
    mockContext = {
      config: {} as DaedalusConfig,
      configDir: '',
      cliTempDir: '',
      router: {} as any,
      sessionManager: {} as any,
      userProfile: {} as any,
      projectHash: 'testhash',
      messages: [],
      activeFiles: new Map(),
      toolContext: { patchHistory: [] } as any,
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
    if (fs.existsSync(testFile1)) fs.unlinkSync(testFile1);
    if (fs.existsSync(testFile2)) fs.unlinkSync(testFile2);
    vi.restoreAllMocks();
  });

  it('warns when patchHistory is empty', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await executeCommand('/undo', mockContext);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No patches to undo'));
  });

  it('lists patch history when argument is list', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockContext.toolContext.patchHistory = [
      { filePath: testFile1, oldContent: 'a', newContent: 'b', timestamp: Date.now(), description: 'patch 1' },
    ];
    await executeCommand('/undo list', mockContext);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Applied Patch History'));
  });

  it('reverts modified file patch', async () => {
    fs.writeFileSync(testFile1, 'modified text', 'utf8');
    mockContext.toolContext.patchHistory = [
      { filePath: testFile1, oldContent: 'original text', newContent: 'modified text', timestamp: Date.now(), description: 'edit testFile1' },
    ];
    await executeCommand('/undo', mockContext);
    expect(fs.readFileSync(testFile1, 'utf8')).toBe('original text');
    expect(mockContext.toolContext.patchHistory).toHaveLength(0);
  });

  it('deletes file created without oldContent', async () => {
    fs.writeFileSync(testFile2, 'new file text', 'utf8');
    mockContext.toolContext.patchHistory = [
      { filePath: testFile2, oldContent: '', newContent: 'new file text', timestamp: Date.now(), description: 'create testFile2' },
    ];
    await executeCommand('/undo', mockContext);
    expect(fs.existsSync(testFile2)).toBe(false);
    expect(mockContext.toolContext.patchHistory).toHaveLength(0);
  });

  it('batch undos multiple patches', async () => {
    fs.writeFileSync(testFile1, 'v2', 'utf8');
    fs.writeFileSync(testFile2, 'new', 'utf8');
    mockContext.toolContext.patchHistory = [
      { filePath: testFile1, oldContent: 'v1', newContent: 'v2', timestamp: Date.now(), description: 'p1' },
      { filePath: testFile2, oldContent: '', newContent: 'new', timestamp: Date.now(), description: 'p2' },
    ];
    await executeCommand('/undo 2', mockContext);
    expect(fs.readFileSync(testFile1, 'utf8')).toBe('v1');
    expect(fs.existsSync(testFile2)).toBe(false);
    expect(mockContext.toolContext.patchHistory).toHaveLength(0);
  });
});

describe('/summarize command', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = {
      config: { router: { chain: [] } } as unknown as DaedalusConfig,
      configDir: process.cwd(),
      cliTempDir: process.cwd(),
      router: {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: 'Summarized technical context.' } }],
            }),
          },
        },
      } as any,
      sessionManager: {
        sessionId: 'test-session',
        saveSessionState: vi.fn(),
      } as any,
      userProfile: {} as any,
      projectHash: 'testhash',
      messages: [{ role: 'system', content: 'system prompt' }],
      activeFiles: new Map(),
      toolContext: { sessionId: 'test-session' } as any,
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

  it('warns when conversation is too short to summarize', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await executeCommand('/summarize', mockContext);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('already concise'));
  });

  it('summarizes older messages when conversation is long', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const longText = 'Detailed technical discussion about architecture, database schema, API routing, and code optimization. '.repeat(10);
    for (let i = 0; i < 6; i++) {
      mockContext.messages.push({ role: 'user', content: `User message ${i}: ${longText}` });
      mockContext.messages.push({ role: 'assistant', content: `Assistant reply ${i}: ${longText}` });
    }

    await executeCommand('/summarize 1', mockContext);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Successfully summarized'));
    expect(mockContext.sessionManager.saveSessionState).toHaveBeenCalled();
  });
});

describe('/autopilot command', () => {
  let mockContext: CommandContext;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-test-'));
    execSync('git init --initial-branch=main', { cwd: tmpDir });
    execSync('git config user.email test@test.com', { cwd: tmpDir });
    execSync('git config user.name Test', { cwd: tmpDir });
    execSync('git remote add origin https://github.com/test/test-repo.git', { cwd: tmpDir });
    fs.mkdirSync(path.join(tmpDir, 'packages'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'packages', 'initial.txt'), 'initial content');
    execSync('git add . && git commit -m "initial"', { cwd: tmpDir });

    mockOrchestratorRun = vi.fn();

    vi.doMock('./agents/orchestrator.js', () => ({
      Orchestrator: class {
        run = ((goal: string) => {
          const root = mockContext?.toolContext?.projectRoot;
          if (root) {
            fs.writeFileSync(path.join(root, 'autopilot-output.txt'), goal, 'utf8');
          }
          const result = mockOrchestratorRun(goal);
          return result instanceof Promise ? result : Promise.resolve(result);
        }) as typeof mockOrchestratorRun;
      },
    }));

    mockContext = {
      config: { router: { chain: [] } } as unknown as DaedalusConfig,
      configDir: tmpDir,
      cliTempDir: tmpDir,
      router: {
        chat: { completions: { create: vi.fn() } },
        updateConfig: vi.fn(),
      } as any,
      sessionManager: {
        projectRoot: tmpDir,
        sessionId: 'test',
        saveState: vi.fn(),
        getState: vi.fn().mockReturnValue(null),
      } as any,
      userProfile: {} as any,
      projectHash: 'testhash',
      messages: [],
      activeFiles: new Map(),
      toolContext: {
        projectRoot: tmpDir,
        patchHistory: [],
        abortSignal: new AbortController().signal,
        activeFiles: new Map(),
        agentRole: 'user',
        sessionId: 'test',
        projectHash: 'testhash',
      },
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

    mockOrchestratorRun.mockResolvedValue('## Orchestration Complete: test feature\n\n[OK] **coder**: implemented test');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* cleanup temp dir */ }
    vi.restoreAllMocks();
  });

  it('warns when no feature description is given', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await executeCommand('/autopilot', mockContext);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('creates branch, runs orchestrator, and commits on success', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await executeCommand('/autopilot add a test feature', mockContext);

    expect(mockOrchestratorRun).toHaveBeenCalledTimes(1);
    expect(mockOrchestratorRun).toHaveBeenCalledWith('Implement the following feature: add a test feature');

    const branches = execSync('git branch', { cwd: tmpDir }).toString();
    expect(branches).toContain('daedalus-autopilot');

    const message = execSync('git log -1 --pretty=%s', { cwd: tmpDir }).toString().trim();
    expect(message).toBe('feat: add a test feature');
  });

  it('rolls back to main branch and deletes feature branch on orchestrator failure', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockOrchestratorRun.mockResolvedValue('Orchestration failed: something broke');

    await executeCommand('/autopilot rollback test', mockContext);

    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: tmpDir }).toString().trim();
    expect(branch).toBe('main');

    const branches = execSync('git branch', { cwd: tmpDir }).toString();
    expect(branches).not.toContain('daedalus-autopilot');
  });

  it('rolls back on partial verification failure', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockOrchestratorRun.mockResolvedValue('## Orchestration Hit Verification Failures: fix bug\n\n[ERROR] **coder**: something failed');

    await executeCommand('/autopilot fix a bug', mockContext);

    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: tmpDir }).toString().trim();
    expect(branch).toBe('main');
  });

  it('goes into local-only mode when no git remote is configured', async () => {
    execSync('git remote remove origin', { cwd: tmpDir });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockOrchestratorRun.mockResolvedValue('## Orchestration Complete: local test\n\n[OK] **coder**: done');

    await executeCommand('/autopilot local feature', mockContext);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No GitHub remote found'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('committed locally'));
    const message = execSync('git log -1 --pretty=%s', { cwd: tmpDir }).toString().trim();
    expect(message).toBe('feat: local feature');
  });
});


