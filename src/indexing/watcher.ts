import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { clearFileIndex, saveFileHash, getFileHash, insertSymbols, insertReferences } from './fts.js';
import { hashContent, parseFile } from './indexer.js';

interface WatcherOptions {
  exclude?: string[];
  extensions?: string[];
}

const DEFAULT_EXCLUDE = ['node_modules', 'dist', 'build', '.git', 'target', 'coverage'];
const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'];

export function watchCodebase(
  db: Database.Database,
  root: string,
  projectHash: string,
  options: WatcherOptions = {}
): { close: () => void } {
  const excludeSet = new Set([...DEFAULT_EXCLUDE, ...(options.exclude || [])]);
  const extensionsSet = new Set([...DEFAULT_EXTENSIONS, ...(options.extensions || [])]);

  const watchers = new Map<string, fs.FSWatcher>();
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  let isClosed = false;

  function isPathExcluded(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, '/');
    const segments = normalized.split('/');
    for (const segment of segments) {
      if (excludeSet.has(segment)) {
        return true;
      }
    }
    if (excludeSet.has(normalized)) {
      return true;
    }
    return false;
  }

  function handleFileChange(relPath: string) {
    if (isClosed) return;
    if (isPathExcluded(relPath)) return;

    const ext = path.extname(relPath).toLowerCase();
    if (!extensionsSet.has(ext)) return;

    const existingTimer = debounceTimers.get(relPath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      debounceTimers.delete(relPath);
      const fullPath = path.join(root, relPath);

      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const hash = hashContent(content);
          const existingHash = getFileHash(db, relPath);
          if (existingHash === hash) return;

          const { symbols, references } = parseFile(content, relPath, projectHash);
          clearFileIndex(db, relPath, projectHash);
          if (symbols.length > 0) insertSymbols(db, symbols);
          if (references.length > 0) insertReferences(db, references);
          saveFileHash(db, relPath, hash);
        } catch {}
      } else {
        try {
          const relPathNormalized = relPath.replace(/\\/g, '/');
          const stmt = db.prepare('SELECT file_path FROM file_hashes');
          const allFiles = stmt.all() as { file_path: string }[];
          for (const f of allFiles) {
            const fNormalized = f.file_path.replace(/\\/g, '/');
            if (fNormalized === relPathNormalized || fNormalized.startsWith(relPathNormalized + '/')) {
              clearFileIndex(db, f.file_path, projectHash);
            }
          }
        } catch {}
      }
    }, 300);

    debounceTimers.set(relPath, timer);
  }

  const isWindowsOrMac = process.platform === 'win32' || process.platform === 'darwin';

  if (isWindowsOrMac) {
    try {
      const watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
        if (isClosed) return;
        if (!filename) return;
        handleFileChange(path.normalize(filename));
      });
      watchers.set(root, watcher);
    } catch {
      setupManualWatcher(root);
    }
  } else {
    setupManualWatcher(root);
  }

  function setupManualWatcher(dirPath: string) {
    const relDirPath = path.relative(root, dirPath);
    if (relDirPath && isPathExcluded(relDirPath)) return;

    try {
      const watcher = fs.watch(dirPath, { recursive: false }, (eventType, filename) => {
        if (isClosed) return;
        if (!filename) return;
        const fullFilePath = path.join(dirPath, filename);
        const relativeFile = path.relative(root, fullFilePath);

        try {
          if (fs.existsSync(fullFilePath)) {
            const stat = fs.statSync(fullFilePath);
            if (stat.isDirectory()) {
              if (eventType === 'rename') {
                setupManualWatcher(fullFilePath);
              }
            }
          }
        } catch {}

        handleFileChange(relativeFile);
      });
      watchers.set(dirPath, watcher);
    } catch {}

    try {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const fullPath = path.join(dirPath, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            setupManualWatcher(fullPath);
          }
        } catch {}
      }
    } catch {}
  }

  return {
    close: () => {
      isClosed = true;
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();

      for (const watcher of watchers.values()) {
        watcher.close();
      }
      watchers.clear();
    }
  };
}
