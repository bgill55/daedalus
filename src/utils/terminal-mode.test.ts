import { describe, it, expect, vi, afterEach } from 'vitest';
import { restoreTerminal, withRawMode } from './terminal-mode.js';

// Build a fake TTY-ish stream so we can assert raw-mode on/off deterministically
// without touching process.stdin's read-only getters.
type AnyFn = (...args: any[]) => any;
function fakeStream(): any {
  const listeners = new Map<string, AnyFn[]>();
  const s: any = {
    isTTY: true,
    _raw: false,
    setRawMode(v: boolean) { this._raw = v; },
    isPaused() { return false; },
    resume() { return s; },
    on(ev: string, fn: AnyFn) { const a = listeners.get(ev) ?? []; a.push(fn); listeners.set(ev, a); return s; },
    off(ev: string, fn: AnyFn) { const a = listeners.get(ev); if (a) listeners.set(ev, a.filter((f: AnyFn) => f !== fn)); return s; },
    emitData(buf: Buffer) { for (const fn of listeners.get('data') ?? []) fn(buf); },
  };
  return s;
}

describe('terminal-mode', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('restoreTerminal forces raw mode off', () => {
    const s = fakeStream();
    const setRaw = vi.spyOn(s, 'setRawMode');
    s._raw = true;
    restoreTerminal(s);
    expect(setRaw).toHaveBeenCalledWith(false);
  });

  it('withRawMode enables raw mode, invokes handler, restores on stop', () => {
    const s = fakeStream();
    const setRaw = vi.spyOn(s, 'setRawMode');
    const off = vi.spyOn(s, 'off');
    let stopped = false;
    const stop = withRawMode((key: Buffer) => {
      if (key.toString() === 'y') { stop(); stopped = true; }
    }, undefined, undefined, s);
    expect(setRaw).toHaveBeenCalledWith(true);
    s.emitData(Buffer.from('y'));
    expect(stopped).toBe(true);
    expect(setRaw).toHaveBeenLastCalledWith(false);
    expect(off).toHaveBeenCalled();
  });

  it('withRawMode restores terminal on timeout', () => {
    vi.useFakeTimers();
    try {
      const s = fakeStream();
      const setRaw = vi.spyOn(s, 'setRawMode');
      withRawMode(() => {}, 10, undefined, s);
      vi.advanceTimersByTime(20);
      expect(setRaw).toHaveBeenLastCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caller callback that stops on any key restores raw mode (no leak)', () => {
    const s = fakeStream();
    const setRaw = vi.spyOn(s, 'setRawMode');
    const stop = withRawMode((key: Buffer) => {
      if (key.toString() !== '\r' && key.toString() !== '\n') stop();
    }, undefined, undefined, s);
    s.emitData(Buffer.from('x'));
    expect(setRaw).toHaveBeenLastCalledWith(false);
  });
});
