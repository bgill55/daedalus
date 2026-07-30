import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  saveSpecContract,
  loadSpecContract,
  formatSpecForPrompt,
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
});
