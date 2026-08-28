import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execAsync = promisify(exec);

export interface MergeResult {
  success: boolean;
  appliedPatches: number;
  error?: string;
}

export async function applyCodeDiffs(diffs: string[], cwd: string): Promise<MergeResult> {
  const validDiffs = diffs.filter((d) => d && d.trim().length > 0);
  if (validDiffs.length === 0) {
    return { success: true, appliedPatches: 0 };
  }

  const combinedDiff = validDiffs.join('\n\n');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'daedalus-patch-'));
  const patchFile = path.join(tempDir, 'merge.patch');

  try {
    await fs.writeFile(patchFile, combinedDiff, 'utf8');
    await execAsync(`git apply "${patchFile}"`, { cwd, windowsHide: true });
    return { success: true, appliedPatches: validDiffs.length };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      appliedPatches: 0,
      error: `Failed to apply git patch: ${errorMsg}`,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
