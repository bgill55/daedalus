import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-config-test-'));

const {
  ConfigSchema,
  RouterConfigSchema,
  ModelEntrySchema,
  loadConfig,
  saveConfig,
  resetConfig,
  getConfigDirPath,
  discoverLocalServers,
} = await import('./index.js');

describe('ConfigSchema validation', () => {

  it('accepts a minimal valid config', () => {
    const result = ConfigSchema.safeParse({
      router: {
        strategy: 'priority',
        chain: [{ name: 'test', endpoint: 'http://localhost:1234/v1', model: 'auto', priority: 1, enabled: true }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid router strategy', () => {
    const result = ConfigSchema.safeParse({
      router: {
        strategy: 'invalid',
        chain: [],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid endpoint format', () => {
    const result = ModelEntrySchema.safeParse({
      name: 'test',
      endpoint: 'not-a-url',
      model: 'auto',
      priority: 1,
      enabled: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative priority', () => {
    const result = ModelEntrySchema.safeParse({
      name: 'test',
      endpoint: 'http://localhost:1234/v1',
      model: 'auto',
      priority: -1,
      enabled: true,
    });
    expect(result.success).toBe(false);
  });

  it('fills defaults when only router is provided', () => {
    const config = ConfigSchema.parse({
      router: { strategy: 'priority', chain: [] },
    });
    expect(config.version).toBe(1);
    expect(config.router.healthCheckInterval).toBe(30000);
    expect(config.indexing.enabled).toBe(true);
    expect(config.ui.streaming).toBe(true);
    expect(config.ui.theme).toBe('dark');
    expect(config.session.autoSave).toBe(true);
  });

  it('accepts all tool config variations', () => {
    const result = ConfigSchema.safeParse({
      router: { strategy: 'round-robin', chain: [] },
      tools: {
        mcpServers: {
          myServer: { transport: 'stdio', command: 'node', args: ['server.js'], enabled: true },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts ensemble config', () => {
    const result = ConfigSchema.safeParse({
      router: { strategy: 'priority', chain: [] },
      agents: {
        ensemble: { enabled: true, draftModel: 'fast-model', criticModel: 'smart-model', maxLoops: 3 },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects ensemble maxLoops outside range', () => {
    const result = ConfigSchema.safeParse({
      router: { strategy: 'priority', chain: [] },
      agents: {
        ensemble: { enabled: true, maxLoops: 10 },
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts host:port endpoint format', () => {
    const result = ModelEntrySchema.safeParse({
      name: 'test',
      endpoint: 'localhost:11434',
      model: 'auto',
      priority: 1,
      enabled: true,
    });
    expect(result.success).toBe(true);
  });

  it('requires router field', () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

});

describe('loadConfig', () => {
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;

  beforeEach(() => {
    vi.stubEnv('HOME', TEST_DIR);
    vi.stubEnv('USERPROFILE', TEST_DIR);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    const configDir = path.join(TEST_DIR, '.daedalus');
    try { fs.rmSync(configDir, { recursive: true, force: true }); } catch {}
  });

  it('creates default config when file does not exist', () => {
    const config = loadConfig();
    expect(config.version).toBe(1);
    expect(config.router.chain.length).toBeGreaterThan(0);
    expect(config.router.chain[0].name).toBe('lmstudio-default');
  });

  it('loads an existing config file', () => {
    const configDir = path.join(TEST_DIR, '.daedalus');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
      router: { strategy: 'fastest', chain: [{ name: 'm', endpoint: 'http://localhost:1234/v1', model: 'm1', priority: 1, enabled: true }] },
    }), 'utf8');

    const config = loadConfig();
    expect(config.router.strategy).toBe('fastest');
    expect(config.router.chain).toHaveLength(1);
  });

  it('falls back to defaults on corrupt config', () => {
    const configDir = path.join(TEST_DIR, '.daedalus');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), '{ broken json');

    const config = loadConfig();
    expect(config.version).toBe(1);
    expect(config.router.strategy).toBe('priority');
  });

  it('validates and strips unknown fields', () => {
    const configDir = path.join(TEST_DIR, '.daedalus');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
      router: { strategy: 'priority', chain: [] },
      unknownField: 'should be removed by zod',
    }));

    const config = loadConfig();
    expect((config as any).unknownField).toBeUndefined();
  });

});

describe('saveConfig', () => {
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;

  beforeEach(() => {
    vi.stubEnv('HOME', TEST_DIR);
    vi.stubEnv('USERPROFILE', TEST_DIR);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    const configDir = path.join(TEST_DIR, '.daedalus');
    try { fs.rmSync(configDir, { recursive: true, force: true }); } catch {}
  });

  it('persists config to disk and reads it back', () => {
    const testConfig = {
      router: { strategy: 'priority', chain: [] },
      version: 1,
      agents: { default: 'coder', available: ['coder'], autoOrchestrate: true, ensemble: { enabled: false, draftModel: 'auto', criticModel: 'auto', maxLoops: 2 } },
      tools: { builtin: [], mcpServers: {} },
      context: { maxTokens: 128000, summarizeAt: 0.8, includeGitDiff: true, includeIndex: true },
      indexing: { enabled: true, watch: true, languages: ['typescript'], exclude: ['node_modules'] },
      updateCheck: true,
      session: { autoSave: true, exportJsonl: true, maxHistoryTurns: 200 },
      ui: { streaming: true, showTokens: true, showCost: true, diffStyle: 'unified', theme: 'dark' },
    } as any;

    saveConfig(testConfig);

    const savedDir = path.join(TEST_DIR, '.daedalus');
    const saved = JSON.parse(fs.readFileSync(path.join(savedDir, 'config.json'), 'utf8'));
    expect(saved.router.strategy).toBe('priority');
  });

});

describe('getConfigDirPath', () => {
  it('returns the config directory path', () => {
    const dir = getConfigDirPath();
    expect(dir).toContain('.daedalus');
  });
});

describe('discoverLocalServers', () => {
  it('returns empty array when mock rejects all', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no server'));
    const results = await discoverLocalServers();
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
    vi.restoreAllMocks();
  });
});

describe('resetConfig', () => {
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;

  beforeEach(() => {
    vi.stubEnv('HOME', TEST_DIR);
    vi.stubEnv('USERPROFILE', TEST_DIR);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    const configDir = path.join(TEST_DIR, '.daedalus');
    try { fs.rmSync(configDir, { recursive: true, force: true }); } catch {}
  });

  it('resets and returns default config', () => {
    const config = resetConfig();
    expect(config.router.strategy).toBe('priority');
    expect(config.router.chain.length).toBeGreaterThan(0);
  });
});
