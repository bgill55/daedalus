import readline from 'readline';
import fs from 'fs';
import path from 'path';
import pc from 'picocolors';

// Scoring function for fuzzy search
function scoreFile(filePath: string, query: string): number {
  if (!query) return 0;
  const pathLower = filePath.toLowerCase();
  const queryLower = query.toLowerCase();

  if (pathLower === queryLower) return 1000;
  if (pathLower.startsWith(queryLower)) return 500;
  if (pathLower.includes(queryLower)) return 100 - pathLower.indexOf(queryLower);

  let score = 0;
  let qIdx = 0;
  for (let i = 0; i < pathLower.length && qIdx < queryLower.length; i++) {
    if (pathLower[i] === queryLower[qIdx]) {
      score += 10 - i * 0.1;
      qIdx++;
    }
  }
  if (qIdx === queryLower.length) {
    return score;
  }
  return -1;
}

// Recursively find project files ignoring excluded folders
function getProjectFiles(dir: string, baseDir: string, excludes: Set<string>, fileList: string[] = []): string[] {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(baseDir, fullPath);

      if (excludes.has(entry.name) || excludes.has(relPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        getProjectFiles(fullPath, baseDir, excludes, fileList);
      } else if (entry.isFile()) {
        fileList.push(fullPath); // Store absolute path
      }
    }
  } catch {
    // Ignore unreadable dirs
  }
  return fileList;
}

/**
 * Runs an interactive terminal UI file finder and selector.
 * Returns the updated set of absolute file paths or null if cancelled.
 */
export function runInteractiveFileSelector(
  projectRoot: string,
  excludesList: string[],
  initialActiveFiles: Set<string>
): Promise<Set<string> | null> {
  return new Promise((resolve) => {
    const excludes = new Set(excludesList);
    const allFiles = getProjectFiles(projectRoot, projectRoot, excludes);
    const selectedFiles = new Set(initialActiveFiles);

    let query = '';
    let cursorIndex = 0;
    let matchingFiles: string[] = [...allFiles];
    let linesWritten = 0;

    const render = () => {
      // Clear previously written lines
      if (linesWritten > 0) {
        readline.moveCursor(process.stdout, 0, -linesWritten);
        readline.clearScreenDown(process.stdout);
      }

      const screenLines: string[] = [];
      screenLines.push(`  ${pc.bold(pc.cyan('🔍 Search files:'))} ${pc.white(query)}`);
      screenLines.push(`  ${pc.dim('─'.repeat(50))}`);

      // Filter and score matching files
      if (query) {
        matchingFiles = allFiles
          .map((f) => {
            const rel = path.relative(projectRoot, f);
            return { file: f, score: scoreFile(rel, query) };
          })
          .filter((item) => item.score >= 0)
          .sort((a, b) => b.score - a.score)
          .map((item) => item.file);
      } else {
        matchingFiles = [...allFiles];
      }

      cursorIndex = Math.max(0, Math.min(cursorIndex, matchingFiles.length - 1));

      const maxDisplay = 10;
      const totalMatches = matchingFiles.length;
      const displayFiles = matchingFiles.slice(0, maxDisplay);

      if (displayFiles.length === 0) {
        screenLines.push(`  ${pc.gray('(No matching files)')}`);
      } else {
        displayFiles.forEach((file, idx) => {
          const isSelected = selectedFiles.has(file);
          const isCursor = idx === cursorIndex;
          const rel = path.relative(projectRoot, file);

          const checkbox = isSelected ? pc.green('[x]') : pc.gray('[ ]');
          const cursor = isCursor ? pc.cyan('› ') : '  ';
          const style = isCursor ? pc.bold(pc.yellow(rel)) : pc.white(rel);

          screenLines.push(`  ${cursor}${checkbox} ${style}`);
        });

        if (totalMatches > maxDisplay) {
          screenLines.push(`  ${pc.dim(`... and ${totalMatches - maxDisplay} more files ...`)}`);
        }
      }

      screenLines.push(`  ${pc.dim('─'.repeat(50))}`);
      screenLines.push(`  ${pc.dim('[↑/↓] Navigate  [Space/Tab] Toggle Context  [Enter] Save  [Esc/Ctrl+C] Cancel')}`);

      screenLines.forEach((l) => console.log(l));
      linesWritten = screenLines.length;
    };

    // Initial render
    console.log();
    render();

    const onKeypress = (str: string, key: any) => {
      // Handle Ctrl+C or Escape
      if ((key.ctrl && key.name === 'c') || key.name === 'escape') {
        cleanup();
        console.log(`\n  ${pc.yellow('File selection cancelled.')}\n`);
        resolve(null);
        return;
      }

      // Handle Enter
      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(selectedFiles);
        return;
      }

      // Handle Arrow Up
      if (key.name === 'up') {
        cursorIndex = cursorIndex > 0 ? cursorIndex - 1 : cursorIndex;
        render();
        return;
      }

      // Handle Arrow Down
      if (key.name === 'down') {
        cursorIndex = cursorIndex < matchingFiles.length - 1 ? cursorIndex + 1 : cursorIndex;
        render();
        return;
      }

      // Handle Toggle (Space or Tab)
      if (key.name === 'space' || key.name === 'tab') {
        const file = matchingFiles[cursorIndex];
        if (file) {
          if (selectedFiles.has(file)) {
            selectedFiles.delete(file);
          } else {
            selectedFiles.add(file);
          }
        }
        render();
        return;
      }

      // Handle Backspace
      if (key.name === 'backspace') {
        query = query.slice(0, -1);
        cursorIndex = 0;
        render();
        return;
      }

      // Handle typing (exclude special function keys)
      if (str && str.length === 1 && !key.ctrl && !key.meta) {
        query += str;
        cursorIndex = 0;
        render();
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('keypress', onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      // Overwrite TUI screen area so it is clean
      if (linesWritten > 0) {
        readline.moveCursor(process.stdout, 0, -linesWritten);
        readline.clearScreenDown(process.stdout);
      }
    };

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on('keypress', onKeypress);
  });
}
