// Centralized UI theme. The default dark palette is tuned for dark terminals;
// "light" swaps the brand/accent colors for ones that stay legible on white
// backgrounds (cyan is near-invisible on white). "auto" currently falls back to
// dark unless NO_COLOR is set (then it uses the light, low-saturation palette).
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

// Brand accent — used for the box title, prompt glyph, and CLI banner wordmark.
export function brand(text: string): string {
  return resolved() === 'light' ? pc.blue(text) : pc.cyan(text);
}

// Rule/border color — used for box-drawing frames.
export function rule(text: string): string {
  return resolved() === 'light' ? pc.gray(text) : pc.cyan(text);
}

// Muted/dim accent for secondary labels next to the brand.
export function accent(text: string): string {
  return resolved() === 'light' ? pc.black(text) : pc.dim(text);
}
