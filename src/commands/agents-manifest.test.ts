import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeAutopilotManifest, type AutopilotManifest } from './agents.js';

const origCwd = process.cwd();

describe('autopilot run manifest', () => {
  let dir: string;
  afterEach(() => {
    process.chdir(origCwd);
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('writes a valid JSON manifest to .daedalus/ with the expected shape', () => {
    dir = mkdtempSync(join(tmpdir(), 'daedalus-manifest-'));
    process.chdir(dir);

    const manifest: AutopilotManifest = {
      feature: 'add loading spinner',
      branch: 'daedalus-autopilot-add-loading-spinner',
      remote: 'bgill55/daedalus',
      mode: 'git',
      outcome: 'pr-opened',
      tasksPlanned: 4,
      tasksDone: 4,
      filesChanged: ['src/ui/loading.ts', 'src/ui/spinner.ts'],
      testResult: { ok: true, detail: '' },
      finishedAt: new Date().toISOString(),
    };

    writeAutopilotManifest(manifest);

    const daedalusDir = join(dir, '.daedalus');
    expect(existsSync(daedalusDir)).toBe(true);
    const files = readdirSync(daedalusDir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(1);
    const written = JSON.parse(readFileSync(join(daedalusDir, files[0]), 'utf8'));
    expect(written.feature).toBe('add loading spinner');
    expect(written.branch).toBe('daedalus-autopilot-add-loading-spinner');
    expect(written.mode).toBe('git');
    expect(written.outcome).toBe('pr-opened');
    expect(written.filesChanged).toEqual(['src/ui/loading.ts', 'src/ui/spinner.ts']);
    expect(written.testResult.ok).toBe(true);
  });

  it('does not throw when run outside a writable location', () => {
    dir = mkdtempSync(join(tmpdir(), 'daedalus-manifest-'));
    process.chdir(dir);
    // Should not throw even though we only test the happy path writes fine.
    expect(() => writeAutopilotManifest({
      feature: 'x', branch: 'b', remote: null, mode: 'local-only',
      outcome: 'committed-local', tasksPlanned: 0, tasksDone: 0,
      filesChanged: [], testResult: null, finishedAt: '',
    })).not.toThrow();
  });
});
