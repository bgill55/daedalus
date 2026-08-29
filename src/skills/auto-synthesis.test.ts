import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { synthesizeSkillFromTurn, slugify, isTrivialPrompt, isInformationalPrompt, isSocialPrompt } from './auto-synthesis.js';
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
    const summary = 'Installed helmet and updated contentSecurityPolicy settings in src/app.ts. Ran `npm run build`.';
    const first = synthesizeSkillFromTurn(prompt, summary);
    expect(first.synthesized).toBe(true);
    expect(listSkillDrafts().length).toBe(1);

    const second = synthesizeSkillFromTurn(prompt, summary);
    expect(second.synthesized).toBe(false);
    expect(listSkillDrafts().length).toBe(1);
  });

  describe('isTrivialPrompt', () => {
    it('flags bare acknowledgements as trivial', () => {
      expect(isTrivialPrompt('yes')).toBe(true);
      expect(isTrivialPrompt('ok')).toBe(true);
      expect(isTrivialPrompt('awesome')).toBe(true);
      expect(isTrivialPrompt('  Yes ')).toBe(true);
    });

    it('flags transition/continuation prompts as trivial', () => {
      expect(isTrivialPrompt('lets move on to #4')).toBe(true);
      expect(isTrivialPrompt('move on to issue 5')).toBe(true);
      expect(isTrivialPrompt('lets do that start with 1 and 2')).toBe(true);
      expect(isTrivialPrompt('ok awesome, lets look at the project as a whole')).toBe(true);
    });

    it('does NOT flag substantive task prompts as trivial', () => {
      expect(isTrivialPrompt('Fix typescript module resolution error in Express router')).toBe(false);
      expect(isTrivialPrompt('Add input validation for the preview panel')).toBe(false);
      expect(isTrivialPrompt('Implement a refine workflow with a save-to-existing dropdown')).toBe(false);
    });
  });

  describe('isInformationalPrompt', () => {
    it('flags overview, explanation, and how-to-test queries as informational', () => {
      expect(isInformationalPrompt('hey i dont need any coding right now, but can you break down how this project works and how I can test it.')).toBe(true);
      expect(isInformationalPrompt('explain how this project works')).toBe(true);
      expect(isInformationalPrompt('what is this repository?')).toBe(true);
      expect(isInformationalPrompt('how do I test this project?')).toBe(true);
      expect(isInformationalPrompt('walk me through the codebase')).toBe(true);
    });

    it('does NOT flag actionable bug fixes or feature requests as informational', () => {
      expect(isInformationalPrompt('Fix typescript module resolution error in Express router')).toBe(false);
      expect(isInformationalPrompt('Add GitHub API Token Authentication support')).toBe(false);
      expect(isInformationalPrompt('Refactor the suggestion rules into a modular pipeline')).toBe(false);
    });
  });

  it('skips synthesis for trivial acknowledgement turns', () => {
    const res = synthesizeSkillFromTurn('yes', 'The fix is already in place on disk.');
    expect(res.synthesized).toBe(false);
  });

  it('skips synthesis when the summary reports no work was performed', () => {
    const prompt = 'Check whether the dead exports were already removed from src/types.ts';
    const summary = 'Both issues are already resolved in the current codebase. No further changes are required.';
    const res = synthesizeSkillFromTurn(prompt, summary);
    expect(res.synthesized).toBe(false);
  });

  it('skips synthesis for casual / meta turns with no work signal', () => {
    // Regression: a conversational chat about the tool itself (e.g. joking about the
    // guardrails) must not synthesize a skill draft. The model's banter summary has
    // no "did work" verb, so the work-signal gate blocks it.
    const prompt = 'lol this made me laugh, you are correct it shouldnt create skills from non working prompts or casual talk';
    const summary = 'The user pointed out the guardrails were too strict and we made fixes. The banter keeps it fresh for end users.';
    const res = synthesizeSkillFromTurn(prompt, summary);
    expect(res.synthesized).toBe(false);
  });

  it('skips synthesis for a praise / verification-summary turn with no reusable recipe', () => {
    // Regression: a "good job" praise turn whose summary only restates verified work
    // ("60 tests pass / verified on disk / changes made") has work verbs but NO procedure.
    // It is a status report, not a playbook, so it must not synthesize a draft. Note the
    // summary deliberately avoids naming any command/file (e.g. "npm run lint") so it is a
    // pure status report, not a recipe.
    const prompt = 'well done Daedalus, i just checked the work you did 10/10';
    const summary =
      'All 60 tests passed and typecheck is clean. The changes are verified on disk. ' +
      'The changes are real and on disk and the suite is green.';
    const res = synthesizeSkillFromTurn(prompt, summary);
    expect(res.synthesized).toBe(false);
  });

  it('still synthesizes when the summary carries a real procedural recipe', () => {
    // The gate must NOT block turns that actually contain a reusable how-to (commands,
    // file refs, or step lists) alongside the work verbs.
    const prompt = 'Fix typescript module resolution error in Express router';
    const summary =
      'Installed @types/express and ran `npm run build`. Updated tsconfig.json moduleResolution to bundler. Steps:\n1. add @types/express\n2. set moduleResolution';
    const res = synthesizeSkillFromTurn(prompt, summary);
    expect(res.synthesized).toBe(true);
  });

  it('skips synthesis for informational overview and how-to-test queries', () => {
    const prompt = 'hey i dont need any coding right now, but can you break down how this project works and how I can test it.';
    const summary = '1. Project Overview\n2. How to Test:\n   npm test\n   npm run build\n3. Development Workflow';
    const res = synthesizeSkillFromTurn(prompt, summary);
    expect(res.synthesized).toBe(false);
  });

  describe('isSocialPrompt', () => {
    it('flags greetings, laughter, and praise as social', () => {
      expect(isSocialPrompt('hey daedalus')).toBe(true);
      expect(isSocialPrompt('  Hi there')).toBe(true);
      expect(isSocialPrompt('lol can you look at this project')).toBe(true);
      expect(isSocialPrompt('job well done')).toBe(true);
      expect(isSocialPrompt('woohoo thanks daedalus')).toBe(true);
      expect(isSocialPrompt('validated')).toBe(true);
    });

    it('does NOT flag substantive task prompts as social', () => {
      expect(isSocialPrompt('Fix typescript module resolution error in Express router')).toBe(false);
      expect(isSocialPrompt('Add input validation for the preview panel')).toBe(false);
      expect(isSocialPrompt('can you look at this project and do an audit and fix the bugs')).toBe(false);
    });
  });

  it('skips synthesis for a greeting turn even when the summary mentions verified work', () => {
    // Regression: greetings like "hey daedalus" / "job well done" produce a model
    // summary containing "verified on disk" / "build passes", which previously slipped
    // past the work-signal gate and synthesized a junk draft. The social-prompt guard
    // on the USER prompt must block it regardless of the summary contents.
    const prompt = 'job well done daedalus i just checked the work you did';
    const summary = 'All 6 tests passed and the build is clean. The changes are verified on disk.';
    const res = synthesizeSkillFromTurn(prompt, summary);
    expect(res.synthesized).toBe(false);
  });

  it('skips synthesis for a self-correction / admission turn (no edit performed)', () => {
    // Regression: the user pointed out a fabricated finding; the model admitted it and
    // re-verified the file. The summary contains "verified on disk" / "build passes" but
    // NO actual edit was made, so it must not synthesize a playbook from the admission.
    const prompt = 'can you redo the audit fixing the corrections i pointed out';
    const summary =
      'I falsely claimed github-client.ts had unused imports. That was a fabrication. ' +
      'The actual file imports only GITHUB_API, RETRY and Repo. Build passes, tests pass (6/6 green), no patches applied.';
    const res = synthesizeSkillFromTurn(prompt, summary);
    expect(res.synthesized).toBe(false);
  });

  it('still synthesizes when a turn actually edited or created something', () => {
    // The edit-signal gate must still allow genuine implementation turns through.
    const prompt = 'Add input validation for the preview panel';
    const summary = 'Edited src/preview.ts to validate the panel input and added a unit test in test/preview.test.ts.';
    const res = synthesizeSkillFromTurn(prompt, summary);
    expect(res.synthesized).toBe(true);
  });
});
