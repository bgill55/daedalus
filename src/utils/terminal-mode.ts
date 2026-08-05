// Terminal mode safety. Several interactive features (eval approval, diff-ui,
// session selector) put stdin into raw mode for single-keypress input. If that
// mode is ever left enabled — an unrecognized key, an exception, or an early
// abort — the user is stuck: backspace prints ^H, Ctrl+C prints ^C, and the
// terminal cannot be closed. These helpers guarantee raw mode is always restored
// on every exit path.
//
// The stream is injectable (defaults to process.stdin) so the logic is unit-testable
// without fighting Node's read-only stdin getters.

import type { Readable } from 'stream';

function getStream(stream?: Readable): Readable {
  return stream ?? process.stdin;
}

export function restoreTerminal(stream?: Readable): void {
  const s = getStream(stream);
  try {
    // Force canonical (cooked) mode so Ctrl+C and line editing work again.
    // setRawMode may be undefined on a non-TTY; the ?. handles that.
    (s as unknown as { setRawMode?: (v: boolean) => void }).setRawMode?.(false);
    if ((s as unknown as { isPaused?: () => boolean }).isPaused?.()) {
      (s as unknown as { resume: () => void }).resume();
    }
  } catch {
    // Best-effort; never throw from a cleanup path.
  }
}

/**
 * Run `onKey` with stdin in raw mode, guaranteeing canonical mode is restored
 * afterward on every path (normal return, thrown error, or unrecognized input).
 * `timeoutMs` (optional) auto-resolves with `timeoutValue` if no key arrives,
 * restoring the terminal first. Returns a `stop()` that also restores + detaches.
 */
export function withRawMode(
  onKey: (key: Buffer) => void,
  timeoutMs?: number,
  timeoutValue?: () => void,
  stream?: Readable,
): () => void {
  const s = getStream(stream);

  if (!(s as unknown as { isTTY?: boolean }).isTTY) {
    s.on('data', onKey);
    return () => s.off('data', onKey);
  }

  (s as unknown as { setRawMode?: (v: boolean) => void }).setRawMode?.(true);
  if ((s as unknown as { isPaused?: () => boolean }).isPaused?.()) {
    (s as unknown as { resume: () => void }).resume();
  }
  s.on('data', onKey);

  const cleanup = () => {
    s.off('data', onKey);
    restoreTerminal(s);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => {
      cleanup();
      timeoutValue?.();
    }, timeoutMs);
    // Don't keep the event loop alive solely for this timer.
    timer.unref?.();
  }

  return () => {
    if (timer) clearTimeout(timer);
    cleanup();
  };
}
