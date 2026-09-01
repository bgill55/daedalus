import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Intercept dotenv at module-load time so we can capture how loop.js calls config().
const configMock = vi.fn().mockReturnValue({ parsed: {} });
vi.mock('dotenv', () => ({ default: { config: configMock }, config: configMock }));

describe('dotenv env loading (security)', () => {
  const origCwd = process.cwd();

  beforeEach(() => {
    configMock.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(origCwd);
  });

  it('scopes dotenv to ~/.daedalus/.env, never the current working directory', async () => {
    // Simulate launching Daedalus from inside a project dir that has its own .env
    // (e.g. a repo with a GITHUB_TOKEN). Importing loop.js triggers its module-load
    // dotenv.config() call.
    const proj = path.join(os.tmpdir(), `daedalus-env-leak-test-${Date.now()}`);
    fs.mkdirSync(proj, { recursive: true });
    try {
      process.chdir(proj);

      await import('./loop.js');

      expect(configMock).toHaveBeenCalled();
      const call = configMock.mock.calls[0][0];
      expect(call).toBeDefined();
      expect(call.quiet).toBe(true);
      // Must point at Daedalus's home env, NOT the cwd .env.
      expect(call.path).toBe(path.join(os.homedir(), '.daedalus', '.env'));
      expect(call.path.startsWith(proj)).toBe(false);
    } finally {
      process.chdir(origCwd);
      try { fs.rmSync(proj, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
