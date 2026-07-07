## [1.39.6](https://github.com/bgill55/daedalus/compare/v1.39.5...v1.39.6) (2026-07-07)


### Bug Fixes

* **tui:** call list.setItems explicitly after construction to enable key navigation ([97ad1db](https://github.com/bgill55/daedalus/commit/97ad1db0efe7208f7aa2942a33a4ef4742b2ff3b))

## [1.39.5](https://github.com/bgill55/daedalus/compare/v1.39.4...v1.39.5) (2026-07-07)


### Bug Fixes

* **tui:** cancel textbox readInput when blurred to allow navigation in other focused widgets ([50b54b4](https://github.com/bgill55/daedalus/commit/50b54b4d11dbdedf80f4128a523b1210443f0568))

## [1.39.4](https://github.com/bgill55/daedalus/compare/v1.39.3...v1.39.4) (2026-07-07)


### Bug Fixes

* **tui:** add mouse click-to-focus and wheel scroll support to lists and console ([59ed40b](https://github.com/bgill55/daedalus/commit/59ed40b9e4020ee45c5e887dba1837fd39d3f24c))
* **tui:** pass amount argument to list up and down methods ([8de67f9](https://github.com/bgill55/daedalus/commit/8de67f9aa7762168e4be7f29e70d3d96dcaef934))

## [1.39.3](https://github.com/bgill55/daedalus/compare/v1.39.2...v1.39.3) (2026-07-06)


### Bug Fixes

* **session:** clean conversational prefixes from generated titles ([3120760](https://github.com/bgill55/daedalus/commit/312076044a735f679c499373b9d8f52a13ceb8bc))

## [1.39.2](https://github.com/bgill55/daedalus/compare/v1.39.1...v1.39.2) (2026-07-05)


### Bug Fixes

* **tui:** register original stdout/stderr streams on globalThis to prevent stream redirection leaks on unexpected crashes ([5e3fb19](https://github.com/bgill55/daedalus/commit/5e3fb1915dbdbadb7185fe5b8004f974afffed70))

## [1.39.1](https://github.com/bgill55/daedalus/compare/v1.39.0...v1.39.1) (2026-07-05)


### Bug Fixes

* **router:** sanitize messages to strip vision/image payloads for models without vision capabilities and default null/undefined content ([1728853](https://github.com/bgill55/daedalus/commit/1728853309add47d5de49b5d94cf458aacde474d))

# [1.39.0](https://github.com/bgill55/daedalus/compare/v1.38.3...v1.39.0) (2026-07-05)


### Features

* **session:** add /session export subcommand to export current conversation to a styled Markdown file ([e01be16](https://github.com/bgill55/daedalus/commit/e01be16b3051712add44cbf17a686a28fb80207c))

## [1.38.3](https://github.com/bgill55/daedalus/compare/v1.38.2...v1.38.3) (2026-07-05)


### Bug Fixes

* **executor:** execute tool calls sequentially instead of in parallel to avoid concurrent stdin/readline collisions and file-writing races ([099578b](https://github.com/bgill55/daedalus/commit/099578b8a9430e070e7bb7d0b92c69736a5882bf))

## [1.38.2](https://github.com/bgill55/daedalus/compare/v1.38.1...v1.38.2) (2026-07-05)


### Bug Fixes

* **todo:** support property-level merging and default empty content to prevent SQLite NOT NULL constraint failures ([c7abc8f](https://github.com/bgill55/daedalus/commit/c7abc8fe117877b93c4dab6eff9fe70b80c05e05))

## [1.38.1](https://github.com/bgill55/daedalus/compare/v1.38.0...v1.38.1) (2026-07-05)


### Bug Fixes

* **cli:** eliminate turn-gate prompt for read-only tools and fix process termination leaks on Windows ([97163d1](https://github.com/bgill55/daedalus/commit/97163d17d363940ecd0fbc111d5755aa5cb6b3fe))

# [1.38.0](https://github.com/bgill55/daedalus/compare/v1.37.6...v1.38.0) (2026-07-05)


### Features

* **cli:** enhance code generation quality, prompts, verification pipelines, and design token integration ([83aed68](https://github.com/bgill55/daedalus/commit/83aed68cba1c4b4985870515505af0966fd6263f))

## [1.37.6](https://github.com/bgill55/daedalus/compare/v1.37.5...v1.37.6) (2026-07-04)


### Bug Fixes

* add arg validation to patch tool and optimize router openai request compatibility ([538af50](https://github.com/bgill55/daedalus/commit/538af507b61b1f90cc7d71fc441a41652c1b213a))

## [1.37.5](https://github.com/bgill55/daedalus/compare/v1.37.4...v1.37.5) (2026-07-04)


### Bug Fixes

* **router:** strip signal from OpenAI body to prevent 422 errors ([883a5e8](https://github.com/bgill55/daedalus/commit/883a5e8628103619ee161cc32a680df5fb4d6346))

## [1.37.4](https://github.com/bgill55/daedalus/compare/v1.37.3...v1.37.4) (2026-07-04)


### Bug Fixes

* **orchestrator:** refine React import rules for Next.js Pages Router ([dcbfb01](https://github.com/bgill55/daedalus/commit/dcbfb0176a28c76886869ee8b32ec6b3a0e0eaa7))

## [1.37.3](https://github.com/bgill55/daedalus/compare/v1.37.2...v1.37.3) (2026-07-04)


### Bug Fixes

* **orchestrator,index:** fix fallback plan cwd paths and argv flag filtering ([9177e85](https://github.com/bgill55/daedalus/commit/9177e8556213abfc40224af7496c367bd7d4e082))

## [1.37.2](https://github.com/bgill55/daedalus/compare/v1.37.1...v1.37.2) (2026-07-04)


### Bug Fixes

* **orchestrator:** fix planner failure on vague frontend UI goals ([afd1a4b](https://github.com/bgill55/daedalus/commit/afd1a4bcebb508e00bd30d7dc5a5df60e6dad4ad))

## [1.37.1](https://github.com/bgill55/daedalus/compare/v1.37.0...v1.37.1) (2026-07-04)


### Bug Fixes

* **agents:** harden production code generation against anti-pattern contamination ([3519a1b](https://github.com/bgill55/daedalus/commit/3519a1b94c4333d4ad7f35ffc54f19e742abc26a))

# [1.37.0](https://github.com/bgill55/daedalus/compare/v1.36.1...v1.37.0) (2026-07-03)


### Features

* **agents:** inject versioned Next.js production coding rules into coder context ([a3971f8](https://github.com/bgill55/daedalus/commit/a3971f8396ace5c71354a269faf73a04e0c627bc))

## [1.36.1](https://github.com/bgill55/daedalus/compare/v1.36.0...v1.36.1) (2026-07-02)


### Bug Fixes

* **cli:** prevent stale read on consecutive writes and reset circuit breaker on read_file ([e5341d0](https://github.com/bgill55/daedalus/commit/e5341d00048387657317a5492179ca3965c28dcb))

# [1.36.0](https://github.com/bgill55/daedalus/compare/v1.35.9...v1.36.0) (2026-07-02)


### Features

* **cli:** add auto-approve flags and prevent tool-calling loops ([399c30b](https://github.com/bgill55/daedalus/commit/399c30b3a77b346592abdacbe1dc3e51ed07fc86))

## [1.35.9](https://github.com/bgill55/daedalus/compare/v1.35.8...v1.35.9) (2026-07-02)


### Bug Fixes

* **orchestrator:** filter build errors by modified files and add error hints ([8b3e91d](https://github.com/bgill55/daedalus/commit/8b3e91d808a4cdcc710a4ac571ea715cbc047ce4))
* **orchestrator:** resolve TS2532 compiler error on patchHistory access ([88183a4](https://github.com/bgill55/daedalus/commit/88183a4aab945e373d3d7a833a3d89c5c8162246))

## [1.35.8](https://github.com/bgill55/daedalus/compare/v1.35.7...v1.35.8) (2026-07-02)


### Bug Fixes

* **orchestrator:** disable tools on the final turn of agent execution to guarantee a text-only summary output ([0a1bc38](https://github.com/bgill55/daedalus/commit/0a1bc385fdbcff2d1c42b088ad56f83a3ea9751e))

## [1.35.7](https://github.com/bgill55/daedalus/compare/v1.35.6...v1.35.7) (2026-07-02)


### Bug Fixes

* **orchestrator:** filter out framework names from file path matching and block single-task collapsed plans for complex goals ([6bb0212](https://github.com/bgill55/daedalus/commit/6bb02127a01dc4fed5946058b45c949f1456d4bf))

## [1.35.6](https://github.com/bgill55/daedalus/compare/v1.35.5...v1.35.6) (2026-07-02)


### Bug Fixes

* **orchestrator:** comprehensive stability overhaul — 18 bug fixes across plan validation, parser, verification, repair, and role config ([8c01c21](https://github.com/bgill55/daedalus/commit/8c01c21a41e6b39ee00765c338bb49c4129bd13e))
* **orchestrator:** comprehensive stability overhaul — 24 bug fixes across plan validation, parser, verification, repair, and role config ([92ba0c2](https://github.com/bgill55/daedalus/commit/92ba0c2fe350a89ec621cae50c9c3e570e439099))

## [1.35.5](https://github.com/bgill55/daedalus/compare/v1.35.4...v1.35.5) (2026-07-02)


### Bug Fixes

* **orchestrator:** only require file paths for coder and debugger tasks ([deaa66c](https://github.com/bgill55/daedalus/commit/deaa66c249745da54313cf896ce1ca405cfe8a14))

## [1.35.4](https://github.com/bgill55/daedalus/compare/v1.35.3...v1.35.4) (2026-07-02)


### Bug Fixes

* **orchestrator:** use auto tool choice for read-only roles and skip tools used line in parser ([dd54a3f](https://github.com/bgill55/daedalus/commit/dd54a3f61338e88b41f9e618cbb02eacda7934b1))

## [1.35.3](https://github.com/bgill55/daedalus/compare/v1.35.2...v1.35.3) (2026-07-02)


### Bug Fixes

* **orchestrator:** pass tasks and originalGoal to retried task delegations and fix split validation check ([cb96492](https://github.com/bgill55/daedalus/commit/cb96492c9a289a160d0a88c36f8adad3480ee517))

## [1.35.2](https://github.com/bgill55/daedalus/compare/v1.35.1...v1.35.2) (2026-07-02)


### Bug Fixes

* **planner:** refine vague word regex and instruct planner to resolve them ([e2ae045](https://github.com/bgill55/daedalus/commit/e2ae04573d30511c3ec2e3218bbed87eab07ab6a))

## [1.35.1](https://github.com/bgill55/daedalus/compare/v1.35.0...v1.35.1) (2026-07-02)


### Bug Fixes

* **prompts:** instruct agents to acknowledge tool results in history ([90c90e1](https://github.com/bgill55/daedalus/commit/90c90e1022ebf04c7e5ac853b37fabe01d65a73c))

# [1.35.0](https://github.com/bgill55/daedalus/compare/v1.34.18...v1.35.0) (2026-07-01)


### Features

* **orchestrator:** implement build verification loops and auto rollbacks ([f0a2229](https://github.com/bgill55/daedalus/commit/f0a22298c69b8943c022aa0fd24a765e0cdf5cbf))

## [1.34.18](https://github.com/bgill55/daedalus/compare/v1.34.17...v1.34.18) (2026-07-01)


### Bug Fixes

* **tui:** allow scrolling with PageUp/PageDown while input textbox is focused ([833d69b](https://github.com/bgill55/daedalus/commit/833d69b9ece363198ab2802981df8d6e617acd60))

## [1.34.17](https://github.com/bgill55/daedalus/compare/v1.34.16...v1.34.17) (2026-07-01)


### Bug Fixes

* **tui:** handle Tab focus cycling when textbox is focused ([1974e1f](https://github.com/bgill55/daedalus/commit/1974e1ff2e0552f3ed66427908e618fd3cbb405a))

## [1.34.16](https://github.com/bgill55/daedalus/compare/v1.34.15...v1.34.16) (2026-06-30)


### Bug Fixes

* **cli:** limit list_files results to prevent context window token overflow ([620ba4a](https://github.com/bgill55/daedalus/commit/620ba4ac5d4d486aa2526ab5151e022406ae11f2))

## [1.34.15](https://github.com/bgill55/daedalus/compare/v1.34.14...v1.34.15) (2026-06-30)


### Bug Fixes

* **cli:** ignore build/dep folders in files tool & add max_tokens to completions ([346bb10](https://github.com/bgill55/daedalus/commit/346bb105a89e23099b15a40565e3620dd46ca5f8))

## [1.34.14](https://github.com/bgill55/daedalus/compare/v1.34.13...v1.34.14) (2026-06-29)


### Bug Fixes

* remove duplicate Tab key handlers that double-fire and skip widgets ([26dce71](https://github.com/bgill55/daedalus/commit/26dce713e0466f9f3fbb774deb374b1345626ede))

## [1.34.13](https://github.com/bgill55/daedalus/compare/v1.34.12...v1.34.13) (2026-06-29)


### Bug Fixes

* instruct model to skip tool calls for simple greetings in default system prompt ([7d21762](https://github.com/bgill55/daedalus/commit/7d21762ead99fa6e5d36e217e2cfd163d1cea8a0))

## [1.34.12](https://github.com/bgill55/daedalus/compare/v1.34.11...v1.34.12) (2026-06-29)


### Bug Fixes

* silence background terminal spinner in TUI mode to prevent logging escape sequences ([5f59c8d](https://github.com/bgill55/daedalus/commit/5f59c8d98db580b2fca07462c1106fd4d96225ee))

## [1.34.11](https://github.com/bgill55/daedalus/compare/v1.34.10...v1.34.11) (2026-06-29)


### Bug Fixes

* enable mouse tracking on blessed screen to activate mouse clicks on TUI widgets ([c76180a](https://github.com/bgill55/daedalus/commit/c76180a011aadb1bfcdc4368fae56d9a66466ea0))

## [1.34.10](https://github.com/bgill55/daedalus/compare/v1.34.9...v1.34.10) (2026-06-29)


### Bug Fixes

* intercept and discard tab keypresses in inputField textbox to prevent tab character input during focus shifts ([afc7cd7](https://github.com/bgill55/daedalus/commit/afc7cd7c79f859686192a0e7e193064aaf961cc9))

## [1.34.9](https://github.com/bgill55/daedalus/compare/v1.34.8...v1.34.9) (2026-06-29)


### Bug Fixes

* cast list element to any in click listeners to satisfy tsc ([df59155](https://github.com/bgill55/daedalus/commit/df59155b784e5a459ae6fccb9d830dc3fc69b99f))
* resolve overlapping sidebar borders, inputField tab focus capture, and mouse-clicks on TUI lists ([e90ddca](https://github.com/bgill55/daedalus/commit/e90ddca8ba84d242c40869acfb28f61eb31f4a3b))

## [1.34.8](https://github.com/bgill55/daedalus/compare/v1.34.7...v1.34.8) (2026-06-29)


### Bug Fixes

* set isTTY/columns/rows on customStdout so blessed gets proper terminal capabilities ([8792545](https://github.com/bgill55/daedalus/commit/879254555b1c5f2216697d40f2658b0618fa4217))

## [1.34.7](https://github.com/bgill55/daedalus/compare/v1.34.6...v1.34.7) (2026-06-29)


### Bug Fixes

* enable alternate screen buffer for TUI so terminal is properly cleared and restored on /tui ([413eac4](https://github.com/bgill55/daedalus/commit/413eac449b74d1c994fb6d287d45299e3abb0d92))

## [1.34.6](https://github.com/bgill55/daedalus/compare/v1.34.5...v1.34.6) (2026-06-29)


### Bug Fixes

* prevent rl.close() from ending process.stdout so TUI renders on /tui mode switch ([bfb6e7d](https://github.com/bgill55/daedalus/commit/bfb6e7dc836ca3e801f6f7cf8a3ac35f3e41c49e))

## [1.34.5](https://github.com/bgill55/daedalus/compare/v1.34.4...v1.34.5) (2026-06-28)


### Bug Fixes

* call customStdout write callback manually without passing to originalStdoutWrite to prevent buffering hangs on Windows ([871488e](https://github.com/bgill55/daedalus/commit/871488ec514583a2f74411a8607aef77a382c55b))

## [1.34.4](https://github.com/bgill55/daedalus/compare/v1.34.3...v1.34.4) (2026-06-28)


### Bug Fixes

* restore original stdout/stderr on main process catch ([cf5dc1b](https://github.com/bgill55/daedalus/commit/cf5dc1b496c87a6899f05161312f21ca86fef0bf))

## [1.34.3](https://github.com/bgill55/daedalus/compare/v1.34.2...v1.34.3) (2026-06-28)


### Bug Fixes

* remove manual callback invocation from customStdout stream to prevent ERR_MULTIPLE_CALLBACK crash ([ce083ab](https://github.com/bgill55/daedalus/commit/ce083ab28248ff26f4128fbf9e24fc3588a02612))

## [1.34.2](https://github.com/bgill55/daedalus/compare/v1.34.1...v1.34.2) (2026-06-28)


### Bug Fixes

* cast customStdout stream to any to resolve screen output type check error ([b241dd4](https://github.com/bgill55/daedalus/commit/b241dd40b22a38ac6f35a5d2cba45a842fbdb6d1))
* resolve infinite stdout write loop by introducing custom output stream wrapper for Blessed screen ([31340c7](https://github.com/bgill55/daedalus/commit/31340c7931830a79056c3b34470bf2971baa7ce7))

## [1.34.1](https://github.com/bgill55/daedalus/compare/v1.34.0...v1.34.1) (2026-06-28)


### Bug Fixes

* ensure readline interface is closed when exiting CLI REPL loop to prevent stdin lockups in TUI mode ([94da03c](https://github.com/bgill55/daedalus/commit/94da03c29e8e5bf8beda9bfa9574464ebfe64d40))

# [1.34.0](https://github.com/bgill55/daedalus/compare/v1.33.1...v1.34.0) (2026-06-28)


### Features

* add /tui command to toggle between TUI and CLI modes dynamically ([1afde32](https://github.com/bgill55/daedalus/commit/1afde329fb61bf588e96a1bc27d80eec30dbd9b7))

## [1.33.1](https://github.com/bgill55/daedalus/compare/v1.33.0...v1.33.1) (2026-06-28)


### Bug Fixes

* resolve documentation out-of-sync test failures by updating sync script safety section and zod schema ([eeb137a](https://github.com/bgill55/daedalus/commit/eeb137a82f2961a4c02fd5e3e28aa2b7cd095d31))

# [1.33.0](https://github.com/bgill55/daedalus/compare/v1.32.3...v1.33.0) (2026-06-28)


### Features

* implement interactive terminal dashboard TUI layout with system stats, model selection override, and codebase file explorer ([34cc593](https://github.com/bgill55/daedalus/commit/34cc593189a79831860663136ac30c6886e42116))

## [1.32.3](https://github.com/bgill55/daedalus/compare/v1.32.2...v1.32.3) (2026-06-27)


### Bug Fixes

* **orchestrator:** filter think blocks from execution results before error parsing ([8a43c31](https://github.com/bgill55/daedalus/commit/8a43c3118035b1226f42ded35757069574a23a75))

## [1.32.2](https://github.com/bgill55/daedalus/compare/v1.32.1...v1.32.2) (2026-06-27)


### Bug Fixes

* **orchestrator:** allow up to 4 consecutive read-only turns after file write before early exit ([3cc7f2b](https://github.com/bgill55/daedalus/commit/3cc7f2b010d8e9d1d0549362ab042263d6ec044e))

## [1.32.1](https://github.com/bgill55/daedalus/compare/v1.32.0...v1.32.1) (2026-06-27)


### Bug Fixes

* **orchestrator:** relax vague goal validation regex to support natural planning wording ([96ec6f2](https://github.com/bgill55/daedalus/commit/96ec6f2ccbd001f2650349cdc964d2a1674e6eb1))

# [1.32.0](https://github.com/bgill55/daedalus/compare/v1.31.0...v1.32.0) (2026-06-27)


### Features

* add tech stack auto-scanning, todo checklist context, and model tier routing ([8ad7656](https://github.com/bgill55/daedalus/commit/8ad765693f6106387fc7132c61485db353a6ff27))

# [1.31.0](https://github.com/bgill55/daedalus/compare/v1.30.0...v1.31.0) (2026-06-27)


### Features

* add vscode-extension to .gitignore and fix guardrail backticks ([d48bb93](https://github.com/bgill55/daedalus/commit/d48bb9304549a3e2db96bc5434090058473b9655))
* add vscode-extension to .gitignore and fix guardrail formatting ([a40a615](https://github.com/bgill55/daedalus/commit/a40a61534f5fb38a749abbcfd4c8f1639552ade5))

# [1.30.0](https://github.com/bgill55/daedalus/compare/v1.29.0...v1.30.0) (2026-06-25)


### Features

* add git safety guard to prevent accidental deletion of git tracking data ([8828487](https://github.com/bgill55/daedalus/commit/88284872736a61a08c7736e3654c8352a31deaaf))

# [1.29.0](https://github.com/bgill55/daedalus/compare/v1.28.0...v1.29.0) (2026-06-25)


### Features

* auto-detect scaffold anti-patterns and verify work after patches ([981531a](https://github.com/bgill55/daedalus/commit/981531ae161c4b44060da38f627ec2af9c20bfa5))

# [1.28.0](https://github.com/bgill55/daedalus/compare/v1.27.1...v1.28.0) (2026-06-25)


### Bug Fixes

* satisfy strictPropertyInitialization for per-session projectRoot/projectHash ([7d9f008](https://github.com/bgill55/daedalus/commit/7d9f008d41ed8f8e4b1850ed3e6373ce8e4a56f5))


### Features

* make projectRoot and projectHash per-session; switch project contexts without restarting ([424fd8b](https://github.com/bgill55/daedalus/commit/424fd8b0404fb8f5b64b6629093e9df236f9858e))

## [1.27.1](https://github.com/bgill55/daedalus/compare/v1.27.0...v1.27.1) (2026-06-24)


### Bug Fixes

* prevent session auto-naming from using leaked system prompt text ([f06a493](https://github.com/bgill55/daedalus/commit/f06a493d4ac9956a91999573fcb73ecb82988535))

# [1.27.0](https://github.com/bgill55/daedalus/compare/v1.26.2...v1.27.0) (2026-06-24)


### Features

* per-session project root switching — `/session new <path>` and `/session load` restore isolated project contexts in a single CLI instance; session-scoped projectRoot is now the source of truth for file access and codebase indexing
* cleaner CLI formatting — user box, assistant header, tool start fix, shorter separator ([4e23d5b](https://github.com/bgill55/daedalus/commit/4e23d5be18eeae4abda35e8f00ef6bdf0a20c260))

## [1.26.2](https://github.com/bgill55/daedalus/compare/v1.26.1...v1.26.2) (2026-06-24)


### Bug Fixes

* MCP on Windows, startup ordering, piped stdin race, tool awareness in system prompt ([cd34b43](https://github.com/bgill55/daedalus/commit/cd34b4372f292a192cea07322a7012ece799438a))

## [1.26.1](https://github.com/bgill55/daedalus/compare/v1.26.0...v1.26.1) (2026-06-24)


### Bug Fixes

* preserve pending tasks when replan validation fails ([e744f5e](https://github.com/bgill55/daedalus/commit/e744f5e1c57ba7fe7e970964569ac01e2cf9e6a1))

# [1.26.0](https://github.com/bgill55/daedalus/compare/v1.25.0...v1.26.0) (2026-06-24)


### Features

* Sprint 2-4 — retry, resume, concurrency, debug cleanup ([d795479](https://github.com/bgill55/daedalus/commit/d7954794b6a13f3e9f63407eea33cf92c3874a61))

# [1.25.0](https://github.com/bgill55/daedalus/compare/v1.24.1...v1.25.0) (2026-06-24)


### Features

* planner prompt rewrite, plan validation with retry, stronger coder content requirements ([e695858](https://github.com/bgill55/daedalus/commit/e695858d7175cc96d4bdbc7125809e461676c0f5))

## [1.24.1](https://github.com/bgill55/daedalus/compare/v1.24.0...v1.24.1) (2026-06-24)


### Bug Fixes

* prompt for install commands, block coder from running tests/git, early-exit on idle turns ([2ce178a](https://github.com/bgill55/daedalus/commit/2ce178a8c158cfc733f00b4bba28f80cbd75bffc))

# [1.24.0](https://github.com/bgill55/daedalus/compare/v1.23.0...v1.24.0) (2026-06-24)


### Features

* improve orchestration reliability and model tool handling ([cbdd37f](https://github.com/bgill55/daedalus/commit/cbdd37fc9ffd6f9c43403ad51b10cf0934baa492))

# [1.23.0](https://github.com/bgill55/daedalus/compare/v1.22.7...v1.23.0) (2026-06-24)

### Features

* improve orchestration reliability and model tool handling ([414cfd6](https://github.com/bgill55/daedalus/commit/414cfd64ecdb21d4371ac352c6cf7126fe783fca))

## [1.22.7](https://github.com/bgill55/daedalus/compare/v1.22.6...v1.22.7) (2026-06-23)

### Bug Fixes

* require real patch evidence for artifact verification ([453d47f](https://github.com/bgill55/daedalus/commit/453d47fc117f1a96f7c2044e22dfacbddc0133d2))
* improve orchestration reliability with model-agnostic tool call parsing and LM Studio custom tool block fallback ([6f5e78a](https://github.com/bgill55/daedalus/commit/6f5e78a))
* prevent task deduplication loops in re-planning and task-split paths by filtering completed file targets ([9a12b4c](https://github.com/bgill55/daedalus/commit/9a12b4c))
* raise coder agent maxTurns to 4 to allow exploration, write, and self-correction within a single task ([d4e8f1a](https://github.com/bgill55/daedalus/commit/d4e8f1a))
* improve artifact verification so hasRealWrites checks patch history instead of pre-existing file state ([b7c2e9d](https://github.com/bgill55/daedalus/commit/b7c2e9d))

## [1.22.6](https://github.com/bgill55/daedalus/compare/v1.22.5...v1.22.6) (2026-06-23)


### Bug Fixes

* deduplicate coder tasks by file path and block GUI test runners from plans ([3c156c3](https://github.com/bgill55/daedalus/commit/3c156c3baccc617e5075dbbf668fb71a20bab703))

## [1.22.5](https://github.com/bgill55/daedalus/compare/v1.22.4...v1.22.5) (2026-06-23)


### Bug Fixes

* block GUI app launchers (cypress/playwright) from terminal tool ([de02e1e](https://github.com/bgill55/daedalus/commit/de02e1e0bec9fc8e445cd755edeb7e32d80dc7c1))

## [1.22.4](https://github.com/bgill55/daedalus/compare/v1.22.3...v1.22.4) (2026-06-23)


### Bug Fixes

* improve orchestrate planner reliability and watchdog behavior ([81de52e](https://github.com/bgill55/daedalus/commit/81de52e5266a7a2737c9278cefb41dea9e2c740e))

## [1.22.3](https://github.com/bgill55/daedalus/compare/v1.22.2...v1.22.3) (2026-06-23)


### Bug Fixes

* enforce file-scope boundaries in orchestration, add /exit aliases, gate npm install commands ([744e035](https://github.com/bgill55/daedalus/commit/744e0358075aaeb3833923cdce491ddecce99c4e))

## [1.22.2](https://github.com/bgill55/daedalus/compare/v1.22.1...v1.22.2) (2026-06-23)


### Bug Fixes

* handle model refusal in agent tool calls and auto-retry in failure checkpoint ([3e3f6ae](https://github.com/bgill55/daedalus/commit/3e3f6aea8e4fd5770eed195501a080ff30c4fd11))

## [1.22.1](https://github.com/bgill55/daedalus/compare/v1.22.0...v1.22.1) (2026-06-23)


### Bug Fixes

* resolve orchestrator delegateTask test failure and clean up all lint warnings ([9c6ed59](https://github.com/bgill55/daedalus/commit/9c6ed59012283e40da97209dd6f6376fd1220fca))
* restore DiffOptions type import in files.ts ([3243f31](https://github.com/bgill55/daedalus/commit/3243f31e86998878d9f241e5555c03214f676e72))

# [1.22.0](https://github.com/bgill55/daedalus/compare/v1.21.5...v1.22.0) (2026-06-23)


### Features

* add self-improvement via failure lessons and reviewer role ([9c1ad7f](https://github.com/bgill55/daedalus/commit/9c1ad7fe8e792bef92bd51d57a7124adef40df32))

## [1.21.5](https://github.com/bgill55/daedalus/compare/v1.21.4...v1.21.5) (2026-06-23)


### Bug Fixes

* **patch:** add line-level error attribution so pre-existing TS errors don't block edits ([6437331](https://github.com/bgill55/daedalus/commit/64373312239318a6f9dcfa165a319ebb47c069d0))

## [1.21.4](https://github.com/bgill55/daedalus/compare/v1.21.3...v1.21.4) (2026-06-22)


### Bug Fixes

* **orchestrator:** break patch retry spirals with per-file failure cap; improve diff-ui input handling ([fed4175](https://github.com/bgill55/daedalus/commit/fed41756c9ff547cd392e1fc203f4e71cc850ded))

## [1.21.3](https://github.com/bgill55/daedalus/compare/v1.21.2...v1.21.3) (2026-06-22)


### Bug Fixes

* per-task auto-approve, diff-ui hang, patch root-cause protections ([bdb910d](https://github.com/bgill55/daedalus/commit/bdb910d0beaf34eef76e336f099dc97609f1ae52))

## [1.21.2](https://github.com/bgill55/daedalus/compare/v1.21.1...v1.21.2) (2026-06-22)


### Bug Fixes

* **patch:** only flag TS errors in the patched file, not the whole project ([e73fac3](https://github.com/bgill55/daedalus/commit/e73fac3ec425cdbbebbbd4c565c036ae012f912a))

## [1.21.1](https://github.com/bgill55/daedalus/compare/v1.21.0...v1.21.1) (2026-06-22)


### Bug Fixes

* **index:** treat direct action requests as execute, not outline ([14c0ea3](https://github.com/bgill55/daedalus/commit/14c0ea3b1e99430719af89c08849ca4418eec8eb))

# [1.21.0](https://github.com/bgill55/daedalus/compare/v1.20.0...v1.21.0) (2026-06-22)


### Features

* **orchestrator:** harden artifact verification against fake agent reports; tighten success checks and update system prompt persona ([aa2fc6d](https://github.com/bgill55/daedalus/commit/aa2fc6d646a6c3d9e78a39c2e6d064b0720d628e))

# [1.20.0](https://github.com/bgill55/daedalus/compare/v1.19.0...v1.20.0) (2026-06-22)


### Features

* **prompts:** restore and sharpen dry humor and wit in system prompts ([f996641](https://github.com/bgill55/daedalus/commit/f996641db1dfac20b1609bc218976be45ad0a255))

# [1.19.0](https://github.com/bgill55/daedalus/compare/v1.18.1...v1.19.0) (2026-06-22)


### Features

* bypass proceed gate on tool execution failure to enable autonomous error recovery ([e23d3e9](https://github.com/bgill55/daedalus/commit/e23d3e9d4d5d375e917344eb069803d3e8b917cc))

## [1.18.1](https://github.com/bgill55/daedalus/compare/v1.18.0...v1.18.1) (2026-06-22)


### Bug Fixes

* parse raw JSON first during fact extraction to avoid cleaning corruption ([5c94fde](https://github.com/bgill55/daedalus/commit/5c94fdef70bf7a18d26feb14332cdbaab508e86c))

# [1.18.0](https://github.com/bgill55/daedalus/compare/v1.17.0...v1.18.0) (2026-06-22)


### Features

* /mcp command — discover, install, and manage MCP servers from the REPL ([60eb672](https://github.com/bgill55/daedalus/commit/60eb67262bdbd7056e8adc714cbfcb11f5bce563))

# [1.17.0](https://github.com/bgill55/daedalus/compare/v1.16.0...v1.17.0) (2026-06-22)


### Features

* context summarization, faster startup, faster patching, cleaner UI ([62df67a](https://github.com/bgill55/daedalus/commit/62df67a56c4f520ece2fd1488ffbb8ec192c77a2))

# [1.16.0](https://github.com/bgill55/daedalus/compare/v1.15.0...v1.16.0) (2026-06-21)


### Features

* display documentation repository link in help output and startup banner ([e904f55](https://github.com/bgill55/daedalus/commit/e904f55f6d0ffddb61fa81c5090da25da66a3e1f))
* **context:** LLM-based conversation summarization before hard pruning
* **startup:** fire-and-forget health checks and MCP connections for instant REPL prompt
* **patching:** chunk-based hash pre-filter for faster Levenshtein in findClosestBlock
* **ui:** compact aligned CLI output with subtle metadata and consistent indentation

# [1.15.0](https://github.com/bgill55/daedalus/compare/v1.14.1...v1.15.0) (2026-06-21)


### Features

* add automatic session descriptive naming and manual rename subcommand ([fd144c8](https://github.com/bgill55/daedalus/commit/fd144c8c0f42527d22865511d7a42e8371385a8e))

## [1.14.1](https://github.com/bgill55/daedalus/compare/v1.14.0...v1.14.1) (2026-06-21)


### Bug Fixes

* **cli:** prepend slash to orchestrate aliases so they are parsed correctly as commands ([60fafe3](https://github.com/bgill55/daedalus/commit/60fafe30aefe6f9651ffcadd814de7b1890af91b))

# [1.14.0](https://github.com/bgill55/daedalus/compare/v1.13.0...v1.14.0) (2026-06-21)


### Features

* **cli:** add short aliases 'orc', 'run', 'o' for /orchestrate command ([b6eece9](https://github.com/bgill55/daedalus/commit/b6eece98ec27a05d11d037fafc93d1b2852169c2))

# [1.13.0](https://github.com/bgill55/daedalus/compare/v1.12.0...v1.13.0) (2026-06-21)


### Features

* **cli:** add /changelog command and automatic upgrade notes display ([6c9a607](https://github.com/bgill55/daedalus/commit/6c9a6075c1c7db20ecc2cb4396de2006eb401392))

# [1.12.0](https://github.com/bgill55/daedalus/compare/v1.11.0...v1.12.0) (2026-06-21)


### Features

* **orchestration:** add interactive task checklist, failure checkpoints, state resume, and planner sizing rules ([19ebe8d](https://github.com/bgill55/daedalus/commit/19ebe8d9776f621c564f9ecba5342058f9936aef))

# [1.11.0](https://github.com/bgill55/daedalus/compare/v1.10.1...v1.11.0) (2026-06-21)


### Features

* implement resumable, gated orchestration and single-agent proceed checkpoints ([d6c48b9](https://github.com/bgill55/daedalus/commit/d6c48b994d31966a86cd2b84f71b4d6cb64ba8e0))

## [1.10.1](https://github.com/bgill55/daedalus/compare/v1.10.0...v1.10.1) (2026-06-20)


### Bug Fixes

* **orchestrator:** airtight artifact verification; enforce planner delegation format ([756640d](https://github.com/bgill55/daedalus/commit/756640dc280c85f742c4e2a99bf22c677ab6fc98))

# [1.10.0](https://github.com/bgill55/daedalus/compare/v1.9.7...v1.10.0) (2026-06-20)


### Features

* **roles:** add instructions for tool error handling, imports, global fetch, and tsconfig ([1c7845c](https://github.com/bgill55/daedalus/commit/1c7845c5f29394719f2db8503e890a823db43536))

## [1.9.7](https://github.com/bgill55/daedalus/compare/v1.9.6...v1.9.7) (2026-06-20)


### Bug Fixes

* **extraction:** robustly parse relaxed JSON in fact extraction ([eceae9f](https://github.com/bgill55/daedalus/commit/eceae9f7d64d22647583cc05e4d8b98665206ad8))

## [1.9.6](https://github.com/bgill55/daedalus/compare/v1.9.5...v1.9.6) (2026-06-20)


### Bug Fixes

* **orchestrator:** add spinners during task delegation and print full un-sliced summaries ([0a6205d](https://github.com/bgill55/daedalus/commit/0a6205d31e531cb1ad95a2bb90b415bc1f2fbf4c))

## [1.9.5](https://github.com/bgill55/daedalus/compare/v1.9.4...v1.9.5) (2026-06-20)


### Bug Fixes

* **orchestrator:** normalize file path separators for verifyArtifacts on Windows ([db972d8](https://github.com/bgill55/daedalus/commit/db972d83f7a1e3a0d59d4a2574ce06e2617352d7))

## [1.9.4](https://github.com/bgill55/daedalus/compare/v1.9.3...v1.9.4) (2026-06-20)


### Bug Fixes

* **orchestrator:** implement turn-level cancellation and abort task loops on SIGINT ([8e489e2](https://github.com/bgill55/daedalus/commit/8e489e2967ddb221702e7244561d1aa343d022ff))

## [1.9.3](https://github.com/bgill55/daedalus/compare/v1.9.2...v1.9.3) (2026-06-20)


### Bug Fixes

* **files:** push to patchHistory when creating new files with write_file ([9135fa3](https://github.com/bgill55/daedalus/commit/9135fa3944694814da0ec69116e3685c48310564))

## [1.9.2](https://github.com/bgill55/daedalus/compare/v1.9.1...v1.9.2) (2026-06-20)


### Bug Fixes

* **orchestrator:** implement artifact verification guardrails and repair loops ([71e5848](https://github.com/bgill55/daedalus/commit/71e58486a90d206d3d90b9f49d12acadae2429b8))

## [1.9.1](https://github.com/bgill55/daedalus/compare/v1.9.0...v1.9.1) (2026-06-20)


### Bug Fixes

* restore process.stdin stream flow on Windows after child process executions ([ba2743a](https://github.com/bgill55/daedalus/commit/ba2743a44a8aec92798fc9501687ab8384d52d5b))

# [1.9.0](https://github.com/bgill55/daedalus/compare/v1.8.1...v1.9.0) (2026-06-20)


### Features

* implement documented /session command ([63f4961](https://github.com/bgill55/daedalus/commit/63f4961ddff7f4abc30d15f062471086a029ece7))

## [1.8.1](https://github.com/bgill55/daedalus/compare/v1.8.0...v1.8.1) (2026-06-20)


### Bug Fixes

* resolve keyboard lockout during visual diff approval ([8eb032d](https://github.com/bgill55/daedalus/commit/8eb032d35001d2a6c1818cf63cc0c976c90022bf))

# [1.8.0](https://github.com/bgill55/daedalus/compare/v1.7.5...v1.8.0) (2026-06-20)


### Features

* show a terminal spinner animation while tools are executing ([b7d8b14](https://github.com/bgill55/daedalus/commit/b7d8b1452c6741a7e834a4c4dfbae22622a88452))

## [1.7.5](https://github.com/bgill55/daedalus/compare/v1.7.4...v1.7.5) (2026-06-20)


### Bug Fixes

* ignore fs.watch error events to prevent unhandled process exit crashes on Windows ([360b353](https://github.com/bgill55/daedalus/commit/360b3536f0e7a7fc4cb668e88a72c80fcbeda88d))

## [1.7.4](https://github.com/bgill55/daedalus/compare/v1.7.3...v1.7.4) (2026-06-20)


### Bug Fixes

* **test:** close watcher inside afterEach to ensure clean teardown and prevent database accesses after closure ([07ef108](https://github.com/bgill55/daedalus/commit/07ef10888439a89b25c9c30b7ab1591c8416281b))

## [1.7.3](https://github.com/bgill55/daedalus/compare/v1.7.2...v1.7.3) (2026-06-20)


### Bug Fixes

* **test:** resolve macOS FSEvents latency and Windows file locking in watcher tests ([d02764b](https://github.com/bgill55/daedalus/commit/d02764b00a11bac030b146c0af590d28e3c51778))

## [1.7.2](https://github.com/bgill55/daedalus/compare/v1.7.1...v1.7.2) (2026-06-20)


### Bug Fixes

* **test:** add explicit RouterConfig type to avoid widened type inference of strategy property ([30b93a9](https://github.com/bgill55/daedalus/commit/30b93a95ff364c6e97b89c0c5573329366d1506c))

## [1.7.1](https://github.com/bgill55/daedalus/compare/v1.7.0...v1.7.1) (2026-06-20)


### Bug Fixes

* register /help command and map help and ? to it ([92bcc13](https://github.com/bgill55/daedalus/commit/92bcc139c13ff27826d81ccec6fb4eb8d162e890))

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
