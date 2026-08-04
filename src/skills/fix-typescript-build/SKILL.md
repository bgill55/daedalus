---
name: fix-typescript-build
description: How to fix a failing `tsc`/`npm run build` (type-check) run in a project, batching fixes into sprints to preserve context.
trigger: fix the build|type errors|typescript errors|tsc errors|build is broken|build fails|npm run build|fix the type errors
safety: instructions
---

# Fixing a TypeScript Build (npm run build / tsc)

The project's `build` script is usually `tsc --noEmit` (a type-check, not a bundle).
A failing build means type errors. Fix them deliberately — do NOT blast the whole
codebase in one giant turn (that burns the context window and makes review impossible).

> Prefer `npm run build` over `npx tsc`. `npx tsc` is not a declared dependency in
> most projects, so `npx` will try to download the `tsc` package from the registry —
> that download is slow and flaky (and can be killed by the terminal's process-group
> isolation on Windows). `npm run build` uses the project's local TypeScript.

## Process
1. Get the full error list first. Run `npm run build` (the project's `build` script).
   Only fall back to `npx tsc --noEmit` if the project has no `build` script. Capture
   EVERY error line. Do not guess — read the actual compiler output.
2. Group errors by file. Most real projects concentrate errors in a few files.
   Present the grouped summary to the user and STOP to confirm scope before editing
   (audit/review etiquette: list findings, then ask which to fix).
3. Once confirmed, FIX FILE-SCOPED. For each target file:
   - Read the file, make the minimal change (rename an unused param to `_x`,
     switch `obj.key` to `obj['key']` when the type is an index signature, etc.).
   - The syntax checker will NOT false-revert a valid edit just because the file
     already had other errors — it diffs pre- vs post-edit diagnostics. So fix one
     file at a time confidently; a valid edit won't be blamed for pre-existing errors.
4. Re-run `npm run build` after each file (or each small batch) to confirm the
   errors for that file are gone. Iterate until the build is clean.
5. Run the test suite (`npm test`) to confirm nothing broke. Report the final state.

## Context-window discipline (important)
- Break the work into SPRINTS: e.g. Sprint 1 = fix `validation.ts`, Sprint 2 =
  fix `server.ts`. After each sprint, the build gets greener and you checkpoint.
- Keep each turn's edits SMALL (one file, few lines). Do NOT dump a 100-line rewrite
  of a file that only needed 3 lines changed — that is what burns context and trips
  the patch tooling.
- Use the `todo` tool to track sprints so progress survives across turns.

## Common error patterns
- `TS6133` unused variable/param → prefix with `_` (respects `noUnusedLocals`/`noUnusedParameters`).
- `TS4111` / `noPropertyAccessFromIndexSignature` → use bracket access `prompt['id']`
  instead of dot access `prompt.id` when the type is `Record<string, unknown>`.
- `exactOptionalPropertyTypes` → don't assign `string | undefined` to an optional
  `id?: string`; assign conditionally (`if (id !== undefined) result.id = id;`).
- `TS2345` type mismatch → fix the actual type, don't cast with `as any` (casts hide
  real bugs and the project lints against `any`).

## Verify
- `npm run build` exits 0.
- `npm test` passes.
- State the final error count (0) and which files you touched.
