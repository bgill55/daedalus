# Skills

*Skills are packaged playbooks the agent follows using its existing tools. They
are **instructions, not code** — a skill is never auto-executed. When your request
matches a skill's trigger, Daedalus injects the playbook into the system prompt so
the agent applies it deliberately.*

---

## What a skill is

A skill is a folder containing a `SKILL.md` file with YAML frontmatter plus a body
of instructions:

```markdown
---
name: fix-typescript-build
description: How to fix a failing tsc / npm run build run, batching fixes into sprints.
trigger: fix the build|type errors|typescript errors|tsc errors|build is broken|build fails|npm run build|fix the type errors
safety: instructions
---

# Fixing a TypeScript Build (npm run build / tsc)
...steps the agent should follow...
```

- `name` — unique skill id (also the folder name if `name` is omitted).
- `description` — what the skill is for.
- `trigger` — `|`-separated phrases. The skill activates when **any** phrase appears
  in the user request (substring match, case-insensitive).
- `safety` — `instructions` (default, surfaced to the agent) or `executable` (ignored
  in the current load-only implementation).

When a skill matches, Daedalus prepends an `## ACTIVE SKILLS` section to the system
prompt containing the matched playbook(s). The agent then follows them with its
normal tools.

---

## Where skills live (trusted locations only)

Skills are discovered from **two trusted directories only**:

| Location | Purpose |
| --- | --- |
| `<daedalus>/src/skills/` (shipped) | Skills bundled with Daedalus. |
| `~/.daedalus/skills/` (user) | Your own skills, per machine. |

> **Security:** Skills are **never** loaded from the project you are working in. A
> repo being edited cannot ship a `SKILL.md` that hijacks the agent — only the
> shipped dir and your own `~/.daedalus/skills` are trusted. This is intentional.

Discovery is cached for the process. If you add or change a skill while Daedalus is
running, restart the session.

---

## Built-in skills

Daedalus ships with two skills:

### `fix-typescript-build`
Trigger phrases: `fix the build`, `type errors`, `typescript errors`, `tsc errors`,
`build is broken`, `build fails`, `npm run build`, `fix the type errors`.

Guides the agent to capture the full `npm run build` error list, group errors by
file, fix **file-scoped** (the syntax checker won't false-revert a valid edit on a
line that already had errors), re-run the build after each small batch, and break
the work into **sprints** to preserve context. Includes a table of common `TSxxxx`
patterns (`TS6133`, `TS4111`, `exactOptionalPropertyTypes`, `TS2345`).

### `add-slash-command`
Trigger phrases: `add a command`, `new /command`, `create a slash command`,
`add /command`, `/command`.

Documents how to add a slash command to `src/commands/` — including the
`docs-sync` step (`scripts/sync-docs.ts` + `src/docs.test.ts`) that breaks CI if
skipped. Useful when extending Daedalus itself.

---

## Usage examples

### Example 1 — build-fix with sprint batching
Request:

> The TypeScript build is broken. Please fix the type errors, batching the work into
> small sprints.

The `fix-typescript-build` skill matches (`build is broken` + `type errors`) and is
injected. Observed behavior: the agent lists a `[TODO] Progress: 0/4` sprint plan,
edits one file at a time, re-runs `npm run build` after each sprint, and reports the
final `0 diagnostics` count. *(Validated on Windows — see the bug-fix report.)*

### Example 2 — no match (skill stays out of the way)
Request:

> summarize this README for me

No trigger phrase matches, so no skill is injected and the agent handles it normally.

### Example 3 — add your own skill
Create `~/.daedalus/skills/my-conventions/SKILL.md`:

```markdown
---
name: my-conventions
description: Project-specific coding conventions for the Acme repo.
trigger: acme|follow the acme style|acme conventions
safety: instructions
---

# Acme Conventions
- Always use repository-scoped `fetch` wrappers, never raw `fetch`.
- Prefer named exports; no default exports.
- Run `npm run lint` before reporting done.
```

Next session, any request mentioning `acme` will inject these conventions.

---

## Authoring a skill

1. Create a folder under `~/.daedalus/skills/<your-skill>/` (or contribute a shipped
   one under `src/skills/<your-skill>/`).
2. Add `SKILL.md` with the frontmatter above and a clear, step-by-step body.
3. Keep triggers specific enough to avoid false matches, broad enough to catch real
   requests. Separate multiple phrases with `|`.
4. Restart Daedalus (discovery is cached) and test by issuing a matching request.

Tips:
- Write the body as **instructions the agent executes with its tools** — do not embed
  code to be run.
- Use `safety: instructions` (the default). `executable` skills are not surfaced by
  the current load-only implementation.
- Reference real commands and file paths; the agent will verify against the actual
  project.

---

## Shipping skill changes (stacked PRs)

Multiple skill/docs changes ship as **one coordinated release** using GitHub
[stacked pull requests](https://github.blog/changelog/2026-07-30-stacked-pull-requests-are-now-in-public-preview/)
(free, public preview). Stack the related branches instead of opening N separate PRs
— merging the top of the stack lands every layer below it at once, so end users get
a single update rather than one per change.

```bash
gh extension install github/gh-stack
gh stack init fix/skill-a fix/skill-b fix/skill-c   # base → layered branches
# ...edit + commit on each branch...
gh stack submit                                  # opens the stack of PRs
# merge the top PR to land the whole stack in one release
```

This matters because Daedalus's Release workflow does not auto-trigger on squash-merge,
so each standalone PR currently needs a manual `gh workflow run release.yml`. A stack
collapses that to one release per batch.

---

## How it's wired (implementation notes)

- `src/skills/index.ts` — `discoverSkills()` scans the two trusted dirs;
  `matchSkills(request)` does case-insensitive substring trigger matching (only
  `instructions` skills); `getSkillsSection(request)` returns the `## ACTIVE SKILLS`
  block (or `''` when nothing matches).
- The section is injected per turn: `src/repl.ts` rebuilds `messages[0]` with
  `getSystemPromptWithMemory(activePrompt)` before each model call, so the right
  skill is active for the current request.
- Discovery result is cached; restart the session after adding/changing skills.

See the [Bug Fix Report: Windows Terminal Crashes & Build-Fix Robustness](windows-terminal-crash-fix.md)
for how the `fix-typescript-build` skill behaves end-to-end after the v3.13.x
robustness fixes.
