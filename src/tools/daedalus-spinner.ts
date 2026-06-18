// Daedalus custom spinner — a stylish terminal spinner for long operations
// No emoji, all style. Replaces the old "🤖 Thinking..." text.

import process from 'process';

export type SpinnerOptions = {
  text?: string;
  color?: (s: string) => string;
  frames?: string[];
  interval?: number;
};

export class DaedalusSpinner {
  private frames: string[];
  private interval: number;
  private text: string;
  private color: (s: string) => string;
  private timer: NodeJS.Timeout | null = null;
  private frameIndex = 0;
  private running = false;

  // Default frames — a mini maze/labyrinth effect
  static readonly MAZE_FRAMES = ['◢', '◣', '◤', '◥'];
  static readonly GEAR_FRAMES = ['◐', '◓', '◑', '◒'];
  static readonly PULSE_FRAMES = ['▰▱▱▱▱', '▰▰▱▱▱', '▰▰▰▱▱', '▰▰▰▰▱', '▰▰▰▰▰', '▱▰▰▰▰', '▱▱▰▰▰', '▱▱▱▰▰', '▱▱▱▱▰'];
  static readonly BRIGHT_FRAMES = ['▘', '▝', '▗', '▖'];

  constructor(options: SpinnerOptions = {}) {
    this.frames = options.frames ?? DaedalusSpinner.GEAR_FRAMES;
    this.interval = options.interval ?? 100;
    this.text = options.text ?? 'Daedalus thinking';
    this.color = options.color ?? ((s: string) => `\x1b[36m${s}\x1b[0m`); // default cyan
  }

  private isTTY(): boolean {
    return process.stdout.isTTY === true;
  }

  start(text?: string): void {
    if (this.running) return;
    if (!this.isTTY()) return;
    this.running = true;
    if (text) this.text = text;
    this.frameIndex = 0;
    process.stdout.write('\x1b[?25l');
    this.render();
    this.timer = setInterval(() => this.render(), this.interval);
  }

  private render(): void {
    const frame = this.frames[this.frameIndex % this.frames.length];
    const line = ` ${frame} ${this.text}...`;
    process.stdout.write(`\x1b[2K\x1b[0G${this.color(line)}`);
    this.frameIndex++;
  }

  stop(finalText?: string): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.isTTY()) return;
    process.stdout.write(`\x1b[2K\x1b[0G`);
    process.stdout.write('\x1b[?25h');
    if (finalText) {
      process.stdout.write(`${finalText}\n`);
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
