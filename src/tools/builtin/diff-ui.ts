// Interactive visual diff approval UI
// Shows unified diff with colors and prompts for y/n/a/s/e/d

import readline from 'readline';
import pc from 'picocolors';
import * as diff from 'diff';
import { ToolContext } from '../../types.js';

export type DiffDecision = 'yes' | 'no' | 'all' | 'skip' | 'diff' | 'edit';

export interface DiffOptions {
  filePath: string;
  oldContent: string;
  newContent: string;
  autoApply?: 'prompt' | 'all' | 'skip';  // Global setting
}

export interface DiffResult {
  decision: DiffDecision;
  editedContent?: string;  // If user chose 'edit'
}

/** Generate a colored unified diff */
export function generateUnifiedDiff(
  oldContent: string,
  newContent: string,
  filePath: string
): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const patches = diff.diffLines(oldContent, newContent);

  let output = '';
  const titleText = ` Proposed change to ${filePath.padEnd(55)} `;
  const borderW = titleText.length;
  output += pc.bold(pc.cyan(`\n\u250c${'\u2500'.repeat(borderW)}\u2510\n`));
  output += pc.bold(pc.cyan(`\u2502${titleText}\u2502\n`));
  output += pc.bold(pc.cyan(`\u251c${'\u2500'.repeat(borderW)}\u2524\n`));

  let lineNumOld = 1;
  let lineNumNew = 1;

  for (const part of patches) {
    if (part.added && part.removed) {
      // This shouldn't happen with diffLines, but handle anyway
    } else if (part.added) {
      const addedLines = part.value.split('\n');
      for (const line of addedLines) {
        if (line === '' && addedLines.indexOf(line) === addedLines.length - 1) continue;
        output += pc.green(`\u2502 + ${String(lineNumNew).padStart(4)} | ${line}\n`);
        lineNumNew++;
      }
    } else if (part.removed) {
      const removedLines = part.value.split('\n');
      for (const line of removedLines) {
        if (line === '' && removedLines.indexOf(line) === removedLines.length - 1) continue;
        output += pc.red(`\u2502 - ${String(lineNumOld).padStart(4)} | ${line}\n`);
        lineNumOld++;
      }
    } else {
      // Unchanged context
      const contextLines = part.value.split('\n');
      for (const line of contextLines) {
        if (line === '' && contextLines.indexOf(line) === contextLines.length - 1) continue;
        output += pc.gray(`\u2502   ${String(lineNumOld).padStart(4)} | ${line}\n`);
        lineNumOld++;
        lineNumNew++;
      }
    }
  }

  output += pc.bold(pc.cyan(`\u2514${'\u2500'.repeat(borderW)}\u2518\n`));
  return output;
}

/** Show compact diff summary (for 'diff' option) */
export function generateDiffSummary(
  oldContent: string,
  newContent: string
): string {
  const patches = diff.diffLines(oldContent, newContent);
  let added = 0;
  let removed = 0;

  for (const part of patches) {
    if (part.added) {
      added += part.value.split('\n').filter(l => l).length;
    } else if (part.removed) {
      removed += part.value.split('\n').filter(l => l).length;
    }
  }

  return `Lines: ${pc.green(`+${added}`)} ${pc.red(`-${removed}`)}`;
}

export async function promptDiffDecision(
  options: DiffOptions,
  globalAutoApply: 'prompt' | 'all' | 'skip' = 'prompt',
  context?: ToolContext
): Promise<DiffResult> {
  // Check global auto-apply setting
  if (globalAutoApply === 'all') {
    return { decision: 'yes' };
  }
  if (globalAutoApply === 'skip') {
    return { decision: 'skip' };
  }

  // Non-interactive fallback: skip to avoid hanging
  if (!process.stdin.isTTY) {
    return { decision: 'skip' };
  }

  // Show the diff
  const diffOutput = generateUnifiedDiff(options.oldContent, options.newContent, options.filePath);
  process.stdout.write(diffOutput);
  process.stdout.write(pc.bold(`\nApply this masterpiece? [y]es / [n]o / [a]ll / [s]kip / [d]iff / [e]dit: `));

  return new Promise((resolve) => {
    // Raw mode for single keypress
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(true);
    }

    const onKey = (key: Buffer) => {
      const char = key.toString().toLowerCase();
      let decision: DiffDecision | null = null;

      switch (char) {
        case 'y': decision = 'yes'; break;
        case 'n': decision = 'no'; break;
        case 'a': decision = 'all'; break;
        case 's': decision = 'skip'; break;
        case 'd': decision = 'diff'; break;
        case 'e': decision = 'edit'; break;
        case '\u0003': // Ctrl+C
          process.stdout.write('\n');
          cleanup();
          resolve({ decision: 'no' });
          return;
      }

      if (decision) {
        process.stdout.write(`${char.toUpperCase()}\n`);
        cleanup();
        resolve({ decision });
      }
    };

    process.stdin.on('data', onKey);

    function cleanup() {
      process.stdin.off('data', onKey);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode?.(false);
      }
    }
  });
}

/** Open editor for manual editing */
export async function openEditor(content: string): Promise<string> {
  const os = await import('os');
  const fs = await import('fs');
  const path = await import('path');
  const { spawn } = await import('child_process');

  // Create temp file
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `daedalus-edit-${Date.now()}.tmp`);
  fs.writeFileSync(tmpFile, content, 'utf8');

  // Determine editor
  const editor = process.env.EDITOR || process.env.VISUAL || (process.platform === 'win32' ? 'notepad' : 'nano');

  return new Promise((resolve, reject) => {
    const child = spawn(editor, [tmpFile], {
      stdio: 'inherit',
      shell: false,
    });

    child.on('close', (code) => {
      if (code === 0) {
        try {
          const edited = fs.readFileSync(tmpFile, 'utf8');
          fs.unlinkSync(tmpFile);
          resolve(edited);
        } catch (err) {
          reject(err);
        }
      } else {
        fs.unlinkSync(tmpFile);
        reject(new Error(`Editor exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      fs.unlinkSync(tmpFile);
      reject(err);
    });
  });
}

export async function runDiffWorkflow(
  options: DiffOptions,
  globalAutoApply: 'prompt' | 'all' | 'skip' = 'prompt',
  context?: ToolContext
): Promise<DiffResult> {
  let currentContent = options.newContent;

  try {
    context?.pauseSpinner?.();

    while (true) {
      const result = await promptDiffDecision(
        { ...options, newContent: currentContent },
        globalAutoApply,
        context
      );

      if (result.decision === 'edit') {
        try {
          const edited = await openEditor(currentContent);
          if (edited !== currentContent) {
            currentContent = edited;
            process.stdout.write(pc.green('\u2713 Edit saved. Showing updated diff...\n'));
            continue; // Re-show diff with edited content
          }
          // No change, re-prompt
          continue;
        } catch (err: any) {
          process.stdout.write(pc.red(`\u26a0 Editor error: ${err.message}\n`));
          continue;
        }
      }

      if (result.decision === 'diff') {
        // Show detailed diff summary
        process.stdout.write(`\n${generateDiffSummary(options.oldContent, currentContent)}\n`);
        continue; // Re-prompt
      }

      // For yes/no/all/skip, return with potentially edited content
      return {
        decision: result.decision,
        editedContent: currentContent !== options.newContent ? currentContent : undefined,
      };
    }
  } finally {
    context?.resumeSpinner?.();
  }
}