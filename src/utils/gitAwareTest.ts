import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface GitAwareResult {
  modifiedFiles: string[];
  testFiles: string[];
  command: string;
}

/**
 * Inspects git status to find modified source files and map them to relevant test files.
 */
export function getGitAwareTestCommand(cwd: string = process.cwd(), defaultCmd: string = 'npm test'): GitAwareResult {
  let diffOutput: string;
  try {
    diffOutput = execSync('git status --short', { cwd, encoding: 'utf8' });
  } catch {
    return { modifiedFiles: [], testFiles: [], command: defaultCmd };
  }

  const lines = diffOutput
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const modifiedFiles: string[] = [];
  const testFilesSet = new Set<string>();

  for (const line of lines) {
    const parts = line.split(/\s+/);
    const filePath = parts[parts.length - 1];
    if (!filePath) continue;

    modifiedFiles.push(filePath);

    if (filePath.endsWith('.test.ts') || filePath.endsWith('.spec.ts') || filePath.endsWith('.test.js')) {
      testFilesSet.add(filePath);
      continue;
    }

    // Map source file to potential test files
    const ext = path.extname(filePath);
    const baseWithoutExt = filePath.slice(0, -ext.length);

    const candidates = [
      `${baseWithoutExt}.test${ext}`,
      `${baseWithoutExt}.spec${ext}`,
      path.join(path.dirname(filePath), '__tests__', `${path.basename(baseWithoutExt)}.test${ext}`),
    ];

    for (const cand of candidates) {
      if (fs.existsSync(path.join(cwd, cand))) {
        testFilesSet.add(cand);
      }
    }
  }

  const testFiles = Array.from(testFilesSet);

  let command = defaultCmd;
  if (testFiles.length > 0) {
    command = `npx vitest run ${testFiles.join(' ')}`;
  }

  return {
    modifiedFiles,
    testFiles,
    command,
  };
}
