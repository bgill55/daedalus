import { Logger } from './logger.js';
import * as child from 'child_process';

export class MissingDependencyError extends Error {
  constructor(message: string, public dependency?: string) {
    super(message);
    this.name = 'MissingDependencyError';
  }
}

/**
 * Checks if a command is available in the system PATH
 */
export async function checkCommand(command: string, logger?: Logger): Promise<boolean> {
  try {
    // On Windows, we need to handle .exe extensions
    const platform = process.platform;
    const commandsToTry = [command];
    if (platform === 'win32') {
      commandsToTry.push(`${command}.exe`);
    }

    for (const cmd of commandsToTry) {
      await new Promise((resolve) => {
        child.exec(cmd + ' --version', (err) => {
          resolve(err ? false : true);
        });
      });
    }
    return true;
  } catch {
    if (logger) {
      logger.debug(`Command '${command}' not found or failed version check`);
    }
    return false;
  }
}

/**
 * Ensures a required dependency is available, throwing if not found
 */
export async function ensureCommand(
  command: string,
  logger?: Logger
): Promise<void> {
  const available = await checkCommand(command, logger);
  if (!available) {
    throw new MissingDependencyError(
      `Required command '${command}' is not available in your PATH.\nPlease install ${command} and ensure it's accessible from the command line.`,
      command
    );
  }
}

/**
 * Checks multiple dependencies and returns any that are missing
 */
export async function checkDependencies(
  commands: string[],
  logger?: Logger
): Promise<string[]> {
  const missing: string[] = [];
  for (const cmd of commands) {
    const available = await checkCommand(cmd, logger);
    if (!available) {
      missing.push(cmd);
    }
  }
  return missing;
}

/**
 * Provides a friendly error message when a dependency is missing
 */
export function getDependencyHelp(command: string): string {
  const helpMap: Record<string, string> = {
    git: 'Install Git from https://git-scm.com/',
    node: 'Node.js is required. Download from https://nodejs.org/',
    npm: 'npm comes with Node.js. Install Node.js first.',
  };
  return helpMap[command] || `Please install ${command}.`;
}
