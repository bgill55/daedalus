import pc from 'picocolors';

// Single source of truth for how every [TOKEN] message is colored.
//
// Before this module, token color was decided at each call site via raw
// pc.red/pc.yellow/pc.dim calls scattered across 6+ files. That produced
// recurring mis-coloring bugs ([WARN] painted red, [ROLLBACK] painted yellow)
// because nothing enforced the tier. Now the tier is resolved HERE from the
// token, and a contract test (emit.test.ts) greps src/ to guarantee no call
// site can ever paint a token in a color that disagrees with this map.
//
// To change how a token reads, edit TOKEN_TIERS — do not re-color at a call
// site. Unknown tokens default to 'info' (dim) so a new token can never
// accidentally render as an alarm.

export type Tier = 'info' | 'progress' | 'prompt' | 'warn' | 'error';

export const TOKEN_TIERS: Record<string, Tier> = {
  // Routine / expected — dim, never an alarm.
  '[RETRY]': 'info',
  '[SELF-CORRECT]': 'info',
  '[RECOVERED]': 'info',
  '[ROUTE]': 'info',
  '[DONE]': 'info',
  '[CHECK]': 'info',
  '[ROLLBACK]': 'info',
  // Non-fatal problem the user should know about.
  '[WARN]': 'warn',
  // Actual failure requiring attention.
  '[ERROR]': 'error',
  '[FAILED]': 'error',
};

const RENDER: Record<Tier, (s: string) => string> = {
  info: (s) => pc.dim(s),
  progress: (s) => pc.cyan(s),
  prompt: (s) => pc.blue(s),
  warn: (s) => pc.yellow(s),
  error: (s) => pc.red(s),
};

export function tierFor(token: string): Tier {
  return TOKEN_TIERS[token] ?? 'info';
}

// Emit a [TOKEN]-prefixed message. The token's tier (and thus its color) is
// resolved from TOKEN_TIERS; callers never choose a color. `token` may be ''
// for an unprefixed line.
export function emit(token: string, msg = '', tierOverride?: Tier): void {
  const tier = tierOverride ?? tierFor(token);
  const body = token ? `${token} ${msg}` : msg;
  console.log(RENDER[tier](body.trimEnd()));
}

// Like emit but writes a prompt the user must answer (blue, no trailing newline
// so the cursor stays on the same line for their input).
export function emitPrompt(token: string, msg = ''): void {
  const body = token ? `${token} ${msg}` : msg;
  process.stdout.write(pc.blue(body));
}
