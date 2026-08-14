import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseSimpleYaml, loadRecipeFromFile, listRecipes } from './index.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Daedalus Recipes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-recipe-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses simple YAML strings with multiline blocks and arrays', () => {
    const yaml = `
name: audit-security
description: Run security audit on project
role: reviewer
skills: [security-audit, typescript-best-practices]
prompt: |
  Inspect src/ and report any type-loosening,
  error-swallowing, or test-weakening issues.
`;
    const parsed = parseSimpleYaml(yaml);
    expect(parsed.name).toBe('audit-security');
    expect(parsed.description).toBe('Run security audit on project');
    expect(parsed.role).toBe('reviewer');
    expect(parsed.skills).toEqual(['security-audit', 'typescript-best-practices']);
    expect(parsed.prompt).toContain('Inspect src/ and report');
  });

  it('loads recipe from YAML file', () => {
    const recipesDir = path.join(tmpDir, '.daedalus', 'recipes');
    fs.mkdirSync(recipesDir, { recursive: true });
    const file = path.join(recipesDir, 'audit.yaml');
    fs.writeFileSync(file, `
name: audit
description: Audit task
prompt: Run full audit
`, 'utf8');

    const loaded = loadRecipeFromFile(file);
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe('audit');
    expect(loaded?.prompt).toBe('Run full audit');
  });

  it('lists recipes across project and global config directories', () => {
    const projRecipes = path.join(tmpDir, '.daedalus', 'recipes');
    const globalRecipes = path.join(tmpDir, 'global-config', 'recipes');
    fs.mkdirSync(projRecipes, { recursive: true });
    fs.mkdirSync(globalRecipes, { recursive: true });

    fs.writeFileSync(path.join(projRecipes, 'p1.yaml'), 'name: p1\ndescription: d1\nprompt: prompt1', 'utf8');
    fs.writeFileSync(path.join(globalRecipes, 'g1.yaml'), 'name: g1\ndescription: d2\nprompt: prompt2', 'utf8');

    const all = listRecipes(tmpDir, path.join(tmpDir, 'global-config'));
    expect(all.length).toBeGreaterThanOrEqual(6);
    const names = all.map(r => r.name);
    expect(names).toContain('p1');
    expect(names).toContain('g1');
    expect(names).toContain('security-audit');
    expect(names).toContain('refactor-clean');
  });
});
