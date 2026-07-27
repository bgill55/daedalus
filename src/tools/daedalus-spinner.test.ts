import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DaedalusSpinner } from './daedalus-spinner.js';

describe('DaedalusSpinner', () => {
  let spinner: DaedalusSpinner;
  let stdoutWriteSpy: any;

  beforeEach(() => {
    // Mock stdout.write and isTTY
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      writable: true,
    });

    // Reset global state
    (globalThis as any).isTui = false;
    (globalThis as any).tuiLogBox = undefined;
    (globalThis as any).tuiScreen = undefined;

    spinner = new DaedalusSpinner();
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
  });

  it('creates a spinner with default options', () => {
    expect(spinner).toBeInstanceOf(DaedalusSpinner);
    expect(spinner).toHaveProperty('frames', DaedalusSpinner.GEAR_FRAMES);
    expect(spinner).toHaveProperty('interval', 100);
    expect(spinner).toHaveProperty('text', 'Daedalus thinking');
  });

  it('creates a spinner with custom options', () => {
    const customSpinner = new DaedalusSpinner({
      text: 'Custom text',
      frames: DaedalusSpinner.MAZE_FRAMES,
      interval: 200,
    });

    expect(customSpinner).toHaveProperty('text', 'Custom text');
    expect(customSpinner).toHaveProperty('frames', DaedalusSpinner.MAZE_FRAMES);
    expect(customSpinner).toHaveProperty('interval', 200);
  });

  it('starts the spinner', () => {
    spinner.start();
    expect(spinner).toHaveProperty('running', true);
  });

  it('does not start if already running', () => {
    spinner.start();
    const initialRunning = spinner['running'];
    spinner.start();
    expect(spinner).toHaveProperty('running', initialRunning);
  });

  it('stops the spinner', () => {
    spinner.start();
    spinner.stop();
    expect(spinner).toHaveProperty('running', false);
  });

  it('succeeds and stops with success message', () => {
    spinner.start();
    spinner.succeed('Operation completed');
    expect(spinner).toHaveProperty('running', false);
    expect(stdoutWriteSpy).toHaveBeenCalledWith('\x1b[32m\u2714\x1b[0m Operation completed\n');
  });

  it('fails and stops with error message', () => {
    spinner.start();
    spinner.fail('Operation failed');
    expect(spinner).toHaveProperty('running', false);
    expect(stdoutWriteSpy).toHaveBeenCalledWith('\x1b[31m\u2718\x1b[0m Operation failed\n');
  });

  it('updates text correctly', () => {
    spinner.updateText('New text');
    expect(spinner).toHaveProperty('text', 'New text');
  });

  it('handles TUI mode correctly', () => {
    (globalThis as any).isTui = true;
    spinner.start();
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });
});
