import { type DaedalusConfig } from '../config/index.js';

export interface Logger {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

export class ConsoleLogger implements Logger {
  log(...args: unknown[]): void {
    console.log(...args);
  }

  error(...args: unknown[]): void {
    console.error(...args);
  }

  debug(...args: unknown[]): void {
    if (process.env.DAedalus_DEBUG === 'true') {
      console.log('[DEBUG]', ...args);
    }
  }
}

export class SilentLogger implements Logger {
  log(..._args: unknown[]): void {}
  error(..._args: unknown[]): void {}
  debug(..._args: unknown[]): void {}
}

export function createLogger(_useColors = true, silent = false): Logger {
  if (silent) {
    return new SilentLogger();
  }
  return new ConsoleLogger();
}

export function configureLogger(config: DaedalusConfig): Logger {
  const silent = config.ui?.tui === true;
  return createLogger(!silent, silent);
}
