import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { planNamesTestFiles, orphanedModuleWarning, isFileImported } from './orchestrator-validation.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('planNamesTestFiles (spec-contract test intent)', () => {
  it('arms the lock when the goal explicitly names a test file', () => {
    expect(planNamesTestFiles('create tests/ui/debounce.test.ts')).toBe(true);
    expect(planNamesTestFiles('implement src/__tests__/loader.spec.js')).toBe(true);
    expect(planNamesTestFiles('add src/components/Button.test.tsx')).toBe(true);
    expect(planNamesTestFiles('fix tests/api/user.test.mjs')).toBe(true);
    expect(planNamesTestFiles('write test/integration.spec.cjs')).toBe(true);
  });

  it('does NOT arm the lock when the goal only mentions "tests" generically', () => {
    // These were the false-arms that let an empty test file through.
    expect(planNamesTestFiles('Implement the feature and add tests')).toBe(false);
    expect(planNamesTestFiles('Build the frontend and update tests')).toBe(false);
    expect(planNamesTestFiles('Write unit tests for the new logic')).toBe(false);
    expect(planNamesTestFiles('Implement src/ui/loading.ts')).toBe(false);
  });

  it('requires a concrete file, not just a directory name', () => {
    expect(planNamesTestFiles('refactor the tests directory')).toBe(false);
  });
});

describe('orphanedModuleWarning (wiring check)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-orphan-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('warns when a task targets an existing route module that nothing imports', () => {
    // Orphaned module: exists but unreferenced.
    fs.mkdirSync(path.join(root, 'src', 'routes'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'routes', 'prompts.ts'), 'export const x = 1;');
    // Live entry that does NOT import it.
    fs.writeFileSync(path.join(root, 'src', 'server.ts'), "import express from 'express';");

    const goal = 'Add POST /api/prompts/:id/duplicate in src/routes/prompts.ts';
    expect(orphanedModuleWarning(goal, root)).toMatch(/orphaned\/dead code/i);
    expect(isFileImported('src/routes/prompts.ts', root)).toBe(false);
  });

  it('does NOT warn when the module is actually imported by the app', () => {
    fs.mkdirSync(path.join(root, 'src', 'routes'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'routes', 'prompts.ts'), 'export const x = 1;');
    fs.writeFileSync(
      path.join(root, 'src', 'server.ts'),
      "import { promptsRouter } from './routes/prompts';\napp.use(promptsRouter);",
    );

    const goal = 'Add POST /api/prompts/:id/duplicate in src/routes/prompts.ts';
    expect(orphanedModuleWarning(goal, root)).toBeNull();
    expect(isFileImported('src/routes/prompts.ts', root)).toBe(true);
  });

  it('does NOT warn for a non-module file (e.g. a source module that is imported)', () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'util.ts'), 'export const y = 2;');
    fs.writeFileSync(path.join(root, 'src', 'server.ts'), "import './util';");
    const goal = 'update src/util.ts validation';
    expect(orphanedModuleWarning(goal, root)).toBeNull();
  });

  it('ignores files that do not exist yet (legitimate new modules)', () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'server.ts'), "import express from 'express';");
    const goal = 'create src/routes/new-feature.ts with a handler';
    expect(orphanedModuleWarning(goal, root)).toBeNull();
  });
});

import { validateTasks } from './orchestrator-validation.js';
import type { DelegationTask } from './orchestrator-types.js';

describe('validateTasks (single-feature goals accept a 1-task plan)', () => {
  const singleTask = (goal: string, role = 'coder'): DelegationTask[] => [
    { goal, role, context: '', dependencies: [] },
  ];

  it('accepts a 1-task plan for a single-feature goal with a multi-bullet rationale', () => {
    // This is the exact shape that used to fail 3x and fall back: a detailed,
    // multi-bullet, >400-char goal that is really ONE cohesive change.
    const goal = [
      'Add a POST /api/prompts/:id/duplicate endpoint:',
      'The frontend has a "Copy" button that copies the template to clipboard,',
      'but there is no API endpoint to duplicate a prompt as a new entry.',
      'The bulk duplicate endpoint exists but not a single-prompt one.',
      'Rationale: UX improvement — users frequently want to clone a prompt.',
    ].join('\n');
    const plan = singleTask('Add POST /api/prompts/:id/duplicate to src/server.ts');
    expect(validateTasks(plan, goal)).toBeNull();
  });

  it('still rejects a 1-task plan when the goal names multiple distinct files', () => {
    const goal = 'Refactor src/foo.ts and src/bar.ts and src/baz.ts into modules';
    const plan = singleTask('update everything');
    expect(validateTasks(plan, goal)).toMatch(/multiple tasks/i);
  });

  it('rejects an empty plan', () => {
    expect(validateTasks([], 'do a thing')).toMatch(/no tasks/i);
  });
});
