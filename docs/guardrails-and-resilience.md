# Guardrails & Resilience

Daedalus includes several built-in guardrails that keep an autonomous coding agent
from looping on failures or wasting time re-running commands against a broken state.
These are intentional safety behaviors — **not bugs** — and each one tells you exactly
how to recover.

If you see any of the messages below in a session, treat them as guidance, not errors.

## 1. Terminal command circuit breaker

When the same command keeps failing, Daedalus stops retrying it and asks you to
change approach instead of burning the global failure budget on an identical command.

Message:

```
[CIRCUIT BREAKER] command '<prefix>' failed 2 consecutive times. Inspect the terminal error output, fix the arguments, or switch approach instead of retrying the same command.
```

- The breaker tracks the **normalized command prefix** — `cd some-dir` collapses to
  `cd`, while `npm install foo` collapses to `npm install`. That way any failing
  `cd` trips the same breaker, but a passing `npm install` won't trip a failing `npm test`.
- There is a **companion repeat breaker** for no-progress loops: if the *exact same*
  command is re-issued 3 consecutive times (even when it exits successfully — e.g.
  a weak-tier model re-spawning `npm run dev & sleep 3` on a broken project), it
  trips `[CIRCUIT BREAKER] ... has run 3 consecutive times unchanged with no progress.`
  Only consecutive identical commands accumulate; any different command resets the
  counter, so normal edit → test → edit iteration never trips it.
- How to recover: read the stderr in the failed terminal output. A `cd` breaker almost
  always means the directory doesn't exist (typo or wrong cwd) — fix the path. An
  `npm install` breaker means the package name is wrong or the registry is unreachable.
  Once you change the command, the streak resets on the first success.

## 2. Batch short-circuit for failed file edits

When a single turn emits multiple tool calls — for example
`[patch(src/app.ts), terminal("npm test")]` — and the file-mutating call
(`patch` or `write_file`) fails, Daedalus **skips the dependent calls** in that same
batch rather than running them against the broken/incomplete state.

Message on the skipped call:

```
[SKIPPED] Skipped because a prior file-mutation tool in this batch failed.
```

- This applies to subsequent **mutating or build/test** calls (`patch`, `write_file`,
  `terminal`) in the same batch.
- **Read-only tools are never skipped.** `read_file`, `search_files`, `git_status`,
  and `git_diff` still run, so the agent (or you) can inspect the current state and
  recover.
- A failing `terminal` call does **not** block a later `patch` — only a file-mutation
  failure triggers the short-circuit.
- How to recover: fix the failed `patch`/`write_file` first (see the hints in the
  error), then re-run the dependent command explicitly.

## 3. Actionable edit error hints

When a `patch` or `write_file` fails, the error includes a concrete next step instead
of a dead-end message.

**Patch — old string not found:**

```
Old string not found in <path>.
To fix this: call read_file on <path> to fetch the latest text and indentation.
...
Hint: Use read_file to inspect the exact current lines, or use write_file if replacing the entire file.
```

**Write — stale read guard:**

```
[STALE READ] <file> was modified after you last read it. Use read_file to get the current content before patching.
Hint: Call read_file on this file first to update your context before writing.
```

- These guardrails prevent the agent from editing a file based on outdated content
  (e.g. the file changed on disk after the last read, or a previous edit shifted line
  numbers).
- How to recover: call `read_file` on the file to refresh context, then re-issue the
  edit with the current content.

## 4. Self-Healing & Immunity Engine

Daedalus includes a programmatic **Self-Healing & Immunity Engine** that enforces non-negotiable security and correctness boundaries across all agent turns:

1. **Codebase Constitution (`src/config/constitution.ts`)**: Defines root programmatic execution contracts that prompt injections cannot override.
2. **Test Suite Read-Only Lock**: `*.test.ts`, `*.spec.ts`, test runner configs (`vitest.config.*`, `jest.config.*`), and CI workflows (`.github/workflows/*`) are locked as read-only by default during feature runs to prevent agents from modifying or deleting test assertions to force a green build.
3. **Reviewer Diff Immunity Audit Checklist**: The `reviewer` subagent audits all git diffs against:
   - **Type Loosening**: Blocking `any` / `unknown` type downgrades.
   - **Error Swallowing**: Blocking empty `catch {}` blocks or dummy fallbacks.
   - **Assertion Weakening**: Verifying test assertions were not deleted or loosened.
4. **Self-Generated Skill Synthesis (`src/skills/auto-synthesis.ts`)**: Auto-extracts problem-solution recipes from successful complex bug fixes and saves draft playbooks in `.daedalus/skills/drafts/`.

## 5. Graduated patch circuit breaker

When a `patch` or `write_file` keeps failing the in-memory syntax check, Daedalus
escalates **one level at a time** instead of hard-stopping on the first repeat.
This is a steer-first ladder (ported from the Munder Difflin breaker philosophy):
the agent gets a chance to self-correct before being paused.

**Per-file (per-path) breaker** — counts consecutive reverts on the same file:

| Streak | Level | Message |
|--------|-------|---------|
| 2 | **steering** | `Re-read the current file with read_file and reconstruct your patch from the actual content.` |
| 3 | **constrained** | `You keep issuing variations of the same edit — stop. Read the FULL current file…` |
| ≥4 | **stopped** | `Too many reverted patches on this file — pausing to avoid a loop… report the blocker to the user instead of retrying.` |

**Session-wide (global) breaker** — counts *every* syntax-reverting patch in the
session, including ones spread across different files or interleaved with reads
(the per-path streak can miss these). It trips `[PAUSED]` at 3 total reverts and
escalates its wording by level.

**Same-edit loop detector** — the clearest runaway signal: if the *exact same
edit intent* (target file + attempted new content, whitespace-normalized so
near-identical retries collide) is reverted repeatedly, the breaker names the
loop explicitly in the message:

```
[CIRCUIT BREAKER] patch reverted N consecutive times on <file>.
Re-read the current file with read_file and reconstruct your patch from the actual content.
This exact edit has now failed N times in a row — you are looping on the same
broken approach. Stop patching and diagnose the real error before trying again.
```

- A successful patch **clears the streak and the loop signal** for that file, so a
  genuine fix resets the budget (recovery, not permanent lockout).
- How to recover: read the FULL current file, read the compiler error's
  file:line:column, and either (1) produce a written plan via the `todo` tool and a
  small verified patch, or (2) report the blocker to the user instead of looping.

## Related guardrails

- **Patch syntax verification** — a proposed edit is validated in memory before it is
  applied; only genuine syntax errors or *newly introduced* type errors block the edit.
  Module-resolution noise from freshly-installed packages (e.g. `npm install helmet`
  then importing it) never causes a false revert.
- **Trust layer** — write-without-read guardrail, graduated patch circuit breaker
  (see §5 above), import/export validation, auto-test loop, and large-rewrite
  annotation. See the [Skills](skills.md) and [Sandboxing](sandboxing.md) guides
  for more.
