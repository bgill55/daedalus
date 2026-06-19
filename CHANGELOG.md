# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.17] - 2026-06-19

### Added
- Interactive TUI project file finder and fuzzy explorer: running `/add` without a filepath opens an interactive list view to search, navigate, and toggle files in and out of the active context with real-time fuzzy matching and scoring
- Flicker-free terminal re-rendering and raw keyboard state restoration

## [0.5.16] - 2026-06-19

### Added
- `/debug <command>` command to run autonomous debugging loops: executes the command, captures errors/logs, invokes the model to patch relevant files, and re-runs the command (retrying up to 5 times)
- Tab autocompletion and help menu quickref support for `/debug`

## [0.5.15] - 2026-06-19

### Added
- `/branch [name]` command to view the current active branch or create/switch branches directly in the REPL
- `/pr [base-branch]` command to automatically generate a detailed markdown Pull Request description comparing the current branch to a base branch (e.g. `main` or `master`) and save it to `pr-desc.md`
- Tab autocompletion and help menu quickref support for `/branch` and `/pr`

## [0.5.14] - 2026-06-19

### Added
- Context budget and token usage meter directly visible in the REPL prompt (`[<files> · <tokens>] ›`)
- `/prune` command to view a detailed breakdown of context usage (system, files, history) and manually prune conversation turns
- Auto-pruning engine that runs before model calls to automatically truncate massive tool outputs or prune oldest turns if context exceeds configured thresholds
- Co-located unit tests for token calculation and pruning algorithm under `src/session/tokens.test.ts`

## [0.5.13] - 2026-06-19

### Changed
- Refactored user prompt box to render as a compact, shrink-to-fit card/bubble instead of spanning the entire terminal width
- Removed borders and padding from the assistant blocks to match a clean, unboxed modern chat UI style

### Fixed
- Corrected off-by-one border alignment math in user prompt box rendering

## [0.5.12] - 2026-06-19

### Fixed
- Fixed off-by-one border misalignment in the user prompt box
- Fixed misaligned static border widths in the interactive diff approval UI to dynamically scale with file paths

## [0.5.11] - 2026-06-19

### Added
- Cached Windows shell detection in `/terminal` tool to eliminate process spawn lag
- Concurrent MCP server initialization (parallel `Promise.all` connections)

### Fixed
- Asynchronous boot health checks: initial health checks now run in the background to prevent boot blocking
- Included Authorization header with API key in health check fetches to prevent auth failures on remote endpoints

## [0.5.10] - 2026-06-19

### Fixed
- Restored missing SIGINT handler registration in main function to fix syntax error
- Refined terminal outputs: replaced emojis with standardized text labels (`[OK]`, `[WARN]`, `[ERROR]`) to align with style guide

- Indexer yields after every file instead of every 10 — eliminates keyboard lag during background indexing (v0.5.9)

### Added

- **Auto-fact extraction** — after each turn with learning signals (file edits, commits), Daedalus silently extracts key-value facts and saves them to project memory. The CLI that grows with you.

- `/extract` command — manually trigger fact extraction from the current session
- Session-end extraction — facts extracted automatically when you exit
- `src/extraction.ts` — extraction engine: signal detection, lightweight LLM call, dedup, save
- User profile system (`/profile`) — name and bio stored in `~/.daedalus/profile.json`, auto-injected into every session
- Coding style memory (`/style`) — persistent coding preferences injected into system prompt, no more repeating yourself
- `src/profile.ts` — profile module with load/save/prompt generation
- `updateCheck` config option (default: true) — set to false in config.json to disable
- CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md — open-source governance docs
- AGENTS.md — AI assistant conventions for tool-aided development
- GitHub issue templates (bug report, feature request) and PR template
- CHANGELOG.md — project changelog
- User approval gate before dangerous tool execution (terminal, write_file)
- MCP tool registration warning on startup
- Personality: dry humor injected into system prompts, tool descriptions, agent roles, banner, and diff UI

### Fixed

- stdin leak in approval gate — switched from raw mode keypresses to readline.question() to prevent character bleed into the next prompt

### Fixed

- CRITICAL: Path traversal in resolvePath — now enforces project directory boundary
- CRITICAL: Sub-agent auto-approval in diff UI — removed isSubAgent bypass
- HIGH: Environment variables leaked to child processes — sanitized env in terminal and MCP stdio
- HIGH: Shell injection in search_files — replaced shell command construction with direct spawn
- HIGH: Config file world-readable permissions — chmod 0600 on non-Windows
- HIGH: openEditor shell:true — changed to shell:false
- HIGH: MCP stdio command injection — validates command for shell metacharacters
- HIGH: Clipboard script security — added random suffix to temp files, size limit on text paste

## [0.4.2] - 2026-06-18

### Changed

- Word-wrap box content to terminal width for better readability
- User top border alignment fix
- All message boxes share consistent border width

### Added

- Image paste support via `/paste` command
- Dynamic version read from package.json

## [0.4.1] - 2026-06-18

### Changed

- Made `indexCodebase` fully async so auto-index doesn't block startup
- Updated README and package metadata
- Renamed npm package to `daedalus-cli` (name conflict resolution)

## [0.3.0] - 2026-06-18

### Added

- Initial release
- CLI REPL with command dispatch, streaming chat, and tool execution
- Model router with priority, round-robin, and fastest-response strategies
- Health checking and token-bucket rate limiter
- Session persistence via SQLite with JSONL import/export
- Project memory — persisted facts and conventions auto-injected every turn
- 16 built-in tools: file read/write/patch, terminal, git, web, todo, delegation, codebase search, project config
- Interactive diff UI with y/n/a/s/e/d workflow
- MCP support: stdio and HTTP/SSE transport
- Multi-agent orchestration with 6 roles (orchestrator, planner, coder, reviewer, debugger, researcher)
- Codebase indexing with FTS5 for TS/JS, Python, Go, Rust
- Auto-discovery of local LLM servers (LM Studio, Ollama, llama.cpp, vLLM)
- First-run onboarding wizard
- Syntax highlighting for code blocks
- Cross-platform support (Windows + Unix)
