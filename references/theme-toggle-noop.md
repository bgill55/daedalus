# /theme No-Op Toggle — Fix Recipe (PR #167)

## Symptom
`/theme light` shows `[OK] Theme set to light and saved.` but the terminal does not
visibly change — especially on a white background where cyan is invisible. The setting
persists (re-applies on launch) but the UI looks broken, which erodes user trust in the
whole CLI.

## Root cause
`src/ui/theme.ts` defined a theme layer, but only THREE cosmetic helpers
(`brand`/`rule`/`accent`) read `ui.theme`. The other ~189 user-facing color calls used
raw `picocolors` (`pc.cyan`/`pc.dim`/`pc.yellow`/`pc.red`/`pc.green`) that **ignore the
theme entirely**. So switching theme recolored only the banner wordmark + box borders.

## Fix
1. Expand `src/ui/theme.ts` with theme-aware helpers that map to contrast-safe colors:
   `info`/`ok`/`warn`/`err`/`dim` (+ `bold`/`user`/`assistant`). In light mode,
   `dim`→`gray` (not ANSI dim, which is invisible on white), `cyan`→`blue`, `yellow`→`red`/`amber`
   (yellow is invisible on white). `ok` stays green in both.
2. Add `isLight()` + `setTheme`/`getTheme` (already present) — `resolved()` picks
   `dark`/`light` from `_theme`/`auto`+`NO_COLOR`.
3. Route the hot paths through the helpers:
   - `src/model.ts` — bracket tokens `[DONE]`/`[CHECK]`/`[RETRY]`/`[WARN]`/`[ERROR]`,
     tool-result summaries, escalation notices. Import `{ dim, info, ok, warn, err }`.
   - `src/formatting.ts` — diffs, status bars, tool-result badges, context warnings.
     Import adds `dim, info, ok, warn, err`.
   - `src/index.ts` / `src/repl.ts` — prompts, status lines, `[AGENT]`/`[SKILL SYNTHESIZED]`.
   - `src/commands/index.ts` — the `/theme` command's own `[OK]`/`Current theme:` output
     uses `ok()`/`info()`.
4. Leave `pc.bold`/`pc.gray`/`pc.whiteBright` as-is (few uses, fine in both themes).
5. Trim unused imports (lint warns on `no-unused-vars`) — only import helpers you use.

## Mechanical swap (per file)
For dominant colors, `replace_all` is safe because these are all user-facing output:
- `pc.dim(` → `dim(`
- `pc.cyan(` → `info(`
- `pc.yellow(` → `warn(`
- `pc.red(` → `err(`
- `pc.green(` → `ok(`

Do NOT swap `pc.gray`/`pc.blue`/`pc.magenta`/`pc.black`/`pc.whiteBright` (semantically
fine in both themes, or used for non-themed emphasis).

## Verification (the part that proves it is NOT a no-op)
`src/ui/theme.test.ts` pins:
- `getTheme`/`setTheme` round-trip; `isLight()` reflects state.
- `dim('x')` and `info('x')` produce **different** ANSI codes in dark vs light
  (the toggle must actually change output).
- Light `dim` carries a gray code (`90`), not the bare dim code (`2`); light `warn`
  carries a red/amber code, not bare yellow.
- Every helper wraps the string in ANSI (`.includes('\x1b[')`) — never returns raw text.
- `ok` stays green (`32`) in both themes.

Run: `npx vitest run src/ui/theme.test.ts`

## Durable lesson
A settings toggle that changes persisted state but not visible output looks broken and
destroys user trust. When you add a UI setting, make the visible effect real, and add a
test that asserts the visible effect differs across states — don't just assert the state
was saved.
