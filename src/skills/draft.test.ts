import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';
import {
  writeSkillDraft,
  listSkillDrafts,
  acceptSkillDraft,
  discardSkillDraft,
  setSkillsBaseDir,
} from './draft.js';

const ISOLATED = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-skills-'));
const DRAFTS = path.join(ISOLATED, '.daedalus', 'skills', '.drafts');
const USER_SKILLS = path.join(ISOLATED, '.daedalus', 'skills');

function cleanup() {
  fs.rmSync(DRAFTS, { recursive: true, force: true });
  fs.rmSync(path.join(USER_SKILLS, 'my-test-skill'), { recursive: true, force: true });
}

beforeEach(() => setSkillsBaseDir(ISOLATED));
afterEach(() => setSkillsBaseDir(null));

describe('skill drafts', () => {
  it('writes a draft that discovery ignores (separate dir)', () => {
    const p = writeSkillDraft({
      name: 'My Test Skill',
      description: 'demo',
      trigger: 'demo',
      safety: 'instructions',
      body: 'Do the thing.',
    });
    expect(fs.existsSync(p)).toBe(true);
    // Drafts live under .drafts, never directly under the skills dir as active.
    expect(p).toContain('.drafts');
    expect(listSkillDrafts().length).toBe(1);
  });

  it('accept moves draft into an active trusted skill and clears the draft', () => {
    writeSkillDraft({
      name: 'My Test Skill',
      description: 'demo',
      trigger: 'demo',
      safety: 'instructions',
      body: 'Do the thing.',
    });
    const skillPath = acceptSkillDraft('My Test Skill');
    expect(skillPath).not.toBeNull();
    expect(fs.existsSync(skillPath!)).toBe(true);
    expect(fs.readFileSync(skillPath!, 'utf8')).toContain('Do the thing.');
    // Draft removed after acceptance.
    expect(listSkillDrafts().length).toBe(0);
  });

  it('discard removes the draft', () => {
    writeSkillDraft({
      name: 'My Test Skill',
      description: 'demo',
      trigger: 'demo',
      safety: 'instructions',
      body: 'Do the thing.',
    });
    expect(discardSkillDraft('My Test Skill')).toBe(true);
    expect(listSkillDrafts().length).toBe(0);
  });

  it('accept returns null for a missing draft', () => {
    expect(acceptSkillDraft('does-not-exist')).toBeNull();
  });
});
