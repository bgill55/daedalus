import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { checkChangelogOnUpgrade } from './update-check.js';

describe('Update Check & Changelog Detection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('initializes the version file and does not print changelog on first run', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const versionFilePath = path.join(tempDir, 'version.json');
    const changelogPath = path.join(tempDir, 'CHANGELOG.md');

    checkChangelogOnUpgrade('1.11.0', tempDir, changelogPath);

    expect(logSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(versionFilePath)).toBe(true);
    const stored = JSON.parse(fs.readFileSync(versionFilePath, 'utf8'));
    expect(stored.lastRunVersion).toBe('1.11.0');
  });

  it('does not print changelog if the version is the same', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const versionFilePath = path.join(tempDir, 'version.json');
    const changelogPath = path.join(tempDir, 'CHANGELOG.md');

    // Pre-create the version file
    fs.writeFileSync(versionFilePath, JSON.stringify({ lastRunVersion: '1.11.0' }), 'utf8');

    checkChangelogOnUpgrade('1.11.0', tempDir, changelogPath);

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('prints the latest changes and updates version file when upgraded', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const versionFilePath = path.join(tempDir, 'version.json');
    const changelogPath = path.join(tempDir, 'CHANGELOG.md');

    // Pre-create version file with older version
    fs.writeFileSync(versionFilePath, JSON.stringify({ lastRunVersion: '1.10.1' }), 'utf8');

    // Pre-create dummy CHANGELOG.md
    fs.writeFileSync(
      changelogPath,
      '# 1.11.0 (2026-06-21)\n\n### Features\n\n* added awesome feature\n\n## 1.10.1 (2026-06-20)\n\n### Bug Fixes\n\n* fixed a bug\n',
      'utf8'
    );

    checkChangelogOnUpgrade('1.11.0', tempDir, changelogPath);

    // Should print welcome message and changelog
    expect(logSpy).toHaveBeenCalled();
    const calls = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(calls).toContain('Welcome to Daedalus version');
    expect(calls).toContain('1.11.0');
    expect(calls).toContain('1.10.1');
    expect(calls).toContain('added awesome feature');
    expect(calls).not.toContain('fixed a bug'); // Old version should be skipped

    // Version file should be updated
    const stored = JSON.parse(fs.readFileSync(versionFilePath, 'utf8'));
    expect(stored.lastRunVersion).toBe('1.11.0');
  });
});

