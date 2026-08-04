# Bug Fix Report: Windows Terminal Crashes & Build-Fix Robustness

*Published alongside v3.13.1 – v3.13.3. This report documents three robustness
fixes that together took Daedalus from "stalls on a broken build" to "completes a
type-safety refactor with zero diagnostics" on Windows, and the live monitoring
runs that validated them.*

---

## TL;DR

A monitored run of Daedalus against a broken TypeScript project exposed three
weaknesses in how the agent handles build-fix work on Windows:

1. **Terminal tool crashed on Windows** — spawned commands (`npm`/`tsc`/installs)
   died with `Exit code: 3221225794` (`0xC0000142`), blocking every build/test.
   **Root cause of most agent stalls.** Fixed in **v3.13.3** (#42).
2. **Routing demoted build-fix tasks to a weak model** — a complex build-fix was
   reclassified `complex → standard`, landing on a model that ignored instructions
   and hallucinated tools. Fixed in **v3.13.2** (#41).
3. **False-revert of valid edits** — a valid patch to a line that *already* had a
   pre-existing error was reverted as if the patch broke the file. Fixed in
   **v3.13.1** (#40).

After all three fixes, a re-run of the same task completed: the build finished
clean with **0 diagnostics**, sprint-batched per the injected skill guidance, with
**zero terminal crashes**.

---

## 1. Windows Terminal Crash (`0xC0000142`) — v3.13.3 (#42)

### Symptom
When Daedalus was launched non-interactively (a task piped via stdin) and asked to
run a build, the terminal tool repeatedly failed:

```
[AUTO] Tool 'terminal' failed: Exit code: 3221225794
  (no output)
```

Five consecutive terminal calls died this way, after which the agent hit
`[STOP] Repeated tool failures. Stopping to avoid looping.` No build ever ran.

### Root cause
`src/tools/builtin/terminal.ts` spawned the child with **default stdio** (which
inherits the parent's stdin pipe) and **no detached process group**:

```ts
const child = spawn(shell, shellArgs, {
  cwd: workdir,
  env: sanitizeEnv(),
  shell: false,
});
```

On Windows, when the parent's stdin pipe closes (the piped task reaches EOF) or a
console/Ctrl-C signal reaches the parent, the spawned tree (`bash` → `npm` → `tsc`)
is killed with `0xC0000142` / `STATUS_CONTROL_C_EXIT`. The child never produced
output because it died at startup.

We confirmed this was environmental to the agent session (not a command bug): the
exact `spawn('bash.exe', ['-c', 'npm run build'])` succeeded in isolation, and the
real `terminal.execute()` returned success when called directly — only inside the
live agent process did the crash reproduce.

### Fix
```ts
const child = spawn(shell, shellArgs, {
  cwd: workdir,
  env: sanitizeEnv(),
  shell: false,
  // Ignore stdin so a closed parent stdin pipe can't deliver EOF/Ctrl-C into the
  // child. On Windows, run the child in its own detached process group so a
  // console/Ctrl-C signal aimed at the parent does not kill the spawned tree.
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform === 'win32',
});
```

The existing timeout/kill logic (`taskkill /F /T` on Windows, `SIGTERM` on unix)
is unchanged and remains correct.

### Verification
- Real `terminal.execute('npm run build')` / `'npx tsc'` return success with full
  output (repro against the actual tool).
- Regression test added asserting `stdio[0] === 'ignore'`, `stdio[1..2] === 'pipe'`,
  and `detached === (process.platform === 'win32')`.
- Live re-run: **0 terminal crashes** across the whole task.

---

## 2. Routing Floor for Build-Fix Tasks — v3.13.2 (#41)

### Symptom
A complex build-fix task was reclassified `complex → standard` by the trivial-streak
downgrade and landed on `freellmapi--cf-meta-llama-4-scout-17b` (a weak model). That
model ignored the injected skill guidance and hallucinated tool names
(`shell`, `lsp_diagnostics`) that don't exist.

### Root cause
`stepRouting` had no minimum tier. The trivial-streak downgrade
(`trivialTurnStreak >= 3`) could push any `complex` task down to `standard`,
including build-fix / refactor / multi-file work that needs a strong model.

### Fix
Added a routing **floor**:
- `KEEP_ON_INTELLIGENCE_KEYWORDS` + `floorForTask(taskText)` returns `'complex'` for
  build / type-error / tsc / refactor / multi-file / validation phrasing.
- `RoutingState.floor` is enforced in `stepRouting` (clamped **before** the downgrade
  is committed) and **propagated** through the returned state so it holds across
  turns. *(Initial implementation missed the propagation — the floor held only on
  turn 1; fixed before merge.)*

### Verification
- Routing tests: floor holds a build-fix task at `complex` across repeated turns; no
  floor set → normal downgrade still applies.
- Live re-run: `Task classified as complex` → `freellmapi-openai-gpt-oss-120b` on
  **tier 'intelligence'**, with **no** `Reclassified complex → standard` line.

---

## 3. False-Revert of Valid Edits — v3.13.1 (#40)

### Symptom
A valid in-place edit on a line that *already* carried a pre-existing type error was
reverted as "Syntax error introduced by patch."

### Root cause
`syntaxCheck` (in `patch-utils.ts`) flagged *any* error on a touched line, including
pre-existing errors the patch didn't introduce.

### Fix
`syntaxCheck` now accepts the pre-edit content and diffs post-edit diagnostics
against a temp pre-edit compile, so pre-existing errors are excluded. `files.ts`
passes the original content on all patch/write paths.

### Verification
- Regression test: valid edit on a line with a pre-existing error is **not** reverted.
- Genuine broken edits are still caught and recovered via the no-escalate loop.

---

## Live Validation (prompt-vault, Windows)

We ran the same type-safety refactor task against `D:/prompt-vault` before and after
the fixes.

### Before (broken)
- 5+ terminal crashes (`0xC0000142`), build never ran.
- Routing dropped to a weak model; skill guidance ignored.
- Agent stalled: `[STOP] Repeated tool failures.`

### After (v3.13.3, all fixes)
- **0** terminal crashes.
- Routing stayed on `intelligence` (gpt-oss-120b) the entire task.
- `fix-typescript-build` skill injected and **followed**: agent adopted SPRINT
  structure with TODO progress (`[TODO] Progress: 2/4 completed | Active: SPRINT 3:
  ...`), re-ran the build after each sprint, and made careful non-destructive edits.
- One genuine bad patch was caught → `[RECOVERED] patch succeeded after 1 prior
  failure(s)` → all 4 sprints completed.
- Final: `Build passes cleanly. 0 diagnostics remain after the refactor.` (confirmed
  by a read-only `npm run build`, exit 0).

### One residual observation
The agent occasionally runs `npx tsc` instead of the project's `npm run build`. `npx`
then warns it will download `tsc` (not a declared dependency). This is agent
behavior, not a tool bug — and with the terminal fix in place it no longer crashes.
A skill- or prompt-level nudge toward `npm run build` would tighten this further.

---

## Releases

| Version | Fix | PR |
| --- | --- | --- |
| v3.13.1 | False-revert of valid edits | [#40](https://github.com/bgill55/daedalus/pull/40) |
| v3.13.2 | Routing floor for build-fix tasks | [#41](https://github.com/bgill55/daedalus/pull/41) |
| v3.13.3 | Windows terminal crash (`0xC0000142`) | [#42](https://github.com/bgill55/daedalus/pull/42) |
