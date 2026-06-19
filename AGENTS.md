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
- `src/router/` — Model routing (priority/round-robin/fastest), health checks, rate limiting
- `src/session/` — SQLite-backed session persistence, project memory, JSONL export
- `src/agents/` — Multi-agent orchestration (planner, coder, reviewer, debugger, researcher)
- `src/tools/` — 16 built-in tools + MCP transport (stdio + HTTP/SSE)
- `src/indexing/` — FTS5 codebase indexing (TS/JS, Python, Go, Rust)

## Testing
- Framework: vitest
- Run: `npm test` (vitest run)
- No tests exist yet — add them under `src/` co-located as `*.test.ts`

## important
- never lint before asking
- do not add comments
- never use emojis
