import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { writeSkillDraft, acceptSkillDraft, discardSkillDraft, listSkillDrafts, setSkillsBaseDir } from '../skills/draft.js';
import { skillsCommand } from './skills.js';
import type { CommandContext } from './types.js';

const ISOLATED = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-skills-'));
const DRAFTS = path.join(ISOLATED, '.daedalus', 'skills', '.drafts');
const USER_SKILLS = path.join(ISOLATED, '.daedalus', 'skills');

function cleanup() {
  fs.rmSync(DRAFTS, { recursive: true, force: true });
  fs.rmSync(path.join(USER_SKILLS, 'smoke-test-skill'), { recursive: true, force: true });
}

beforeEach(() => { setSkillsBaseDir(ISOLATED); cleanup(); });
afterEach(() => { cleanup(); setSkillsBaseDir(null); });

function makeCtx(args: string): CommandContext {
  return { config: {} as any, configDir: '', cliTempDir: '' } as unknown as CommandContext;
}

describe('/skills command', () => {
  it('accept promotes a draft into an active trusted skill', async () => {
    writeSkillDraft({
      name: 'Smoke Test Skill',
      description: 'demo',
      trigger: 'smoke',
      safety: 'instructions',
      body: 'Run the smoke test.',
    });
    expect(listSkillDrafts().length).toBe(1);
    await skillsCommand.execute('accept Smoke Test Skill', makeCtx('accept Smoke Test Skill'));
    expect(listSkillDrafts().length).toBe(0);
    expect(fs.existsSync(path.join(USER_SKILLS, 'smoke-test-skill', 'SKILL.md'))).toBe(true);
  });

  it('discard removes a pending draft', async () => {
    writeSkillDraft({
      name: 'Smoke Test Skill',
      description: 'demo',
      trigger: 'smoke',
      safety: 'instructions',
      body: 'Run the smoke test.',
    });
    await skillsCommand.execute('discard Smoke Test Skill', makeCtx('discard Smoke Test Skill'));
    expect(listSkillDrafts().length).toBe(0);
  });

  it('accept on a missing draft reports not found', async () => {
    // Should not throw; just prints a warning. Draft dir stays empty.
    await skillsCommand.execute('accept Nope', makeCtx('accept Nope'));
    expect(listSkillDrafts().length).toBe(0);
  });
});
