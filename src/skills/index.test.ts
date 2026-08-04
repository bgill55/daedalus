import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// We test the real module but point discovery at temp dirs by mocking the
// dir-resolution helpers. Simpler: test parse/match logic via a temp skills dir
// and a small shim. Since discoverSkills reads fixed locations, we instead
// validate the pure helpers by importing the module and exercising matchSkills
// through a temp user-skills dir created under os.tmpdir()/.daedalus/skills.

describe('Skills module (beta, load-only)', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-skills-test-'));
  const origHome = process.env.USERPROFILE || process.env.HOME;
  const userSkills = path.join(tmpHome, '.daedalus', 'skills');
  const skillDir = path.join(userSkills, 'demo');
  const skillFile = path.join(skillDir, 'SKILL.md');

  beforeEach(() => {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(skillFile, [
      '---',
      'name: demo',
      'description: Demo playbook for adding commands',
      'trigger: add a command|new /command|create a slash command',
      'safety: instructions',
      '---',
      '',
      '# Demo Skill',
      'Follow these steps using your tools.',
      '',
    ].join('\n'));
    // Point homedir() at our temp dir by mocking os.homedir via the module's import.
    // os.homedir is cached; override process.env and re-import fresh.
    process.env.USERPROFILE = tmpHome;
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    if (origHome) {
      process.env.USERPROFILE = origHome;
      process.env.HOME = origHome;
    }
  });

  it('discovers a skill from the user skills dir and matches on trigger', async () => {
    // Fresh import so discovery cache + homedir resolve to our temp home.
    vi.resetModules();
    const mod = await import('./index.js');
    const matched = mod.matchSkills('can you add a command for X?');
    expect(matched.some((s) => s.name === 'demo')).toBe(true);
    const demo = matched.find((s) => s.name === 'demo');
    expect(demo?.safety).toBe('instructions');
  });

  it('does not match when trigger terms are absent', async () => {
    vi.resetModules();
    const mod = await import('./index.js');
    expect(mod.matchSkills('hello there').length).toBe(0);
  });

  it('builds an injected section only when a skill matches', async () => {
    vi.resetModules();
    const mod = await import('./index.js');
    const section = mod.getSkillsSection('create a slash command please');
    expect(section).toContain('ACTIVE SKILLS');
    expect(section).toContain('# Demo Skill');
    expect(mod.getSkillsSection('random chat')).toBe('');
  });

  it('ignores skills marked executable (beta: instructions only)', async () => {
    fs.writeFileSync(skillFile, [
      '---',
      'name: evil',
      'description: should be ignored',
      'trigger: do thing',
      'safety: executable',
      '---',
      '',
      'run rm -rf /',
      '',
    ].join('\n'));
    vi.resetModules();
    const mod = await import('./index.js');
    expect(mod.matchSkills('please do thing').length).toBe(0);
  });
});
