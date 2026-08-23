// Centralized UI theme. The default dark palette is tuned for dark terminals;
// "light" swaps the brand/accent colors for ones that stay legible on white
// backgrounds (cyan is near-invisible on white). "auto" currently falls back to
// dark unless NO_COLOR is set (then it uses the light, low-saturation palette).
//
// Every user-facing color in the CLI should route through these helpers (not raw
// picocolors) so /theme actually recolors the whole interface. Raw pc.* calls
// ignore the theme and are only acceptable for internal/non-visible output.
import pc from 'picocolors';

export type UiTheme = 'dark' | 'light' | 'auto';

let _theme: UiTheme = 'dark';

export function setTheme(t: UiTheme): void {
  if (t === 'dark' || t === 'light' || t === 'auto') _theme = t;
}

export function getTheme(): UiTheme {
  return _theme;
}

function resolved(): 'dark' | 'light' {
  if (_theme === 'light') return 'light';
  if (_theme === 'auto') return process.env.NO_COLOR ? 'light' : 'dark';
  return 'dark';
}

// Whether we are currently rendering in light mode (white background).
export function isLight(): boolean {
  return resolved() === 'light';
}

// ── Theme-aware color helpers ────────────────────────────────────────────────
// Each returns a contrast-safe color for the active theme. These are the single
// source of truth for CLI coloring — route new output through these, not pc.*.

// Brand accent — box titles, prompt glyph, CLI banner wordmark.
export function brand(text: string): string {
  return resolved() === 'light' ? pc.blue(text) : pc.cyan(text);
}

// Rule/border color — box-drawing frames.
export function rule(text: string): string {
  return resolved() === 'light' ? pc.gray(text) : pc.cyan(text);
}

// Muted/dim accent for secondary labels.
export function accent(text: string): string {
  return resolved() === 'light' ? pc.black(text) : pc.dim(text);
}

// Primary info color (status lines, prompts, paths).
export function info(text: string): string {
  return resolved() === 'light' ? pc.blue(text) : pc.cyan(text);
}

// Success / positive.
export function ok(text: string): string {
  return resolved() === 'light' ? pc.green(text) : pc.green(text);
}

// Warnings. Yellow is invisible on white, so light mode uses a darker amber.
export function warn(text: string): string {
  return resolved() === 'light' ? pc.red(text) : pc.yellow(text);
}

// Errors / failures.
export function err(text: string): string {
  return pc.red(text);
}

// Dim/secondary text. pc.dim is near-invisible on white, so light mode uses gray.
export function dim(text: string): string {
  return resolved() === 'light' ? pc.gray(text) : pc.dim(text);
}

// Bold emphasis (theme-independent but routed here for consistency).
export function bold(text: string): string {
  return pc.bold(text);
}

// User turn label in the REPL.
export function user(text: string): string {
  return resolved() === 'light' ? pc.black(text) : pc.cyan(text);
}

// Assistant turn label in the REPL.
export function assistant(text: string): string {
  return resolved() === 'light' ? pc.blue(text) : pc.green(text);
}
