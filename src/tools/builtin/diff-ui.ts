// Interactive visual diff approval UI
// Shows unified diff with colors and prompts for y/n/a/s/e/d

import readline from 'readline';
import pc from 'picocolors';
import * as diff from 'diff';
import { ToolContext } from '../../types.js';

export type DiffDecision = 'yes' | 'no' | 'all' | 'skip' | 'diff' | 'edit' | 'chunks';

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
  process.stdout.write(pc.bold(`\nApply this masterpiece? [y]es / [n]o / [c]hunks / [a]ll / [s]kip / [d]iff / [e]dit: `));

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
        case 'c': decision = 'chunks'; break;
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

export function formatHunk(
  hunk: diff.Hunk,
  index: number,
  total: number,
  filePath: string
): string {
  let output = '';
  const titleText = ` Hunk ${index + 1} of ${total} for ${filePath} `;
  const borderW = Math.max(78, titleText.length);
  const paddedTitle = titleText.padEnd(borderW);
  output += pc.bold(pc.cyan(`\n\u250c${'\u2500'.repeat(borderW)}\u2510\n`));
  output += pc.bold(pc.cyan(`\u2502${paddedTitle}\u2502\n`));
  output += pc.bold(pc.cyan(`\u251c${'\u2500'.repeat(borderW)}\u2524\n`));

  let lineNumOld = hunk.oldStart;
  let lineNumNew = hunk.newStart;

  for (const line of hunk.lines) {
    if (line.startsWith('\\')) {
      output += pc.bold(pc.yellow(`\u2502   ${line}\n`));
      continue;
    }
    if (line.startsWith('+')) {
      output += pc.green(`\u2502 + ${String(lineNumNew).padStart(4)} | ${line.substring(1)}\n`);
      lineNumNew++;
    } else if (line.startsWith('-')) {
      output += pc.red(`\u2502 - ${String(lineNumOld).padStart(4)} | ${line.substring(1)}\n`);
      lineNumOld++;
    } else {
      output += pc.gray(`\u2502   ${String(lineNumOld).padStart(4)} | ${line.substring(1)}\n`);
      lineNumOld++;
      lineNumNew++;
    }
  }

  output += pc.bold(pc.cyan(`\u2514${'\u2500'.repeat(borderW)}\u2518\n`));
  return output;
}

export async function promptHunkDecision(
  hunk: diff.Hunk,
  index: number,
  total: number,
  filePath: string
): Promise<'yes' | 'no' | 'all' | 'quit'> {
  if (!process.stdin.isTTY) {
    return 'no';
  }

  const hunkOutput = formatHunk(hunk, index, total, filePath);
  process.stdout.write(hunkOutput);
  process.stdout.write(pc.bold(`Stage this hunk? [y]es / [n]o / [a]ll remaining / [q]uit: `));

  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(true);
    }

    const onKey = (key: Buffer) => {
      const char = key.toString().toLowerCase();
      let choice: 'yes' | 'no' | 'all' | 'quit' | null = null;

      switch (char) {
        case 'y': choice = 'yes'; break;
        case 'n': choice = 'no'; break;
        case 'a': choice = 'all'; break;
        case 'q': choice = 'quit'; break;
        case '\u0003': // Ctrl+C
          process.stdout.write('\n');
          cleanup();
          resolve('quit');
          return;
      }

      if (choice) {
        process.stdout.write(`${choice.toUpperCase()}\n`);
        cleanup();
        resolve(choice);
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

export async function reviewChunksWorkflow(
  oldContent: string,
  newContent: string,
  filePath: string,
  prompter: typeof promptHunkDecision = promptHunkDecision
): Promise<string> {
  const patch = diff.structuredPatch(filePath, filePath, oldContent, newContent);
  const hunks = patch.hunks;

  if (hunks.length === 0) {
    process.stdout.write(pc.yellow('No hunks found to review.\n'));
    return oldContent;
  }

  const oldLines = oldContent.split('\n');
  const outputLines: string[] = [];
  let currentLine = 1;
  let autoApplyRemaining = false;
  let quitRemaining = false;

  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i];

    while (currentLine < hunk.oldStart) {
      outputLines.push(oldLines[currentLine - 1]);
      currentLine++;
    }

    let accept = false;
    if (autoApplyRemaining) {
      accept = true;
    } else if (quitRemaining) {
      accept = false;
    } else {
      const choice = await prompter(hunk, i, hunks.length, filePath);
      if (choice === 'yes') {
        accept = true;
      } else if (choice === 'all') {
        accept = true;
        autoApplyRemaining = true;
      } else if (choice === 'quit') {
        accept = false;
        quitRemaining = true;
      } else {
        accept = false;
      }
    }

    if (accept) {
      for (const line of hunk.lines) {
        if (line.startsWith('\\')) continue;
        if (!line.startsWith('-')) {
          outputLines.push(line.substring(1));
        }
      }
    } else {
      for (const line of hunk.lines) {
        if (line.startsWith('\\')) continue;
        if (!line.startsWith('+')) {
          outputLines.push(line.substring(1));
        }
      }
    }

    currentLine += hunk.oldLines;
  }

  while (currentLine <= oldLines.length) {
    outputLines.push(oldLines[currentLine - 1]);
    currentLine++;
  }

  return outputLines.join('\n');
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

      if (result.decision === 'chunks') {
        currentContent = await reviewChunksWorkflow(
          options.oldContent,
          currentContent,
          options.filePath
        );
        process.stdout.write(pc.green('\n\u2713 Chunk review complete. Showing updated diff...\n'));
        continue;
      }

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