# RFC: `/scan-ai-repos` — AI-repo pattern scanner built into Daedalus

## Vision
A Daedalus built-in tool that scans GitHub's top AI repositories for reusable
patterns/architecture, diffs them against the **current project** (whatever
`projectRoot` Daedalus is pointed at), and produces file-specific improvement
proposals — optionally opening a GitHub issue against that project's repo.

Run from `D:/Daedalus` → Daedalus self-analyzes. Run from a user's project →
it suggests improvements for *that* project. Works whether Daedalus is launched
from source or installed via `npm` (reads the FTS index, never raw `src/`).

This replaces the fragile "agent orchestrates a 3-step pipeline" approach
(which failed 3 ways in testing) with a **deterministic tool** — straight code,
no agent-in-the-loop for the scan→propose→issue flow.

## Entry points
- Slash command: `/scan-ai-repos --top 10 [--issue] [--token <gh>]`
- Built-in tool `scan_ai_repos` (so an agent session can call it too).

## Architecture (built-in tool, deterministic)
1. **Scan** — GitHub search for top AI repos (`topic:ai stars:>1000`),
   paginated, token from `process.env.GITHUB_TOKEN` or `--token`.
   *Never reads `.env`* (the earlier pipeline died on this — the guard is
   correct; the tool just won't need it). Unauthenticated falls back to the
   lower GitHub rate limit with a clear message.
2. **Rank** — reuse the scanner's `takeTop` min-heap ranking (O(n log k)).
3. **Analyze current project** — for each notable pattern in the top repos,
   query the project's **FTS index** (`context.indexDb`):
   `searchSymbols` / `findDefinitions` / `getImpactAnalysis` keyed by
   `context.projectHash`. Determine whether the pattern already exists in the
   project, partially exists, or is missing. Produce **file-specific**
   suggestions (path + symbol + concrete change), NOT the scanner's generic
   templates ("Universal Code Assistant", etc.).
4. **Deliver** —
   - default: print the ranked, file-specific report.
   - `--issue`: `gh issue create --repo <derived from `git remote get-url origin`
     of projectRoot> --body-file <report>`. Repo is derived from the project,
     never hardcoded to Daedalus.

## Why this survives "installed via npm"
- The tool operates on `context.indexDb` (FTS5 index of `projectRoot`), not raw
  files. `index_codebase` already builds this from any project. So self-analysis
  works from a cloned Daedalus repo, and analyzing a *user's* project works from
  npm-installed Daedalus. No assumption that `src/` exists.

## Files to add / change (Phase B, core)
- `src/tools/builtin/scan-ai-repos.ts` — the tool (scan + rank + index-analyze
  + optional issue). Pure functions, testable.
- `src/tools/definitions.ts` — register `scan_ai_repos` in `BUILTIN_TOOLS`.
- `src/commands/scan-ai-repos.ts` — slash command wrapper → `executeCommand`.
- GitHub client + ranking: port the *good* parts from the sandbox scanner
  (`github-client.ts`, `ranking.ts`) into `src/tools/builtin/scan-ai-repos.ts`
  (or a small `src/tools/builtin/scan/` submodule). Drop the generic
  `suggestions.ts` templates; replace with index-driven analysis.

## Phasing
- **Phase A — spike in sandbox** (`D:/daedalus-sandbox/ai-scanner`): port GitHub
  client + ranking + `--issue` into the existing scanner, prove it creates a
  real issue end-to-end. De-risks GitHub/ranking/gh logic fast, no core churn.
- **Phase B — core**: implement `scan_ai_repos` built-in + `/scan-ai-repos`
  command using `context.indexDb` for project analysis.
- **Phase C — tests + verify**: unit tests (mock GitHub fetch + mock indexDb);
  real run from `D:/Daedalus` producing an issue; `npm run build` + `npm test`
  green.

## Open decisions
1. Phase A spike first (recommended) or go straight to core?
2. Default deliverable: print report only, or also open issue when `--issue`?
3. Issue target: always `projectRoot`'s remote repo (recommended), or a
   configurable default?

## Security notes (carried from the test failures)
- No `.env` reads anywhere in the flow.
- Token via `process.env` / explicit arg only.
- Issue body is generated content; the existing `maskSecrets` still applies to
  any tool output that could contain secrets.
