# [1.7.0](https://github.com/bgill55/daedalus/compare/v1.6.0...v1.7.0) (2026-06-20)


### Features

* implement inline config setting via /config set ([86516ff](https://github.com/bgill55/daedalus/commit/86516ffcc182924e6177e187519ae381eebc8d32))

# [1.6.0](https://github.com/bgill55/daedalus/compare/v1.5.0...v1.6.0) (2026-06-20)


### Features

* implement proactive model routing and default agent prompt guardrails ([29ec1fc](https://github.com/bgill55/daedalus/commit/29ec1fcfc26453379af7ba315158e8abe332229b))

# [1.5.0](https://github.com/bgill55/daedalus/compare/v1.4.1...v1.5.0) (2026-06-20)


### Features

* implement concurrent background agent execution and task commands ([c74263d](https://github.com/bgill55/daedalus/commit/c74263de9ad26a0c2be8a636f9012a3e06bbce01))

## [1.4.1](https://github.com/bgill55/daedalus/compare/v1.4.0...v1.4.1) (2026-06-20)


### Bug Fixes

* use type-only imports and exports for router interfaces to prevent runtime ESM syntax errors ([db5df1d](https://github.com/bgill55/daedalus/commit/db5df1d8711c0f049826e997bc6fab3e6d8c9185))

# [1.4.0](https://github.com/bgill55/daedalus/compare/v1.3.0...v1.4.0) (2026-06-20)


### Features

* enhance system prompts with terminal sandboxing and codebase indexing guidelines ([0439603](https://github.com/bgill55/daedalus/commit/0439603cd9a45577c4cfe2933a323d53a022c85c))

# [1.3.0](https://github.com/bgill55/daedalus/compare/v1.2.0...v1.3.0) (2026-06-20)


### Features

* implement command execution sandboxing via Docker and WSL ([da297e1](https://github.com/bgill55/daedalus/commit/da297e1db3abe051c017400fe0e96dd019ff058a))

# [1.2.0](https://github.com/bgill55/daedalus/compare/v1.1.0...v1.2.0) (2026-06-20)


### Features

* implement multi-candidate voting in Ensemble mode ([4b70f29](https://github.com/bgill55/daedalus/commit/4b70f29be733bffe006e394c04c442cc4b457bff))

# [1.1.0](https://github.com/bgill55/daedalus/compare/v1.0.1...v1.1.0) (2026-06-20)


### Features

* implement incremental FTS5 indexing on file watch events ([f37faef](https://github.com/bgill55/daedalus/commit/f37faefd6185602a4c982390a12d610c49b0410f))

## [1.0.1](https://github.com/bgill55/daedalus/compare/v1.0.0...v1.0.1) (2026-06-20)


### Bug Fixes

* address code quality issues from audit ([2638587](https://github.com/bgill55/daedalus/commit/2638587efafb5258f0c156116c0f8998b49b8435))

# 1.0.0 (2026-06-20)


### Bug Fixes

* stdin leak in approval gate — use rl.question instead of raw mode ([3fa5c3b](https://github.com/bgill55/daedalus/commit/3fa5c3b3b93e862107469cc914e1c6fb29381a1a))
* yield every file in indexer to prevent keyboard lag (was every 10 files) ([761d99f](https://github.com/bgill55/daedalus/commit/761d99fd2ad109b82eb76b585610dd16c762f52f))


### Features

* automatic update checker on startup ([2c858c3](https://github.com/bgill55/daedalus/commit/2c858c37fe8084463150b2de65056e4062d8f2c9))
* implement autonomous debugging loops ([5703507](https://github.com/bgill55/daedalus/commit/57035077430a1ef5bfed8f1fdec06553fbca6bb0))
* implement branch and PR commands ([faa2107](https://github.com/bgill55/daedalus/commit/faa2107535334ba4853f9b25d20063b96023d1da))
* implement interactive chunk-level diff staging (Sprint 5) ([746486f](https://github.com/bgill55/daedalus/commit/746486fa82d7337915267a8e3cc392184451cd54))
* implement interactive TUI file selector ([c2c6ba4](https://github.com/bgill55/daedalus/commit/c2c6ba488a7df33f9b1ea371d0c4af217eedaba6))
* implement multi-model ensemble drafting pipeline (Sprint 6) ([5690d31](https://github.com/bgill55/daedalus/commit/5690d319d494be5f377e4734fddf129d8d996d6c))
* implement token budget meter and pruning ([b05418e](https://github.com/bgill55/daedalus/commit/b05418ec399c94afae0fb1893c37dffed2bc668f))
* memory that grows with you — profile system, auto-fact extraction, throttled indexer ([f9b8e9f](https://github.com/bgill55/daedalus/commit/f9b8e9f16393264ef208d842bb691d325e756f91))
* **patch:** fuzzy whitespace matching, syntax guardrails, and context-aware hints ([106d675](https://github.com/bgill55/daedalus/commit/106d675321dadd1279cf4140147804db64f3e208))
* **power-tools:** LSP diagnostics/hover/rename, screenshot+vision, impact analysis, process watcher, scratchpad eval ([d645246](https://github.com/bgill55/daedalus/commit/d64524683728c37e2cb490f782593e6fc95a3b01))
* **trust:** write-without-read guardrail, circuit breaker, import/export validation, auto-test loop, large-rewrite annotation ([7976ffe](https://github.com/bgill55/daedalus/commit/7976ffe67e40f73646175a217a268cfbd306ccc1))
* v0.5.0 — security audit fixes and personality ([ce6aedd](https://github.com/bgill55/daedalus/commit/ce6aedd87e1c32d8f0dd35c6cddfcd2475fa34a0))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Isolated command execution sandboxing** — introduces a `tools.sandbox` configuration option to execute terminal shell commands inside an isolated Docker container (mounting the project directory to `/workspace` and normalizing subfolder paths) or Windows Subsystem for Linux (WSL, translating Windows working paths using `wslpath`).
- **Multi-candidate drafting and voting in Ensemble mode** — supports generating multiple code candidate drafts from different models or temperature configurations, automatically verifying compilation and test status, and letting the Critic model score and vote on the best candidate using a temporary git baseline commit workflow.
- **Incremental FTS5 indexing on file watch events** — recursive, dependency-free background file watcher using native recursive `fs.watch` on Windows/macOS and falling back to manual recursive watching on Linux. Debounces file events by 300ms to update SQLite index tables on creations/modifications and remove entries on deletions.
- **PowerShell & custom shell preference support in terminal execution** — configure terminal's preferred shell via environment variables (`DAEDALUS_SHELL`, `SHELL`) or config file setting (`tools.shell`) with automatically matched runtime execution arguments for bash, cmd, and PowerShell/pwsh.
- **CLI modular refactoring** — decoupled the monolithic entry point `src/index.ts` into isolated modules: `src/banner.ts`, `src/clipboard.ts`, `src/commands.ts`, `src/formatting.ts`, `src/model.ts`, `src/repl.ts`, and `src/update-check.ts` for clean code organization.
- **CLI Command Registry & Router pattern** — refactored command dispatching out of the main REPL loop into a centralized registry containing all 34 commands. Tab-completion list is now dynamically built from registered commands and aliases.
- **Cleaned TypeScript build compilation** — fixed all strict type safety and import issues across commands, models, project configs, and sessions, resulting in zero TS compiler errors on `tsc --noEmit`.
- **Additional test coverage** — added new test suites for preferred shell detection, MCP stdio/http transports, and CLI loops.
- **CI/CD pipeline** — lint on ubuntu + test on win/ubuntu/macos runs on every PR; push to main triggers semantic-release (npm publish + GitHub release); manual canary release workflow with `--tag canary`
- **ESLint v10 flat config** — typescript-eslint integration, pragmatically tuned to warn on pre-existing issues and error on new ones
- **`DAEDALUS_PROFILE_PATH` env var** — allows overriding profile path without mocking `os.homedir()`

### Fixed
- **Orchestrator error handling** — `run()` now catches errors and returns a graceful fallback message instead of crashing

## [0.5.24] - 2026-06-19

### Added
- **Write-without-read guardrail** — `patch` and `write_file` are blocked on any existing file that has not been read this session, preventing edits based on hallucinated or stale content
- **Stale-read detection** — if a file's mtime advances after the last `read_file` call, the tool blocks and asks the model to re-read before patching
- **Circuit breaker** — after 2 consecutive failed patches on the same file, all further patch attempts are halted with a `[CIRCUIT BREAKER]` message to stop infinite retry loops
- **Import existence validation** — after every `write_file` or `patch`, local file imports and npm package references are verified against the disk and `package.json`; missing imports are reported as warnings in the tool result
- **Export consistency check** — after every write/patch, detects `export { name }` statements where `name` is not actually defined in the file
- **Auto-test loop** — after a successful write or patch, the co-located `*.test.ts` / `*.spec.ts` file (if present) is automatically run and any failures are fed back to the model as a tool result so it can self-correct
- **Large-rewrite annotation** — when more than 40% of a file's lines are replaced in a single diff, a yellow `⚠ LARGE REWRITE` banner is shown in the interactive diff header
- `sessionReadCache` and `patchFailureStreak` fields added to `ToolContext` to track per-session read state and failure streaks
- 9 new unit tests covering all six trust features (40 total)

## [0.5.23] - 2026-06-19

### Added
- **Fuzzy whitespace & indentation patching** — if `old_string` fails an exact match, `patch` performs a secondary whitespace-normalized search; if exactly one candidate block matches, the patch is applied automatically; multiple matches are safely rejected
- **Syntax validation guardrails** — after every `write_file` or `patch`, the affected file is syntax-checked (`.json` via `JSON.parse`, `.ts/.tsx` via `tsc --noEmit`, `.js/.mjs/.cjs` via `node --check`); if a syntax error is introduced the file is automatically reverted and the compiler error is returned to the model for self-correction
- **Context-aware patch hints** — when both exact and fuzzy matching fail, a Levenshtein sliding-window search (up to 300 lines) finds the closest matching block and returns it with the error message so the model can correct its patch immediately
- `normalizeWhitespace`, `fuzzyWhitespacePatch`, `levenshtein`, `findClosestBlock`, and `syntaxCheck` helpers in `src/tools/builtin/files.ts`
- 8 new unit tests covering fuzzy matching, hint generation, syntax validation, and JSON revert behaviour

## [0.5.22] - 2026-06-19

### Added
- Automated placeholder detection guardrails in file manipulation tools (`write_file` and `patch`) to prevent local models from writing lazy ellipsis comments (like `// ...`) or abbreviated code placeholders into source files
- Promoted guidelines in agent system prompts warning against using code placeholders

## [0.5.21] - 2026-06-19

### Added
- Integrated terminal-safe inline markdown renderer to print clean formatted bullet points, headers, bold, italics, and code blocks directly in CLI streaming outputs

## [0.5.20] - 2026-06-19

### Added
- XML-style text-based tool call parsing (`<longcat_tool_call>` / `<tool_call>`) to support local models that output tool tags in their text response instead of native OpenAI function calling payloads
- Response model tracking to display the active model name and resolved ID in the turn metadata footer

### Changed
- Softened model call and fallback errors to yellow warning blocks suggesting `/doctor` rather than showing aggressive red stack traces

## [0.5.19] - 2026-06-19

### Added
- Multi-Model Ensemble Drafting (Sprint 6): added `/ensemble <goal>` command to run a draft-review revision loop where a fast local model drafts changes and a smart model critiques them before writing to disk
- Support for target model routing in LocalRouter by matching request.model against configured names or model IDs in the chain

## [0.5.18] - 2026-06-19

### Added
- Interactive hunk-level diff review and staging: choose `[c]hunks` at the apply diff prompt to accept (`y`), reject (`n`), stage all remaining (`a`), or quit (`q`) at the individual change hunk level

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
