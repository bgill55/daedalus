// Git safety guard — prevents accidental destruction of git tracking data

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
