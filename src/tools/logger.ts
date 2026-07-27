import { type DaedalusConfig } from '../config/index.js';
import { validateConfig } from '../config/validate.js';

export interface Logger {
  log(...args: any[]): void;
  error(...args: any[]): void;
  debug(...args: any[]): void;
}

export class ConsoleLogger implements Logger {
  log(...args: any[]): void {
    console.log(...args);
  }

  error(...args: any[]): void {
    console.error(...args);
  }

  debug(...args: any[]): void {
    if (process.env.DAedalus_DEBUG === 'true') {
      console.log('[DEBUG]', ...args);
    }
  }
}

export class SilentLogger implements Logger {
  log(...args: any[]): void {}
  error(...args: any[]): void {}
  debug(...args: any[]): void {}
}

export function createLogger(useColors = true, silent = false): Logger {
  if (silent) {
    return new SilentLogger();
  }
  return new ConsoleLogger();
}

export function configureLogger(config: DaedalusConfig): Logger {
  const { tui = false } = config.ui || {};
  const silent = config.ui?.tui === true;
  return createLogger(!silent, silent);
}
