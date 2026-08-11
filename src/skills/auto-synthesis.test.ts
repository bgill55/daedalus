import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { synthesizeSkillFromTurn, slugify } from './auto-synthesis.js';
import { setSkillsBaseDir, listSkillDrafts } from './draft.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Auto Skill Synthesis', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-synth-test-'));
    setSkillsBaseDir(tmpDir);
  });

  afterEach(() => {
    setSkillsBaseDir(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('slugifies titles correctly', () => {
    expect(slugify('Fix Vitest Config Lock Bug! 123')).toBe('fix-vitest-config-lock-bug-123');
  });

  it('synthesizes a new draft skill into the .drafts store', () => {
    const prompt = 'Fix typescript module resolution error in Express router';
    const summary = 'Installed @types/express and updated tsconfig.json moduleResolution to bundler.';
    const res = synthesizeSkillFromTurn(prompt, summary);

    expect(res.synthesized).toBe(true);
    expect(res.name).toBe('fix-typescript-module-resolution-error-in-express');

    // Draft must land where /skills reads it: <base>/.daedalus/skills/.drafts/<slug>.json
    const draftPath = path.join(tmpDir, '.daedalus', 'skills', '.drafts', `${res.name}.json`);
    expect(fs.existsSync(draftPath)).toBe(true);

    const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
    expect(draft.name).toBe('Fix typescript module resolution error in Express');
    expect(draft.trigger).toBe('fix-typescript-module-resolution-error-in-express-router');
    expect(draft.safety).toBe('instructions');
    expect(draft.body).toContain('Installed @types/express');
  });

  it('prevents duplicate skill synthesis if a draft already exists', () => {
    const prompt = 'Configure Helmet CSP headers for Express production app';
    const summary = 'Installed helmet and updated contentSecurityPolicy settings.';
    const first = synthesizeSkillFromTurn(prompt, summary);
    expect(first.synthesized).toBe(true);
    expect(listSkillDrafts().length).toBe(1);

    const second = synthesizeSkillFromTurn(prompt, summary);
    expect(second.synthesized).toBe(false);
    expect(listSkillDrafts().length).toBe(1);
  });
});
