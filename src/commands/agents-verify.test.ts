import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAutopilotVerify } from './agents.js';

describe('runAutopilotVerify', () => {
  let dir: string;
  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('verifies a project scaffolded in a subdirectory (not just repo root)', async () => {
    // Reproduces the sandbox bug: autopilot scaffolded into ./daedalus-scan, and the
    // old code only looked at the repo root (no package.json there) -> returned ok:true
    // with nothing verified, letting broken code merge.
    dir = mkdtempSync(join(tmpdir(), 'daedalus-verify-'));
    const proj = join(dir, 'daedalus-scan');
    mkdirSync(proj, { recursive: true });
    // placeholder node_modules so the install step is skipped (keeps test offline/fast)
    mkdirSync(join(proj, 'node_modules'), { recursive: true });
    writeFileSync(join(proj, 'package.json'), JSON.stringify({
      name: 'daedalus-scan',
      scripts: { build: 'echo ok', test: 'echo ok' },
    }));
    const res = await runAutopilotVerify(dir);
    expect(res.ok).toBe(true);
  });

  it('returns ok:false when a nested project build fails', async () => {
    dir = mkdtempSync(join(tmpdir(), 'daedalus-verify-fail-'));
    const proj = join(dir, 'daedalus-scan');
    mkdirSync(proj, { recursive: true });
    mkdirSync(join(proj, 'node_modules'), { recursive: true });
    writeFileSync(join(proj, 'package.json'), JSON.stringify({
      name: 'daedalus-scan',
      scripts: { build: 'exit 1', test: 'echo ok' },
    }));
    const res = await runAutopilotVerify(dir);
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('daedalus-scan');
  });

  it('returns ok:true when repo root itself has the project', async () => {
    dir = mkdtempSync(join(tmpdir(), 'daedalus-verify-root-'));
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'root-proj',
      scripts: { build: 'echo ok', test: 'echo ok' },
    }));
    const res = await runAutopilotVerify(dir);
    expect(res.ok).toBe(true);
  });

  it('returns ok:true when there is no package.json anywhere (nothing to verify)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'daedalus-verify-empty-'));
    const res = await runAutopilotVerify(dir);
    expect(res.ok).toBe(true);
  });
});
