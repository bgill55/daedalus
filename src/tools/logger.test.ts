import { describe, it, expect, vi } from 'vitest';
import { ConsoleLogger, SilentLogger, createLogger, configureLogger } from './logger.js';

describe('Logger', () => {
  it('creates a ConsoleLogger that logs to console', () => {
    const logger = new ConsoleLogger();
    const logSpy = vi.spyOn(console, 'log');
    logger.log('test message');
    expect(logSpy).toHaveBeenCalledWith('test message');
  });

  it('creates a ConsoleLogger that errors to console.error', () => {
    const logger = new ConsoleLogger();
    const errorSpy = vi.spyOn(console, 'error');
    logger.error('test error');
    expect(errorSpy).toHaveBeenCalledWith('test error');
  });

  it('ConsoleLogger debug only logs when DAedalus_DEBUG is true', () => {
    const originalDebug = process.env.DAedalus_DEBUG;
    
    // Test with debug enabled
    process.env.DAedalus_DEBUG = 'true';
    const logger = new ConsoleLogger();
    const debugSpy = vi.spyOn(console, 'log');
    logger.debug('debug message');
    expect(debugSpy).toHaveBeenCalledWith('[DEBUG]', 'debug message');
    
    // Test with debug disabled (restore original)
    process.env.DAedalus_DEBUG = originalDebug;
    debugSpy.mockClear();
    logger.debug('should not appear');
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('creates a SilentLogger that does nothing', () => {
    const logger = new SilentLogger();
    const logSpy = vi.spyOn(console, 'log');
    const errorSpy = vi.spyOn(console, 'error');
    logger.log('this should not be logged');
    logger.error('this should not be logged');
    logger.debug('this should not be logged');
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('createLogger returns SilentLogger when silent=true', () => {
    const logger = createLogger(true, true);
    expect(logger instanceof SilentLogger).toBe(true);
  });

  it('createLogger returns ConsoleLogger when silent=false', () => {
    const logger = createLogger(false, false);
    expect(logger instanceof ConsoleLogger).toBe(true);
  });

  it('configureLogger creates SilentLogger when tui=true', () => {
    const config = { ui: { tui: true } };
    const logger = configureLogger(config as any);
    expect(logger instanceof SilentLogger).toBe(true);
  });

  it('configureLogger creates ConsoleLogger when tui=false', () => {
    const config = { ui: { tui: false } };
    const logger = configureLogger(config as any);
    expect(logger instanceof ConsoleLogger).toBe(true);
  });
});
