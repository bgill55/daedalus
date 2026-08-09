---
name: grade-and-fix-daedalus
description: How to grade a Daedalus run (or pasted agent transcript), root-cause the failure, and ship the fix to Daedalus CORE as a stacked PR — without modifying the prompt-vault sandbox (read-only grading). Covers recurring bug archetypes (Unicode punctuation patch mismatch, syntax-vs-type mislabel, emoji box misalignment, half-edited files, loop/false-completion guards, and the v3.25.0 pre-flight dependency gate where "every patch reverts" is the prevention gate working, not a broken guardrail). Includes tsx repro and the verified ship flow.
trigger: fix this daedalus bug|why did the patch fail|grade this run|ship the fix|every patch reverts|patch keeps reverting|type error introduced by patch|pre-flight|prevention over revert|daedalus core resilience
safety: instructions
---

# Grade a Daedalus run and ship the core fix (stacked PR)

This skill covers how to grade a Daedalus run (or read a pasted agent transcript),
root-cause the failure, fix it in `src/...`, and ship it as a stacked PR. The
prompt-vault sandbox stays READ-ONLY except for one user-explicit exception.

## Hard rules (standing)

- **Grade, don't fix the sandbox.** `prompt-vault` (+ `social_media_manager`) are
  TEST-ONLY. You READ/GRADE them. You do NOT edit them to "help" Daedalus — that
  defeats the purpose. The ONE exception: a user-explicit "just this once, fix this
  error in the test project" — otherwise the sandbox is passive.
- **Fixes go to Daedalus CORE** (`src/...`), never the sandbox. A graded run that
  exposes a guardrail gap is a core bug; ship it as a PR.
- **Run Daedalus from SOURCE** (`npx tsx src/index.ts`) — the published bin is stale.
  Banner version lagging package.json is cosmetic.
- **`search_files` FAILS on `D:\` paths** (MSYS IO error). Use `terminal` with
  `grep`/`ls`/`git` for anything under D:\.
- **Verify with real tool calls, not theory.** Reproduce the bug by importing the
  actual function and calling it (tsx repro), then prove the fix the same way. Do
  NOT assert "the guard is wrong" without a repro.
- **Skills are auto-discovered** from this `src/skills/` dir (see `src/skills/index.ts`):
  any subdir with a `SKILL.md` whose frontmatter has a `trigger` field is matched
  keyword-style against the user's request and injected into the prompt. Keep the
  `trigger` field populated with pipe-separated phrases.

## Recurring bug archetypes (with exact fixes that shipped)

These are the failure modes seen grading real Daedalus runs. Each maps to a specific
root cause and a specific fix location.

### 1. Patch fails on a Unicode punctuation mismatch (en-dash vs hyphen)
- **Symptom:** agent's `old_string` uses a regular hyphen `-` but the file has an
  en-dash `–` (U+2013) in a comment; Daedalus reports "Old string not found" and the
  edit never lands. Looks like "every patch fails" but it's a 1-char invisible mismatch.
- **Root cause:** `patchFile` (`src/tools/builtin/files.ts`) matches `old_string`
  exactly, and the fuzzy fallback `fuzzyWhitespacePatch` only normalizes whitespace,
  not Unicode punctuation. en-dash/hyphen/smart-quotes/NBSP are invisible to a human
  but distinct bytes.
- **Fix (v3.20.7):** added `normalizeUnicode()` in `patch-utils.ts` mapping en/em-dash
  -> hyphen, smart quotes -> straight, NBSP -> space (all 1:1 so original bytes stay
  intact), folded into `normalizeWhitespace()`; the exact `indexOf` path in `files.ts`
  also tries a unicode-normalized match. Mappings must be 1:1 (no length-changing
  entries like ellipsis `…`->`...`, or the index-slice math breaks).

### 2. "Syntax error introduced by patch" is actually a TYPE error
- **Symptom:** user sees "every one-line change is a syntax error" and is confused.
- **Root cause:** `syntaxCheck` returns diagnostics that include TypeScript type errors
  (TS2304 "Cannot find name 'X'", TS2322, etc.) — genuine TYPE errors, not syntax — but
  `files.ts` wrapped them all with a hardcoded `"Syntax error introduced by patch"`
  prefix. A type error (file parses fine, a downstream reference broke) is NOT a syntax
  error (structurally broken file). The mislabel is what made it look like the model
  couldn't change one line.
- **Fix (v3.20.8):** `syntaxCheck` now self-labels — genuine transpile/parse breaks
  (.js `--check`, the transpile stage) return `"Syntax error introduced by patch —
  reverted."`; tsc type-check failures return `"Type error introduced by patch —
  reverted."`. JSON/YAML keep their specific labels. `formatDiagnostic` now emits the
  FULL file path + line:col (was basename only). `files.ts` no longer prepends the
  misleading prefix.

### 3. Assistant box misaligned / reply spills outside the frame
- **Symptom:** the `⚡ Daedalus` box top/bottom rules don't line up; long body lines
  overflow the right edge.
- **Root cause:** (a) the `⚡` emoji is 2 terminal cells wide but was counted as 1, so
  the top border's dash fill overshot by a column; (b) padding used `string.length`
  instead of display (cell) width, so wide glyphs under/over-padded; (c) curved corners
  (╭╮╰╯) + side rails (│) made the alignment math fragile.
- **Fix (v3.20.9, per user request for "two straight lines, no curves, no side rails"):**
  dropped the curves and rails; both rules + body lines now build from a single
  `displayWidth()`-aware helper (`isWide()` flags CJK/emoji/wide as 2 cells,
  box-drawing stays 1) so everything measures exactly `_lastBoxW` cells. Bottom stat
  line truncates with `…` and reserves 1 cell for it.

### 4. Half-edited file causes repeated "port is undefined" / type errors
- **Symptom:** a prior failed run left the file mid-edit (e.g. signature changed but
  the old `if (port) { app.listen }` block + call site still reference `port`). Any new
  patch to the signature fails type-check; the guard correctly reverts, and the model
  loops on a stale view.
- **Root cause:** NOT a guard bug — the guard correctly refused a build-breaking patch.
  The trap is the half-edited disk state. Fixing it means either (a) re-reading the
  current file and fixing all references together, or (b) the v3.20.5 removed-symbol
  hint, which detects when an introduced TS2304 refers to a symbol the patch deleted
  and says exactly which lines still reference it.
- **Lesson:** when "every patch fails," first `git status`/`git diff` the sandbox to
  check for a half-applied state before assuming the guard is broken.

### 5. Loop / false-completion (the v3.20.4 guards)
- Patch-failure streak breaker: global `context.patchFailureTotal` counter (not
  per-path) trips at 3 -> `[PATCH CIRCUIT BREAKER]` hard stop, forces terminal
  turn-close.
- On-disk completion guard (`detectFalseCompletionOnDisk` in `completion-guard.ts`): if
  the agent claims "fixed X" but `git diff`/disk shows no change, block the turn with a
  SYSTEM WARNING. This is the strict false-report mandate — never accept an empty diff
  "done."

### 6. "Every patch reverts" — it's the PRE-FLIGHT gate working (prevention over revert)
- **Symptom:** user reports "Daedalus can't edit a single file without an error / every
  patch throws a type error and reverts." Looks like the patch tool is broken. It is NOT.
- **Root cause (the helmet incident, v3.25.0):** a patch imports a dependency whose
  types don't resolve in the project — e.g. `helmet@8` installed but `@types/helmet`
  MISSING. The `import helmet from 'helmet'` is therefore untyped (`any`), and under
  `strict` the options object literal (`policy: 'require-corp'`, etc.) generates real TS
  errors that the patch DID introduce. The post-write `syntaxCheck` correctly reverts.
  The agent then re-proposes the SAME broken diff 3x, trips the circuit breaker, and
  sometimes goes on an unrelated side-quest (installing swagger, running bare `tsc`
  which throws its own noise).
- **The real fix is PREVENTION, not revert (standing mandate: "clean code from the
  get-go, resolve issues before patching").** Shipped in v3.25.0 as
  `preflightDependencyCheck()` in `src/tools/builtin/patch-utils.ts`, wired into all
  three write paths in `files.ts` (writeFile, patchFile autoapply-all, patchFile
  interactive) — BEFORE the disk write + post-write `syntaxCheck`. It scans the proposed
  content's import specifiers and resolves each against the project's installed
  `node_modules` + tsconfig (bundled `types`/`typings`, `@types/<pkg>` companion, or a
  `@types/*` pkg). If a dependency has no usable type declarations, the patch is REFUSED
  PRE-WRITE with an actionable fix: `npm install --save-dev @types/<pkg>`, then re-patch.
  It never touches disk, never reverts, never hits the circuit breaker. Also added a
  system-prompt rule "Resolve dependencies BEFORE patching" telling the agent to verify
  types resolve and install missing `@types` as a PREREQUISITE patch first.
- **Grading takeaway:** when a user says "every patch fails," FIRST check whether it's
  the pre-flight gate catching a missing `@types` / missing dep (gate working correctly)
  vs. a genuinely broken guardrail. The pre-flight message names the exact missing
  package + the install command. If the agent is looping 3x into the breaker, the bug is
  in the agent's RECOVERY logic (re-proposing the same broken diff instead of resolving
  the dependency), which is fixed by this gate — not by weakening the revert net.
- **Pinned test cases (in `src/tools/builtin/patch-utils.test.ts`):** resolvable import
  passes; missing-types flagged pre-write with `npm install --save-dev @types/<pkg>`
  hint; `@types` companion resolves; relative imports ignored.

## Step 1 — Reproduce the bug against REAL code (don't theorize)

Write a throwaway `.mts` repro that imports the actual function and calls it. Example
for the en-dash / type-error cases:

```ts
// repro.mts  (run: npx tsx repro.mts ; then rm -f repro.mts)
import { patchFile } from './src/tools/builtin/files.js';
import fs from 'fs';
const file = 'D:/prompt-vault/src/server.ts';
const ctx: any = {
  sessionId: 'r', projectRoot: 'D:/prompt-vault', projectHash: 'x', activeFiles: new Map(),
  agentRole: 'test', abortSignal: new AbortController().signal, autoApplyEdits: 'all',
  patchHistory: [], patchFailureStreak: new Map(), patchFailureTotal: 0,
  sessionReadCache: new Map(),
};
// case: remove param but leave usages -> should report TYPE error, not syntax
const r = await patchFile({ path: file, old_string: 'export function createApp(): Application {',
  new_string: 'export function createApp(): Application {' }, ctx);
console.log((r.error || '').split('\n').slice(0, 4).join('\n'));
```

For the box: capture `console.log` into an array, render a block with a forced
`process.stdout.columns = 80`, and assert `displayWidth(line) === 80 - 6` for both
rules.

**Keep repro files SMALL** — the patch tool streams time out on large payloads. If a
`patch`/`write_file` call is large, split it into multiple smaller calls.

## Step 2 — Fix in core, keep tests green

- Match Daedalus conventions: named exports only, `.js` ESM import extensions, no
  source comments unless necessary, Zod config schemas. Tests co-located as
  `*.test.ts`, vitest.
- Add/update a unit test that pins the exact behavior (e.g. en-dash patch now matches;
  type error labeled "Type error"; box rules exactly `_lastBoxW`). The alignment test
  must assert CELL width (`displayWidth`), not JS `.length` — emoji make `.length`
  wrong.
- Verify locally BEFORE pushing:
  ```bash
  npx tsc --noEmit            # expect 0 errors
  npm run lint                # 0 errors (pre-existing warnings are fine)
  npm test                    # full suite green
  ```

## Step 3 — Ship as a stacked PR (verified flow)

Use the `daedalus-stacked-prs` skill for the mechanics. The proven sequence:

```bash
cd D:/Daedalus
git checkout -b fix/<short-slug>
# edit src/... + tests
npx tsc --noEmit && npm run lint && npm test     # gate locally first
git add <files> && git commit -q -m "fix(tools): <conventional commit, single scope>

<why + what + verification, ~3 short paras>"
git push -u origin fix/<short-slug>
gh pr create --title "fix(tools): <same as commit subject>" --body "<PR body>"
# wait for ALL THREE CI lanes, not just one:
for i in $(seq 1 15); do
  pend=$(gh pr checks <N> 2>&1 | grep -c pending); [ "$pend" -eq 0 ] && break; sleep 12
done
gh pr checks <N>            # confirm Test (ubuntu) + Test (windows) + Test (macos) all pass
gh pr merge <N> --squash
git fetch origin && git checkout main && git reset --hard origin/main
git branch -D fix/<short-slug>; git push origin --delete fix/<short-slug>
# wait for semantic-release, then confirm the tag + npm version:
for i in $(seq 1 20); do
  st=$(gh run list --repo bgill55/daedalus --limit 1 --json status --jq '.[0].status')
  [ "$st" = completed ] && break; sleep 10
done
git fetch --tags origin; npm view daedalus-cli version
```

**CI facts:** `Test (windows-latest)` has been FLAKY in the past (terminal/API tests,
env-only, no model server) — if it's red but the other two lanes are green and the
failure is clearly env-only, re-run that single job. Don't merge on a red core test.
**Release:** `gh pr merge --squash` does NOT auto-trigger release — after merge, the
`release.yml` workflow runs `npx semantic-release` and publishes `daedalus-cli`. Confirm
the new `v3.2X.Y` tag + npm version. Stacked PRs are FREE (all repos) — one stack +
single async merge = one release.

## Pitfalls

- Do NOT modify the prompt-vault sandbox (except the one user-approved exception). Grade
  read-only; ship to core.
- The "Syntax error" label is misleading by design-history — if you see it, check whether
  it's actually a TS type error (the v3.20.8 fix separates them). If a user reports
  "every patch is a syntax error," first check for a half-edited file (archetype 4).
- Unicode dash/quote mismatches are invisible in a paste — verify the actual file bytes
  with `sed -n 'Np' file | cat -A` or `hexdump` before blaming the patch tool.
- `patch`/`write_file` calls have a stream timeout on large payloads — split big edits
  into multiple small calls.
- Box alignment must be measured in CELL width (`displayWidth`), never JS `.length` —
  emoji (⚡) is 2 cells.
- PR title MUST be a valid conventional commit with a single scope or the
  `PR Title (conventional-commits)` CI check fails.
- `git reset --hard` / `git push --delete` are flagged by smart approval — that's
  expected; they're part of the clean-branch flow.
