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

## Related guardrails

- **Patch syntax verification** — a proposed edit is validated in memory before it is
  applied; only genuine syntax errors or *newly introduced* type errors block the edit.
  Module-resolution noise from freshly-installed packages (e.g. `npm install helmet`
  then importing it) never causes a false revert.
- **Trust layer** — write-without-read guardrail, patch circuit breaker, import/export
  validation, auto-test loop, and large-rewrite annotation. See the
  [Skills](skills.md) and [Sandboxing](sandboxing.md) guides for more.
