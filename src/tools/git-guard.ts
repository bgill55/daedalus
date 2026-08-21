// Git safety guard — prevents accidental destruction of git tracking data

import { loadConfig } from '../config/index.js';
import { scanStagedDiffForSecrets } from '../security/secret-detector.js';

const GIT_DELETION_COMMANDS = new Set(['rm', 'rmdir', 'rd', 'del', 'remove-item', 'ri']);
const GIT_PROTECTED_PATHS = new Set(['.git', '.git/', '.git\\', '.github', '.github/', '.github\\', '.gitignore']);

export function guardGitPath(resolvedPath: string): string | null {
  const normalized = resolvedPath.replace(/\\/g, '/');
  if (/\/\.git(\/|$)/.test(normalized)) {
    return `Path '${resolvedPath}' is inside the .git/ directory. Direct access to git internals is blocked for safety.`;
  }
  return null;
}

export function guardGitCommand(command: string): string | null {
  const normalized = command.trim().toLowerCase().replace(/\s+/g, ' ');
  const tokens = normalized.split(' ');

  const hasDeletion = tokens.some(t => GIT_DELETION_COMMANDS.has(t));
  if (!hasDeletion) return null;

  for (const token of tokens) {
    const cleaned = token.replace(/^["']/, '').replace(/["']$/, '').replace(/^\.\//, '');
    if (GIT_PROTECTED_PATHS.has(cleaned)) {
      return `Destructive git command blocked: '${command.slice(0, 200)}' would delete '${cleaned}'. Use built-in git tools for safe operations.`;
    }
  }

  return null;
}

// Pre-commit secret-leak guard. Scans the staged diff and blocks a `git commit`
// that would introduce a detected credential. Non-destructive: the commit is
// refused and the working tree is left intact so the user can remove the
// secret and retry. Gated by config.security.preCommitGuard (default true).

export function guardCommitSecrets(command: string): string | null {
  const normalized = command.trim().toLowerCase().replace(/\s+/g, ' ');
  // Match `git commit …` (any flags/args).
  if (!/^git\s+commit\b/.test(normalized)) return null;

  try {
    const config = loadConfig();
    if (config.security?.preCommitGuard === false) return null;
  } catch {
    // default: enabled
  }

  const hits = scanStagedDiffForSecrets(process.cwd());
  if (hits.length === 0) return null;

  const preview = hits.slice(0, 3).map(h => `    ${h}`).join('\n');
  const more = hits.length > 3 ? `\n    …and ${hits.length - 3} more` : '';
  return `Commit blocked: the staged diff contains ${hits.length} credential line(s). Remove the secret(s) (rotate them — they are now compromised) and unstage/re-stage, then commit again.\n${preview}${more}`;
}
