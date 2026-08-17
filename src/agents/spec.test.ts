import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  saveSpecContract,
  loadSpecContract,
  formatSpecForPrompt,
  formatSpecForPromptSafe,
  specFileExistenceRatio,
  getSpecJsonPath,
  getSpecMdPath,
  type SpecContract,
} from './spec.js';

describe('SpecFirst Architecture', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-spec-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const mockSpec: SpecContract = {
    featureName: 'User Profile Setting',
    summary: 'Add dark mode toggle to user profile settings',
    interfaces: [
      {
        name: 'UserProfileSettings',
        filePath: 'src/types/user.ts',
        code: 'export interface UserProfileSettings {\n  theme: "light" | "dark";\n  notifications: boolean;\n}',
      },
    ],
    functions: [
      {
        name: 'toggleTheme',
        signature: '(currentTheme: string) => string',
        filePath: 'src/utils/theme.ts',
        description: 'Toggles between light and dark theme mode',
      },
    ],
    testCases: [
      {
        name: 'Verify types file exists',
        description: 'Ensure src/types/user.ts is created with UserProfileSettings',
        assertionType: 'file_exists',
        targetFile: 'src/types/user.ts',
      },
      {
        name: 'Verify export snippet',
        description: 'Ensure UserProfileSettings is exported',
        assertionType: 'export_check',
        expectedOutput: 'UserProfileSettings',
        targetFile: 'src/types/user.ts',
      },
    ],
    verificationCommands: ['npx tsc --noEmit', 'npm test'],
  };

  it('saves and loads spec contract cleanly', () => {
    saveSpecContract(tmpDir, mockSpec);

    expect(fs.existsSync(getSpecJsonPath(tmpDir))).toBe(true);
    expect(fs.existsSync(getSpecMdPath(tmpDir))).toBe(true);

    const loaded = loadSpecContract(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.featureName).toBe('User Profile Setting');
    expect(loaded?.interfaces.length).toBe(1);
    expect(loaded?.testCases.length).toBe(2);
  });

  it('formats spec contract for prompt injection', () => {
    const formatted = formatSpecForPrompt(mockSpec);
    expect(formatted).toContain('=== SPECFIRST FEATURE CONTRACT: User Profile Setting ===');
    expect(formatted).toContain('UserProfileSettings');
    expect(formatted).toContain('toggleTheme');
  });

  describe('spec staleness guard', () => {
    it('reports 0 existence ratio when referenced files do not exist', () => {
      const ratio = specFileExistenceRatio(mockSpec, tmpDir);
      expect(ratio).toBe(0);
    });

    it('reports 1 existence ratio when referenced files exist', () => {
      fs.mkdirSync(path.join(tmpDir, 'src/types'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'src/utils'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/types/user.ts'), 'export interface UserProfileSettings {}');
      fs.writeFileSync(path.join(tmpDir, 'src/utils/theme.ts'), 'export const toggleTheme = () => {}');
      const ratio = specFileExistenceRatio(mockSpec, tmpDir);
      expect(ratio).toBe(1);
    });

    it('labels a stale spec as ASPIRATIONAL and warns not to treat as current state', () => {
      // Regression: an abandoned SpecFirst contract whose referenced files were never
      // created was injected as authoritative context, causing the agent to hallucinate
      // "findings" (missing helmet import, 12 TODOs) that matched the spec's intent.
      const out = formatSpecForPromptSafe(mockSpec, tmpDir);
      expect(out).toContain('ASPIRATIONAL / NOT YET IMPLEMENTED');
      expect(out).toContain('Do NOT treat this as the current code state');
      expect(out).toContain('Discover the actual project state');
    });

    it('does NOT label a spec whose files exist as aspirational', () => {
      fs.mkdirSync(path.join(tmpDir, 'src/types'), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, 'src/utils'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/types/user.ts'), 'export interface UserProfileSettings {}');
      fs.writeFileSync(path.join(tmpDir, 'src/utils/theme.ts'), 'export const toggleTheme = () => {}');
      const out = formatSpecForPromptSafe(mockSpec, tmpDir);
      expect(out).not.toContain('ASPIRATIONAL');
      expect(out).toContain('=== SPECFIRST FEATURE CONTRACT: User Profile Setting ===');
    });
  });
});
