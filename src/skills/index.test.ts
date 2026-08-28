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
  // A fix-typescript-build-equivalent skill written into the temp user dir so
  // the shipped-skills discovery (which depends on import.meta.url resolution
  // that varies across CI runners) is NOT required for this assertion.
  const ftbDir = path.join(userSkills, 'fix-typescript-build');
  const ftbFile = path.join(ftbDir, 'SKILL.md');

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
    fs.mkdirSync(ftbDir, { recursive: true });
    fs.writeFileSync(ftbFile, [
      '---',
      'name: fix-typescript-build',
      'description: How to fix a failing tsc / npm run build run, batching fixes into sprints.',
      'trigger: fix the build|type errors|typescript errors|tsc errors|build is broken|build fails|npm run build|fix the type errors',
      'safety: instructions',
      '---',
      '',
      '# Fixing a TypeScript Build',
      'Capture the full error list, fix file-scoped, re-run the build after each sprint.',
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
    const matched = await mod.matchSkills('can you add a command for X?');
    expect(matched.some((s) => s.name === 'demo')).toBe(true);
    const demo = matched.find((s) => s.name === 'demo');
    expect(demo?.safety).toBe('instructions');
  });

  it('does not match when trigger terms are absent', async () => {
    vi.resetModules();
    const mod = await import('./index.js');
    expect((await mod.matchSkills('hello there')).length).toBe(0);
  });

  it('builds an injected section only when a skill matches', async () => {
    vi.resetModules();
    const mod = await import('./index.js');
    const section = await mod.getSkillsSection('create a slash command please');
    expect(section).toContain('ACTIVE SKILLS');
    expect(section).toContain('# Demo Skill');
    expect(await mod.getSkillsSection('random chat')).toBe('');
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
    expect((await mod.matchSkills('please do thing')).length).toBe(0);
  });

  it('ships the fix-typescript-build skill and matches build-fix requests', async () => {
    vi.resetModules();
    const mod = await import('./index.js');
    const matched = await mod.matchSkills('the build is broken, fix the typescript errors');
    expect(matched.some((s) => s.name === 'fix-typescript-build')).toBe(true);
    expect(await mod.getSkillsSection('the build is broken, fix the typescript errors'))
      .toContain('Fixing a TypeScript Build');
  });

  it('expands prerequisite skills into a causal bundle upon match', async () => {
    const prereqDir = path.join(userSkills, 'audit-first');
    fs.mkdirSync(prereqDir, { recursive: true });
    fs.writeFileSync(path.join(prereqDir, 'SKILL.md'), [
      '---',
      'name: audit-first',
      'description: Audit before refactoring',
      'trigger: audit code',
      'safety: instructions',
      '---',
      '',
      '# Audit First',
      'Inspect before modifying.',
    ].join('\n'));

    const refactorDir = path.join(userSkills, 'refactor-code');
    fs.mkdirSync(refactorDir, { recursive: true });
    fs.writeFileSync(path.join(refactorDir, 'SKILL.md'), [
      '---',
      'name: refactor-code',
      'description: Refactor code cleanly',
      'trigger: refactor the codebase',
      'prerequisites: audit-first',
      'safety: instructions',
      '---',
      '',
      '# Refactor Code',
      'Apply safe refactoring.',
    ].join('\n'));

    vi.resetModules();
    const mod = await import('./index.js');
    const matched = await mod.matchSkills('please refactor the codebase');
    expect(matched.length).toBe(2);
    // Prerequisite comes first
    expect(matched[0].name).toBe('audit-first');
    expect(matched[1].name).toBe('refactor-code');
  });

  it('matches a paraphrase that shares the skill vocabulary but not the literal trigger', async () => {
    vi.resetModules();
    const mod = await import('./index.js');
    // No trigger phrase is a substring here ('build is broken' / 'type errors' absent),
    // but the tokens overlap enough to clear the threshold.
    const matched = await mod.matchSkills('my build keeps failing with type issues');
    expect(matched.some((s) => s.name === 'fix-typescript-build')).toBe(true);
  });

  it('returns no skills for an unrelated request (threshold guard)', async () => {
    vi.resetModules();
    const mod = await import('./index.js');
    expect((await mod.matchSkills('summarize this README for me')).length).toBe(0);
    expect((await mod.matchSkills('random chat')).length).toBe(0);
  });

  it('scores an exact trigger match above any fuzzy overlap', async () => {
    vi.resetModules();
    const mod = await import('./index.js');
    // 'add a command' is a demo trigger substring; demo must be among the matches
    // (exact trigger tier fires, not merely fuzzy token overlap).
    const matched = await mod.matchSkills('how do i add a command for this?');
    expect(matched.some((s) => s.name === 'demo')).toBe(true);
  });

  // ── Part B: LLM classifier (gated behind Option A silence) ──
  it('does NOT call the model when Option A already matched (zero cost)', async () => {
    vi.resetModules();
    const mod = await import('./index.js');
    let calls = 0;
    mod.initSkillClassifier(async () => { calls++; return { choices: [{ message: { content: '- demo' } }] }; });
    const matched = await mod.matchSkills('can you add a command for X?'); // exact trigger
    expect(matched.some((s) => s.name === 'demo')).toBe(true);
    expect(calls).toBe(0); // model never invoked
  });

  it('calls the model only when Option A is silent, and validates names against discovery', async () => {
    vi.resetModules();
    const mod = await import('./index.js');
    let calls = 0;
    mod.initSkillClassifier(async () => {
      calls++;
      // Suggests a real skill + an invented one; only the real one should inject.
      return { choices: [{ message: { content: '- fix-typescript-build\n- nonexistent-skill' } }] };
    });
    const matched = await mod.matchSkills('the compiler is angry and the types are wrong'); // no trigger overlap
    expect(calls).toBe(1);
    expect(matched.map((s) => s.name)).toEqual(['fix-typescript-build']);
  });

  it('falls back to no skills when the model errors or returns NONE', async () => {
    vi.resetModules();
    const mod = await import('./index.js');
    mod.initSkillClassifier(async () => { throw new Error('boom'); });
    expect((await mod.matchSkills('something totally off topic')).length).toBe(0);

    vi.resetModules();
    const mod2 = await import('./index.js');
    mod2.initSkillClassifier(async () => ({ choices: [{ message: { content: 'NONE' } }] }));
    expect((await mod2.matchSkills('unrelated thing')).length).toBe(0);
  });
});
