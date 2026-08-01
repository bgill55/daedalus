# Daedalus — Agent Conventions

## Project Identity
- **Name:** Daedalus (`daedalus-cli` on npm)
- **Description:** Local-first AI coding CLI with embedded model router, multi-agent orchestration, and codebase indexing
- **Language:** TypeScript (ESM, `"type": "module"`)
- **Node:** >=20

## Code Conventions
- **No comments** in source files unless absolutely necessary for clarity
- No emoji in code or docs unless user explicitly requests
- Exports: named exports only (no default exports)
- Types: Zod schemas in config files, interfaces in `src/types.ts`
- Imports: always include `.js` extension in ESM imports (e.g., `'./file.js'`)
- Error handling: throw typed errors, prefer `result` pattern for tool returns

## Architecture
- `src/index.ts` — CLI entry point, REPL loop, command dispatch
- `src/config/` — Zod-schema validated config at `~/.daedalus/config.json`
- `src/router/` — Model routing (priority/round-robin/fastest), health checks, rate limiting (token bucket, no global Map)
- `src/session/` — SQLite-backed session persistence, project memory, JSONL export; DB opened via `initIndexDb()` factory, not at import time; `sigma-mem.ts` = Σ-Mem reliable memory engine (dedup via `content_hash`, tag-ranked retrieval, time decay), used by BOTH orchestration and single-agent paths
- `src/agents/` — Multi-agent orchestration (planner, coder, reviewer, debugger, researcher); `/autopilot` command orchestrates end-to-end feature branches; `loop.ts` uses dynamic `import()` for `Orchestrator`, no circular dependency
- `src/tools/` — 16 built-in tools + MCP transport (stdio + HTTP/SSE)
- `src/indexing/` — FTS5 codebase indexing (TS/JS, Python, Go, Rust, Java, C/C++, C#, PHP, Ruby, Elixir)

## Testing
- Framework: vitest
- Run: `npm test` (vitest run, 468+ tests across 56 files)
- Tests co-located as `*.test.ts` under `src/`

## Lint
- Framework: eslint v10 (flat config)
- Run: `npm run lint` (eslint src --ext .ts)

## CI/CD
- **CI** (`.github/workflows/ci.yml`): on PR lint (ubuntu) + test (win/ubuntu/macos)
- **Release** (`.github/workflows/release.yml`): on push to `main` `npx semantic-release`
- **Canary** (`.github/workflows/canary.yml`): manual dispatch publish with `--tag canary`
- Requires `NPM_TOKEN` and `GITHUB_TOKEN` GitHub secrets

## Codebase Audit Protocol
When asked to audit the codebase, ALWAYS first:
1. Read this AGENTS.md file to understand conventions and architecture
2. Run `git log --oneline -20` to see recent changes
3. Run `git diff --stat main~5..main` to see what's recently changed
4. Base all analysis on current code, not assumptions
5. If unsure about a claimed bug, verify by reading the actual source files before reporting
6. Note recent significant changes (formatting buffered output, /history command, docs overhaul, compactMode config) so the audit reflects current state rather than stale patterns
