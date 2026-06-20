import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  loadProjectConfig,
  saveProjectConfig,
  getTestCommand,
  setTestCommand,
  getProjectConfig,
  ProjectConfig,
} from './project-config.js';

describe('Project config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-pc-test-'));
    vi.stubEnv('HOME', tmpDir);
    vi.stubEnv('USERPROFILE', tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('loadProjectConfig returns defaults when no config exists', () => {
    const config = loadProjectConfig(tmpDir);
    expect(config.projectHash).toBeTruthy();
    expect(config.testCommand).toBeUndefined();
    expect(config.autoRunTests).toBe(true);
  });

  it('saveProjectConfig persists config to disk', () => {
    const config: ProjectConfig = {
      projectHash: 'testhash123',
      projectRoot: tmpDir,
      testCommand: 'npm test',
      buildCommand: 'npm run build',
      lintCommand: 'npm run lint',
      devCommand: 'npm run dev',
      autoRunTests: false,
      enableGitAutoCommit: true,
      updated_at: Date.now(),
    };
    saveProjectConfig(config);

    const loaded = loadProjectConfig(tmpDir);
    expect(loaded.testCommand).toBe('npm test');
    expect(loaded.autoRunTests).toBe(false);
    expect(loaded.enableGitAutoCommit).toBe(true);
  });

  it('getTestCommand returns undefined when not set', () => {
    expect(getTestCommand(tmpDir)).toBeUndefined();
  });

  it('setTestCommand persists the command', () => {
    setTestCommand(tmpDir, 'pnpm test:ci');
    expect(getTestCommand(tmpDir)).toBe('pnpm test:ci');
  });

  it('setTestCommand overwrites previous command', () => {
    setTestCommand(tmpDir, 'first');
    setTestCommand(tmpDir, 'second');
    expect(getTestCommand(tmpDir)).toBe('second');
  });

  it('getProjectConfig returns full config', () => {
    setTestCommand(tmpDir, 'jest');
    const config = getProjectConfig(tmpDir);
    expect(config.testCommand).toBe('jest');
    expect(config.projectRoot).toBe(tmpDir);
  });

  it('loadProjectConfig merges with defaults for missing fields', () => {
    const configDir = path.join(tmpDir, '.daedalus', 'config');
    fs.mkdirSync(configDir, { recursive: true });
    const hash = crypto.createHash('sha256').update(path.resolve(tmpDir)).digest('hex').slice(0, 12);
    fs.writeFileSync(path.join(configDir, `${hash}.json`), JSON.stringify({
      testCommand: 'jest',
    }), 'utf8');

    const config = loadProjectConfig(tmpDir);
    expect(config.testCommand).toBe('jest');
    expect(config.autoRunTests).toBe(true);
    expect(config.projectHash).toBe(hash);
  });

  it('loadProjectConfig falls back to defaults for corrupt file', () => {
    const configDir = path.join(tmpDir, '.daedalus', 'config');
    fs.mkdirSync(configDir, { recursive: true });
    const hash = crypto.createHash('sha256').update(path.resolve(tmpDir)).digest('hex').slice(0, 12);
    fs.writeFileSync(path.join(configDir, `${hash}.json`), '{ broken', 'utf8');

    const config = loadProjectConfig(tmpDir);
    expect(config.testCommand).toBeUndefined();
  });

});
