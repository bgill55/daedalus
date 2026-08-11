import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { synthesizeSkillFromTurn, slugify } from './auto-synthesis.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Auto Skill Synthesis', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-synth-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('slugifies titles correctly', () => {
    expect(slugify('Fix Vitest Config Lock Bug! 123')).toBe('fix-vitest-config-lock-bug-123');
  });

  it('synthesizes a new draft skill when prompt and summary are provided', () => {
    const prompt = 'Fix typescript module resolution error in Express router';
    const summary = 'Installed @types/express and updated tsconfig.json moduleResolution to bundler.';
    const res = synthesizeSkillFromTurn(prompt, summary, tmpDir);

    expect(res.synthesized).toBe(true);
    expect(res.name).toBe('fix-typescript-module-resolution-error-i');
    expect(fs.existsSync(res.filePath!)).toBe(true);

    const content = fs.readFileSync(res.filePath!, 'utf8');
    expect(content).toContain('Fix typescript module resolution error in Express router');
    expect(content).toContain('Installed @types/express');
  });

  it('prevents duplicate skill synthesis if draft already exists', () => {
    const prompt = 'Configure Helmet CSP headers for Express production app';
    const summary = 'Installed helmet and updated contentSecurityPolicy settings.';
    const first = synthesizeSkillFromTurn(prompt, summary, tmpDir);
    expect(first.synthesized).toBe(true);

    const second = synthesizeSkillFromTurn(prompt, summary, tmpDir);
    expect(second.synthesized).toBe(false);
  });
});
