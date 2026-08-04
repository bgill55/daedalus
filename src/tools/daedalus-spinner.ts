// Daedalus custom spinner — a stylish terminal spinner for long operations
// No emoji, all style. Replaces the old "🤖 Thinking..." text.

import process from 'process';

export type SpinnerOptions = {
  text?: string;
  color?: (s: string) => string;
  frames?: string[];
  interval?: number;
  minDurationMs?: number;
};

export class DaedalusSpinner {
  private static stack: DaedalusSpinner[] = [];

  private frames: string[];
  private interval: number;
  private text: string;
  private color: (s: string) => string;
  private timer: NodeJS.Timeout | null = null;
  private frameIndex = 0;
  private running = false;
  private startTime = 0;
  private minDurationMs: number;

  // Default frames — a mini maze/labyrinth effect
  static readonly MAZE_FRAMES = ['◢', '◣', '◤', '◥'];
  static readonly GEAR_FRAMES = ['◐', '◓', '◑', '◒'];
  static readonly PULSE_FRAMES = ['▰▱▱▱▱', '▰▰▱▱▱', '▰▰▰▱▱', '▰▰▰▰▱', '▰▰▰▰▰', '▱▰▰▰▰', '▱▱▰▰▰', '▱▱▱▰▰', '▱▱▱▱▰'];
  static readonly BRIGHT_FRAMES = ['▘', '▝', '▗', '▖'];
  // Smooth braille spinner used for the "thinking" indicator
  static readonly THINKING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  static readonly THINKING_COLOR = (s: string): string => `[36m${s}[0m`; // brand cyan

  constructor(options: SpinnerOptions = {}) {
    this.frames = options.frames ?? DaedalusSpinner.GEAR_FRAMES;
    this.interval = options.interval ?? 100;
    this.text = options.text ?? 'Daedalus thinking';
    this.color = options.color ?? ((s: string) => `[36m${s}[0m`); // default cyan
    this.minDurationMs = options.minDurationMs ?? 0;
  }
  private isTui(): boolean {
    return (globalThis as { isTui?: boolean }).isTui === true;
  }

  private isTTY(): boolean {
    if (this.isTui()) return false;
    return process.stdout.isTTY === true;
  }

  start(text?: string): void {
    if (this.running) return;
    const tui = this.isTui();
    if (!tui && !this.isTTY()) return;
    this.running = true;
    this.startTime = Date.now();
    if (text) this.text = text;
    this.frameIndex = 0;

    const parent = DaedalusSpinner.stack[DaedalusSpinner.stack.length - 1];
    if (parent) parent.pauseRender();
    DaedalusSpinner.stack.push(this);

    if (!tui && DaedalusSpinner.stack.length === 1) {
      process.stdout.write('\x1b[?25l');
    }
    this.renderTick();
    this.timer = setInterval(() => this.renderTick(), this.interval);
  }

  private renderTick(): void {
    if (this.isTui()) {
      this.renderTui();
    } else {
      this.render();
    }
  }

  private pauseRender(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private resumeRender(): void {
    if (!this.running || this.timer) return;
    this.renderTick();
    this.timer = setInterval(() => this.renderTick(), this.interval);
  }

  private render(): void {
    const frame = this.frames[this.frameIndex % this.frames.length];
    const line = ` ${frame} ${this.text}...`;
    process.stdout.write(`\x1b[2K\x1b[0G${this.color(line)}`);
    this.frameIndex++;
  }

  private renderTui(): void {
    const logBox = globalThis.tuiLogBox as { setLabel: (lbl: string) => void } | undefined;
    const screen = globalThis.tuiScreen as { render: () => void } | undefined;
    if (logBox && screen) {
      try {
        const frame = this.frames[this.frameIndex % this.frames.length];
        logBox.setLabel(` CONSOLE (${frame} ${this.text}...) `);
        screen.render();
      } catch {
        // Silently fail if TUI isn't ready or has been destroyed
      }
    }
    this.frameIndex++;
  }

  stop(finalText?: string): void {
    if (!this.running) return;
    this.running = false;
    this.pauseRender();

    const idx = DaedalusSpinner.stack.indexOf(this);
    if (idx >= 0) DaedalusSpinner.stack.splice(idx, 1);

    if (DaedalusSpinner.stack.length > 0) {
      DaedalusSpinner.stack[DaedalusSpinner.stack.length - 1].resumeRender();
      return;
    }

    const elapsed = Date.now() - this.startTime;
    const remaining = this.minDurationMs > 0 ? Math.max(0, this.minDurationMs - elapsed) : 0;
    if (remaining > 0) {
      setTimeout(() => this.clearVisual(finalText), remaining);
    } else {
      this.clearVisual(finalText);
    }
  }

  private clearVisual(finalText?: string): void {
    if (this.isTui()) {
      const logBox = globalThis.tuiLogBox as { setLabel: (lbl: string) => void } | undefined;
      const screen = globalThis.tuiScreen as { render: () => void } | undefined;
      if (logBox && screen) {
        try {
          logBox.setLabel('');
          screen.render();
        } catch {
          // Ignore errors during cleanup
        }
      }
    } else {
      if (!this.isTTY()) return;
      process.stdout.write(`\x1b[2K\x1b[0G`);
      process.stdout.write('\x1b[?25h');
      if (finalText) {
        process.stdout.write(`${finalText}\n`);
      }
    }
  }

  succeed(text?: string): void {
    this.stop(`\x1b[32m\u2714\x1b[0m ${text ?? this.text}`);
  }

  fail(text?: string): void {
    this.stop(`\x1b[31m\u2718\x1b[0m ${text ?? this.text}`);
  }

  updateText(text: string): void {
    this.text = text;
  }
}

// Convenience — create and start in one call
export function createSpinner(text?: string): DaedalusSpinner {
  const spinner = new DaedalusSpinner({ text });
  spinner.start();
  return spinner;
}
