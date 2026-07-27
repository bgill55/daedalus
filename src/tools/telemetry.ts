import { Logger } from './logger.js';

export interface Timer {
  start(): void;
  stop(): number;
  reset(): void;
}

export class ExecutionTimer implements Timer {
  private startTime?: [number, number];
  private elapsed = 0;
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  start(): void {
    this.startTime = process.hrtime();
    this.elapsed = 0;
  }

  stop(): number {
    if (!this.startTime) {
      throw new Error('Timer not started');
    }
    const [seconds, nanoseconds] = process.hrtime(this.startTime);
    const ms = seconds * 1000 + nanoseconds / 1e6;
    this.elapsed = Math.round(ms);
    this.logger.debug(`Timer stopped: ${this.elapsed}ms`);
    return this.elapsed;
  }

  reset(): void {
    this.startTime = undefined;
    this.elapsed = 0;
  }
}

/**
 * Wraps an async function and logs its execution time
 */
export async function timed<T>(
  fn: () => Promise<T>,
  label: string,
  logger: Logger
): Promise<T> {
  const timer = new ExecutionTimer(logger);
  timer.start();
  try {
    return await fn();
  } finally {
    const duration = timer.stop();
    logger.log(`${label}: ${duration}ms`);
  }
}

/**
 * Wraps a synchronous function and logs its execution time
 */
export function timedSync<T>(
  fn: () => T,
  label: string,
  logger: Logger
): T {
  const timer = new ExecutionTimer(logger);
  timer.start();
  try {
    return fn();
  } finally {
    const duration = timer.stop();
    logger.log(`${label}: ${duration}ms`);
  }
}
