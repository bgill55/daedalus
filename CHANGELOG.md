## [3.18.3](https://github.com/bgill55/daedalus/compare/v3.18.2...v3.18.3) (2026-08-07)


### Bug Fixes

* **diff-ui:** ignore leading whitespace in raw keypress mode so pasted text does not reject patches ([5c2a1db](https://github.com/bgill55/daedalus/commit/5c2a1db7f960325570f35c44a852824ebbaddb9b))

## [3.18.2](https://github.com/bgill55/daedalus/compare/v3.18.1...v3.18.2) (2026-08-07)


### Bug Fixes

* **agent:** add atomic imports and type dependency guardrails ([3a43691](https://github.com/bgill55/daedalus/commit/3a436916cd757f3994c05b288aedb21aaf7500a6))

## [3.18.1](https://github.com/bgill55/daedalus/compare/v3.18.0...v3.18.1) (2026-08-07)


### Bug Fixes

* **agent:** prohibit re-proposing plans after user approval ([df8f760](https://github.com/bgill55/daedalus/commit/df8f76044503dad0dc337cddec733c4f7e71ce02))

# [3.18.0](https://github.com/bgill55/daedalus/compare/v3.17.3...v3.18.0) (2026-08-06)


### Bug Fixes

* **agent:** normalize tool arg aliases and prevent thinking block repetition loops ([638dc96](https://github.com/bgill55/daedalus/commit/638dc96aa362dd01c912133262a785157c46040f))
* **ci:** allow workflow_dispatch event in pr-title job condition ([f74e78f](https://github.com/bgill55/daedalus/commit/f74e78f16cd8d087f5dfca0a53db122f0becf99e))


### Features

* **commands:** add model selection/switching to /model command ([dc36ed2](https://github.com/bgill55/daedalus/commit/dc36ed22a6c04e3375cedb1a2ea0c2ceddaa3d18))

## [3.17.3](https://github.com/bgill55/daedalus/compare/v3.17.2...v3.17.3) (2026-08-06)


### Bug Fixes

* **formatting:** parse pipe-style tool call syntax <|toolcall>call:func{...}<tool_call|> ([a4940cd](https://github.com/bgill55/daedalus/commit/a4940cd11424c6dc7574d9b488987932199ec5d8))

## [3.17.2](https://github.com/bgill55/daedalus/compare/v3.17.1...v3.17.2) (2026-08-06)


### Bug Fixes

* **agent:** enforce client-server boundary and CSS/UI button wire-up rules ([a18e189](https://github.com/bgill55/daedalus/commit/a18e1893c049038c3f190bcb60cd8cb84b5edc0c))

## [3.17.1](https://github.com/bgill55/daedalus/compare/v3.17.0...v3.17.1) (2026-08-06)


### Bug Fixes

* **agent:** enforce clear plan headers and instant tool execution on proceed ([3f6aa1a](https://github.com/bgill55/daedalus/commit/3f6aa1af7dfac97793e8a5522e60ee8375d7e0b6))

# [3.17.0](https://github.com/bgill55/daedalus/compare/v3.16.1...v3.17.0) (2026-08-06)


### Features

* **commands:** add /model sync to expand an endpoint catalog into selectable models ([#66](https://github.com/bgill55/daedalus/issues/66)) ([c3136bf](https://github.com/bgill55/daedalus/commit/c3136bf5213922acac4ba56d436c0941fddab5e2))

## [3.16.1](https://github.com/bgill55/daedalus/compare/v3.16.0...v3.16.1) (2026-08-06)


### Bug Fixes

* **test:** isolate test config directory in config.test.ts ([8cd38f7](https://github.com/bgill55/daedalus/commit/8cd38f77345a28ad1d8f118c1aacd3a33b80d706))

# [3.16.0](https://github.com/bgill55/daedalus/compare/v3.15.7...v3.16.0) (2026-08-05)


### Features

* **config:** add router presets, minimal config, and interactive /preset and /model commands ([9a65336](https://github.com/bgill55/daedalus/commit/9a653363f5f3315e3404bd2b8485c4e33e19dfc0))

## [3.15.7](https://github.com/bgill55/daedalus/compare/v3.15.6...v3.15.7) (2026-08-05)


### Bug Fixes

* **tools:** surface all introduced type errors + nested-import hint in patch validation ([#65](https://github.com/bgill55/daedalus/issues/65)) ([8126d9d](https://github.com/bgill55/daedalus/commit/8126d9d3f8e14b7ef3caf2f3aac8d304f35313f8))

## [3.15.6](https://github.com/bgill55/daedalus/compare/v3.15.5...v3.15.6) (2026-08-05)


### Bug Fixes

* **tools:** add terminal repeat circuit breaker for no-progress loops ([#64](https://github.com/bgill55/daedalus/issues/64)) ([6041a02](https://github.com/bgill55/daedalus/commit/6041a024d45b1a5837cad8409259908305225429))

## [3.15.5](https://github.com/bgill55/daedalus/compare/v3.15.4...v3.15.5) (2026-08-05)


### Bug Fixes

* **tools:** add terminal streak breaker, batch short-circuit, and actionable edit hints ([#62](https://github.com/bgill55/daedalus/issues/62)) ([6d7e605](https://github.com/bgill55/daedalus/commit/6d7e605d14a12ca6aea22e66d3a6992380e9788a))

## [3.15.4](https://github.com/bgill55/daedalus/compare/v3.15.3...v3.15.4) (2026-08-05)


### Bug Fixes

* **tools:** harden patch verification — block only real breaks, never env noise ([#61](https://github.com/bgill55/daedalus/issues/61)) ([26016c4](https://github.com/bgill55/daedalus/commit/26016c4c51d0b3c4e1ef7235ee6432e17cd47c84))

## [3.15.3](https://github.com/bgill55/daedalus/compare/v3.15.2...v3.15.3) (2026-08-05)


### Bug Fixes

* **tools:** stop false-reverting correct edits on module-resolution errors ([#60](https://github.com/bgill55/daedalus/issues/60)) ([2ffda6b](https://github.com/bgill55/daedalus/commit/2ffda6b7f5ee350c204e3b2c4f1f7cdb4963bed5))

## [3.15.2](https://github.com/bgill55/daedalus/compare/v3.15.1...v3.15.2) (2026-08-05)


### Bug Fixes

* **terminal:** restore canonical mode on every exit path so Ctrl+C/keys work ([#59](https://github.com/bgill55/daedalus/issues/59)) ([36f419f](https://github.com/bgill55/daedalus/commit/36f419f5397631131ee80a136d1c7e22ac40ca1b))

## [3.15.1](https://github.com/bgill55/daedalus/compare/v3.15.0...v3.15.1) (2026-08-05)


### Bug Fixes

* **agents:** block false 'task complete' reports while todos remain open ([#58](https://github.com/bgill55/daedalus/issues/58)) ([e7435ee](https://github.com/bgill55/daedalus/commit/e7435eee47eb27f5ffb95eca0a1e24525a7879e4))

# [3.15.0](https://github.com/bgill55/daedalus/compare/v3.14.2...v3.15.0) (2026-08-04)


### Features

* **skills:** add /skills command to review and approve agent-proposed skill drafts (bidirectional loop, part 2) ([#55](https://github.com/bgill55/daedalus/issues/55)) ([8053c2c](https://github.com/bgill55/daedalus/commit/8053c2c4104fd43d5c9cb48aa54be230e9e303c5))
* **skills:** agent can propose learned skills as inactive drafts (bidirectional loop, part 1) ([#54](https://github.com/bgill55/daedalus/issues/54)) ([3a44c49](https://github.com/bgill55/daedalus/commit/3a44c49c5a1a10d3ec80533f44cb663e80c83dbd))

## [3.14.2](https://github.com/bgill55/daedalus/compare/v3.14.1...v3.14.2) (2026-08-04)


### Bug Fixes

* **tools:** centralize crash-hardened process spawning in src/utils/spawn.ts ([#50](https://github.com/bgill55/daedalus/issues/50)) ([4e3b864](https://github.com/bgill55/daedalus/commit/4e3b864a575457574bcaf3ddc215874c9f0b66f9))

## [3.14.1](https://github.com/bgill55/daedalus/compare/v3.14.0...v3.14.1) (2026-08-04)


### Bug Fixes

* **skills:** prefer 'npm run build' over 'npx tsc' in fix-typescript-build skill ([#46](https://github.com/bgill55/daedalus/issues/46)) ([532cb43](https://github.com/bgill55/daedalus/commit/532cb430250100d3de53c21b02970046c0daff98))

# [3.14.0](https://github.com/bgill55/daedalus/compare/v3.13.3...v3.14.0) (2026-08-04)


### Features

* **skills:** merge load-only skill system + add skills documentation ([#44](https://github.com/bgill55/daedalus/issues/44)) ([f0c0060](https://github.com/bgill55/daedalus/commit/f0c0060f9d20c6b8a3c76fb23887f13513a51612))

## [3.13.3](https://github.com/bgill55/daedalus/compare/v3.13.2...v3.13.3) (2026-08-04)


### Bug Fixes

* **tools:** spawn terminal child detached with stdin ignored to stop Windows 0xC0000142 crashes ([#42](https://github.com/bgill55/daedalus/issues/42)) ([6839a4d](https://github.com/bgill55/daedalus/commit/6839a4de46e7fdf167febef3823ca9bafd1cfd5d))

## [3.13.2](https://github.com/bgill55/daedalus/compare/v3.13.1...v3.13.2) (2026-08-04)


### Bug Fixes

* **router:** keep build-fix / refactor / multi-file tasks on the intelligence tier ([#41](https://github.com/bgill55/daedalus/issues/41)) ([6d89e9c](https://github.com/bgill55/daedalus/commit/6d89e9c5cbd3dc33870a409b12c530bc743b5062))

## [3.13.1](https://github.com/bgill55/daedalus/compare/v3.13.0...v3.13.1) (2026-08-04)


### Bug Fixes

* **tools:** prevent false-revert of valid edits on lines with pre-existing errors ([#40](https://github.com/bgill55/daedalus/issues/40)) ([ce2cc8b](https://github.com/bgill55/daedalus/commit/ce2cc8bdc253afaae8dc4f040606c6744e6d7169))

# [3.13.0](https://github.com/bgill55/daedalus/compare/v3.12.0...v3.13.0) (2026-08-04)


### Features

* **commands:** add /spinner command to list and switch thinking-spinner on the fly ([#39](https://github.com/bgill55/daedalus/issues/39)) ([94494d9](https://github.com/bgill55/daedalus/commit/94494d9d84f9704a0b7127bd65943b8f7a2095c7))

# [3.12.0](https://github.com/bgill55/daedalus/compare/v3.11.3...v3.12.0) (2026-08-04)


### Features

* **ui:** add tracker and aurora thinking-spinner styles (user-selectable) ([#38](https://github.com/bgill55/daedalus/issues/38)) ([add2294](https://github.com/bgill55/daedalus/commit/add229438ced588036a11df108bc0cc9cdc848e5))

## [3.11.3](https://github.com/bgill55/daedalus/compare/v3.11.2...v3.11.3) (2026-08-04)


### Bug Fixes

* robust syntax check and keep refactor turns on intelligence tier ([#37](https://github.com/bgill55/daedalus/issues/37)) ([68a0a75](https://github.com/bgill55/daedalus/commit/68a0a75761399db0a1edbf9f1b689f7629fe86a7))

## [3.11.2](https://github.com/bgill55/daedalus/compare/v3.11.1...v3.11.2) (2026-08-04)


### Bug Fixes

* **agent:** also suppress escalation on patch circuit-breaker loops ([#36](https://github.com/bgill55/daedalus/issues/36)) ([8f5f968](https://github.com/bgill55/daedalus/commit/8f5f968c9e07d48feb832f26f985db00ea6e22b3)), closes [#35](https://github.com/bgill55/daedalus/issues/35)

## [3.11.1](https://github.com/bgill55/daedalus/compare/v3.11.0...v3.11.1) (2026-08-04)


### Bug Fixes

* **agent:** recover from syntax-error-revert loops without model escalation ([#35](https://github.com/bgill55/daedalus/issues/35)) ([0608ccb](https://github.com/bgill55/daedalus/commit/0608ccbfffed4bdaaf4e89d6d2d29b3b130ad4a2))

# [3.11.0](https://github.com/bgill55/daedalus/compare/v3.10.1...v3.11.0) (2026-08-04)


### Features

* **spinner:** visible braille 'thinking' indicator with min-duration ([#34](https://github.com/bgill55/daedalus/issues/34)) ([2d36d92](https://github.com/bgill55/daedalus/commit/2d36d920691ae5efb2640af73617da1908591a13))

## [3.10.1](https://github.com/bgill55/daedalus/compare/v3.10.0...v3.10.1) (2026-08-04)


### Bug Fixes

* **ci:** graceful skip when no model servers are reachable in PR review ([#33](https://github.com/bgill55/daedalus/issues/33)) ([9439157](https://github.com/bgill55/daedalus/commit/9439157c845f0ac55df269876aa10f60c7f64d4a))

# [3.10.0](https://github.com/bgill55/daedalus/compare/v3.9.1...v3.10.0) (2026-08-03)


### Features

* **ci:** deterministic static PR checks + full-coverage AI review ([#30](https://github.com/bgill55/daedalus/issues/30)) ([49523c3](https://github.com/bgill55/daedalus/commit/49523c31a990ad57e228b5520487e5458f77fb42)), closes [22/#25](https://github.com/bgill55/daedalus/issues/25)

## [3.9.1](https://github.com/bgill55/daedalus/compare/v3.9.0...v3.9.1) (2026-08-03)


### Bug Fixes

* **config:** register blacklist TTL/persist in schema and sync API-doc reference ([#29](https://github.com/bgill55/daedalus/issues/29)) ([d70f115](https://github.com/bgill55/daedalus/commit/d70f115ffdc91b915fcc05d02207ec1064428c84))

# [3.9.0](https://github.com/bgill55/daedalus/compare/v3.8.0...v3.9.0) (2026-08-03)


### Features

* **router:** persist model blacklist to SQLite with TTL decay ([#27](https://github.com/bgill55/daedalus/issues/27)) ([e1e7fcb](https://github.com/bgill55/daedalus/commit/e1e7fcb5a796ea773130ba4f2f417e0748150766))

# [3.8.0](https://github.com/bgill55/daedalus/compare/v3.7.3...v3.8.0) (2026-08-03)


### Features

* **router:** structured routing-decision log + history in /routing ([#25](https://github.com/bgill55/daedalus/issues/25)) ([ad31142](https://github.com/bgill55/daedalus/commit/ad311429710cc0e01466a986ecbc567e756a4982))

## [3.7.3](https://github.com/bgill55/daedalus/compare/v3.7.2...v3.7.3) (2026-08-03)


### Bug Fixes

* clean up CI PR review comments and validate PR titles ([#23](https://github.com/bgill55/daedalus/issues/23)) ([78717bd](https://github.com/bgill55/daedalus/commit/78717bdc36e82338bb9436fff910421b47a06eb8))

## [3.7.2](https://github.com/bgill55/daedalus/compare/v3.7.1...v3.7.2) (2026-08-03)


### Bug Fixes

* remove stray debug file and trigger release of Phase 1-3 changes ([0fea254](https://github.com/bgill55/daedalus/commit/0fea254bd9720ef87a1565d70b3808796ea795f2))

## [3.7.1](https://github.com/bgill55/daedalus/compare/v3.7.0...v3.7.1) (2026-08-03)


### Bug Fixes

* **router:** skip failed pinned models on retry and cap cascade downgrades ([65c0f3d](https://github.com/bgill55/daedalus/commit/65c0f3df54a200d619141603d708f67602532a0a))

# [3.7.0](https://github.com/bgill55/daedalus/compare/v3.6.0...v3.7.0) (2026-08-03)


### Features

* **transparency:** surface tier reclassifications and tool failure details ([62f0ecf](https://github.com/bgill55/daedalus/commit/62f0ecfc35b236df927a5719c02222d60d3907cd))

# [3.6.0](https://github.com/bgill55/daedalus/compare/v3.5.0...v3.6.0) (2026-08-03)

This release bundles 15 commits of reliability work from the `beta` branch: weak models finally execute tools instead of narrating them, escalation actually fires, memory accumulates in every session, and patches stop silently breaking unrelated files.

### Features

* **Executes narrated tool plans from weak models** — models that answer with a bracket-style plan like `[listfiles, gitstatus, readfile(path="package.json")]` now have that plan converted into real tool calls, with alias resolution (`listfiles` → `list_files`) against the tool registry.
* **Behavior-based escalation** — when a model names three or more tools in a turn but calls none, the task escalates to a stronger model instead of waiting for a token counter that never grows. Audit/todo-list style requests ("give me a todo list", "what needs fixing", "audit the project") route to the complex tier up front.
* **Language-independent complexity routing** — prompts with two or more sentences classify as complex regardless of phrasing or trigger words, so natural wording ("look at the project, tell me what's wrong, fix the worst issues") gets the intelligence tier instead of a weak model.
* **On-the-fly re-routing mid-task** — `reclassifyTurn` re-evaluates complexity live using real signals (token growth, tool failures, trivial turns) with hysteresis, and the cumulative token ratchet resets on tier downgrade to stop complex/standard oscillation.
* **Sigma-Mem in every session** — the Sigma-Mem memory engine now records verified knowledge from ordinary single-agent sessions (test commands, build rules, file conventions), not just `/autopilot` orchestration. Memories are scored, decayed, and injected into future prompts.
* **Model-tier footer tags and ROUTE telemetry** — routing decisions are visible per task with the model tier on the turn footer and a `[ROUTE]` summary.

### Fixes

* **Cross-file patch breakage caught at the source** — `syntaxCheck` now diffs `tsc --noEmit` output against a cached per-tsconfig baseline, so a patch that type-breaks an unrelated file is flagged immediately instead of passing silently or causing false reverts on pre-existing errors.
* **Never-escalates bug** — providers that don't stream `completion_tokens` (e.g. the FreeLLMAPI proxy) left the escalation ratchet and trivial-turn detection dead at `0 out`. A content-length fallback revives both, and the footer now shows real token counts.
* **Explicit intent required before writing pasted code** — the heuristic that auto-wrote any pasted code block when a file path appeared anywhere in the text is removed; only an explicit `use the write_file tool to create <path>` intent writes. Audits and TODO requests present findings and ask before implementing.
* **Single-model configs are safe** — tier filtering and escalation bypass cleanly when a chain has exactly one model.
* **Configuration reference repaired** — container keys no longer pollute the General Settings section, `(Description needed)` placeholders stopped clobbering real descriptions, and missing entries (`version`, `ui.compactMode`, `ui.collapseCommentary`) were added.

### Developer Notes

* `RouterConfigSchema` gains `autoEscalate` and `complexityRouting` (both default `true`); see `docs/routing-and-tuning.md`.
* Verbose ROUTE logging suppressed; tool-starvation triggers retry.

Verified: 577 tests passing, lint clean, `tsc --noEmit` clean, CI green on Windows/macOS/Ubuntu.

# [3.5.0](https://github.com/bgill55/daedalus/compare/v3.4.0...v3.5.0) (2026-08-02)


### Features

* **router:** auto-escalate to next model after repeated tool failures ([a27496b](https://github.com/bgill55/daedalus/commit/a27496b89b27dc5ff2e228c372b69645181c44a2))

# [3.4.0](https://github.com/bgill55/daedalus/compare/v3.3.5...v3.4.0) (2026-08-02)


### Features

* **model:** print todo progress in single-agent mode ([93df6c1](https://github.com/bgill55/daedalus/commit/93df6c190f9caf9f21df608334e6537041e6261e))

## [3.3.5](https://github.com/bgill55/daedalus/compare/v3.3.4...v3.3.5) (2026-08-02)


### Bug Fixes

* **model:** surface tool errors to the agent to end blind retry spirals ([2a486ec](https://github.com/bgill55/daedalus/commit/2a486ec11622436001579e32ae65a6e19184c2a6))

## [3.3.4](https://github.com/bgill55/daedalus/compare/v3.3.3...v3.3.4) (2026-08-02)


### Bug Fixes

* **model:** break patch retry spirals via failure-signature tracking ([735f3cf](https://github.com/bgill55/daedalus/commit/735f3cff60bc92bea3ee6a3671ed2c5822f0c9ee))

## [3.3.3](https://github.com/bgill55/daedalus/compare/v3.3.2...v3.3.3) (2026-08-02)


### Bug Fixes

* **memory:** keep tool messages valid on session reload ([4f16d8a](https://github.com/bgill55/daedalus/commit/4f16d8a9e2cc52668918c45945abf3196e8c3fed))

## [3.3.2](https://github.com/bgill55/daedalus/compare/v3.3.1...v3.3.2) (2026-08-01)


### Bug Fixes

* **tools:** support directory paths in lsp_diagnostics and auto-initialize patchFailureStreak ([3bb92af](https://github.com/bgill55/daedalus/commit/3bb92affb70ef616e557caeea3428a6ca8aca136))

## [3.3.1](https://github.com/bgill55/daedalus/compare/v3.3.0...v3.3.1) (2026-08-01)


### Bug Fixes

* **test:** reset DaedalusSpinner stack in test teardown ([7eced60](https://github.com/bgill55/daedalus/commit/7eced601ec7a870f64dba794dbdb746867ed132d))
* **tools:** auto-translate POSIX rm on Windows and enforce circuit breaker on patch revert streaks ([9c995e2](https://github.com/bgill55/daedalus/commit/9c995e27e0410d9c07698070afe619ba967662d7))

# [3.3.0](https://github.com/bgill55/daedalus/compare/v3.2.1...v3.3.0) (2026-08-01)


### Features

* **agent:** harden tool loop, add git checkpoints and npx guards ([8b4b5b8](https://github.com/bgill55/daedalus/commit/8b4b5b8e45852dd735653cdf90f176d102a9f71b))

## [3.2.1](https://github.com/bgill55/daedalus/compare/v3.2.0...v3.2.1) (2026-08-01)


### Bug Fixes

* **memory:** route Sigma-Mem to the session DB instead of the index DB ([cd8c953](https://github.com/bgill55/daedalus/commit/cd8c953b714af81b4b257343756b05105cd418d7))

# [3.2.0](https://github.com/bgill55/daedalus/compare/v3.1.0...v3.2.0) (2026-08-01)


### Features

* **memory:** harden Sigma-Mem engine with dedup, tag retrieval, decay, and single-agent wiring ([dd7b14a](https://github.com/bgill55/daedalus/commit/dd7b14aa0f962454f333b741a10749a7d1cf91d0))

# [3.1.0](https://github.com/bgill55/daedalus/compare/v3.0.1...v3.1.0) (2026-08-01)


### Features

* **memory:** implement Sigma-Mem (Σ-Mem) reliable multi-agent memory engine ([8b2cb12](https://github.com/bgill55/daedalus/commit/8b2cb12428c3bf6f7cd1898b7d1c76886669fd58))

## [3.0.1](https://github.com/bgill55/daedalus/compare/v3.0.0...v3.0.1) (2026-07-31)


### Bug Fixes

* **bot:** strip <think> reasoning blocks in Discord bot responses ([b16345a](https://github.com/bgill55/daedalus/commit/b16345a52d2d9626ec81fe81198f5be3274c8bd1))

# [3.0.0](https://github.com/bgill55/daedalus/compare/v1.104.2...v3.0.0) (2026-07-31)

### Features

* **autopilot:** non-git auto-initialization, non-blocking zero-prompt npm installs, and `.daedalus/walkthrough.md` project isolation
* **engine:** tag-level `<svg>` CSS rules, fixed backdrop-blur modal overlays, and Express static path resolution
* **resilience:** `EISDIR` directory guards, 8k tool payload truncation (eliminating 413 errors), and pre-flight audit `TS18003` bypass
* **examples:** added PromptVault dark-mode glassmorphic web app benchmark demo in `examples/prompt-vault/`

## [1.104.2](https://github.com/bgill55/daedalus/compare/v1.104.1...v1.104.2) (2026-07-31)


### Bug Fixes

* **orchestrator:** cap sub-agent concurrency to max 2 parallel tasks to prevent 429 rate-limit storms ([af4717b](https://github.com/bgill55/daedalus/commit/af4717b5ea229bf9e7c1b5b49f52c4c000d51d57))

## [1.104.1](https://github.com/bgill55/daedalus/compare/v1.104.0...v1.104.1) (2026-07-31)


### Bug Fixes

* **router:** parse 429 rate limit backoff seconds and failover immediately on 400 invalid model errors ([baad8ec](https://github.com/bgill55/daedalus/commit/baad8eca3699e5aa1d806c44b37bf07dbf5efc7b))

# [1.104.0](https://github.com/bgill55/daedalus/compare/v1.103.0...v1.104.0) (2026-07-31)


### Features

* **architecture:** enforce DOM/CSS selector sync contract in SpecFirst and add cross-agent style reviewer gate ([b2be4ce](https://github.com/bgill55/daedalus/commit/b2be4ce7e23d7ab940169cbdaaf1341934bdda40))

# [1.103.0](https://github.com/bgill55/daedalus/compare/v1.102.0...v1.103.0) (2026-07-31)


### Features

* **agent:** mandate rich seed data, hero onboarding banners, and default dark glassmorphism styling for all generated web UIs ([360f8a3](https://github.com/bgill55/daedalus/commit/360f8a3b4501717e923c82f93547927b9a397c69))

# [1.102.0](https://github.com/bgill55/daedalus/compare/v1.101.0...v1.102.0) (2026-07-31)


### Features

* **ux:** format Autopilot Post-Mortem Report using native Daedalus divider styling ([3d632c3](https://github.com/bgill55/daedalus/commit/3d632c33671d1630df5daea0ae2b1cedfd2306e2))

# [1.101.0](https://github.com/bgill55/daedalus/compare/v1.100.3...v1.101.0) (2026-07-31)


### Features

* **autopilot:** add self-evaluating Autopilot Post-Mortem Diagnostic Report on rollback ([89bd146](https://github.com/bgill55/daedalus/commit/89bd146b2a0db1371376c23e21289dd6d470f13c))

## [1.100.3](https://github.com/bgill55/daedalus/compare/v1.100.2...v1.100.3) (2026-07-31)


### Bug Fixes

* **coder:** add single-file focus mandate to prevent sub-agent scope confusion during file creation ([8b9db91](https://github.com/bgill55/daedalus/commit/8b9db91d9b366e14226e62cbcd86357b4d857c37))

## [1.100.2](https://github.com/bgill55/daedalus/compare/v1.100.1...v1.100.2) (2026-07-31)


### Bug Fixes

* **cli:** enforce compact progress updates regardless of task list length ([804f4b0](https://github.com/bgill55/daedalus/commit/804f4b01b844037e713b371e91742270089bf64f))

## [1.100.1](https://github.com/bgill55/daedalus/compare/v1.100.0...v1.100.1) (2026-07-31)


### Bug Fixes

* **cli:** compact task list printing to prevent log spam and mandate strict tool execution for coder sub-agents ([f1299dc](https://github.com/bgill55/daedalus/commit/f1299dc2f4c4ef27360fe80d28804e171691f99f))

# [1.100.0](https://github.com/bgill55/daedalus/compare/v1.99.3...v1.100.0) (2026-07-31)


### Features

* **ux:** add animated DaedalusSpinner for third-party npm package installations ([77a631c](https://github.com/bgill55/daedalus/commit/77a631c99f949087c9ac1d280feac30dc9cf9935))

## [1.99.3](https://github.com/bgill55/daedalus/compare/v1.99.2...v1.99.3) (2026-07-31)


### Bug Fixes

* **verification:** enforce isRealFile check to prevent 30-byte placeholder comments from passing file existence checks ([109aaf4](https://github.com/bgill55/daedalus/commit/109aaf4ef49b977dcc34413e930c4eba199c47db))

## [1.99.2](https://github.com/bgill55/daedalus/compare/v1.99.1...v1.99.2) (2026-07-31)


### Bug Fixes

* **orchestration:** filter re-planned tasks by physical disk file existence instead of string matching ([ab3bae0](https://github.com/bgill55/daedalus/commit/ab3bae05ec2a5cc58394829ccf2611ca48eb3b58))

## [1.99.1](https://github.com/bgill55/daedalus/compare/v1.99.0...v1.99.1) (2026-07-31)


### Bug Fixes

* **verification:** track initialHistoryStartIndex in attemptRepair to correctly verify artifacts across repair passes ([c0e6aa2](https://github.com/bgill55/daedalus/commit/c0e6aa21a49794af16d87788cb10bfc6ba2d2c7e))

# [1.99.0](https://github.com/bgill55/daedalus/compare/v1.98.2...v1.99.0) (2026-07-31)


### Features

* **orchestration:** add pre-flight codebase audit and auto-repair task 0 for pre-existing errors ([c974797](https://github.com/bgill55/daedalus/commit/c97479700513e6d19c98e3ba207830f914a94848))

## [1.98.2](https://github.com/bgill55/daedalus/compare/v1.98.1...v1.98.2) (2026-07-31)


### Bug Fixes

* **verification:** ignore build failures in untouched files to prevent false-positive repair loops ([c11b4e5](https://github.com/bgill55/daedalus/commit/c11b4e5bff55479cf7090654e0db37a15a2f6892))

## [1.98.1](https://github.com/bgill55/daedalus/compare/v1.98.0...v1.98.1) (2026-07-31)


### Bug Fixes

* **orchestration:** truncate reviewer context to prevent 413 entity too large & decompose fallback tasks by file targets ([b0cfb50](https://github.com/bgill55/daedalus/commit/b0cfb507a77447d41debae7c1f2eaa31731fe95a))

# [1.98.0](https://github.com/bgill55/daedalus/compare/v1.97.3...v1.98.0) (2026-07-31)


### Features

* **orchestration:** auto-install missing npm packages during verification & sanitize tool path quotes ([4892b68](https://github.com/bgill55/daedalus/commit/4892b68605eca7244c187a1870dcff74da42342c))

## [1.97.3](https://github.com/bgill55/daedalus/compare/v1.97.2...v1.97.3) (2026-07-31)


### Bug Fixes

* **bot:** prioritize directly answering user questions in system prompt over canned opening greetings ([52bf801](https://github.com/bgill55/daedalus/commit/52bf801af5dc513ad26ac6eafd09823502a27cbf))

## [1.97.2](https://github.com/bgill55/daedalus/compare/v1.97.1...v1.97.2) (2026-07-30)


### Bug Fixes

* **sys-stats:** resolve Qodo review findings - replace df/wmic with fs.statfsSync, guard formatBytes against invalid ranges, and remove redundant JSDoc ([2350dc3](https://github.com/bgill55/daedalus/commit/2350dc3f39ce64f376756644cec35c9420c753b5))

## [1.97.1](https://github.com/bgill55/daedalus/compare/v1.97.0...v1.97.1) (2026-07-30)


### Bug Fixes

* **formatting:** add formatMarkdownPRReply helper to sanitize PR comments and automated review reports ([cb851f4](https://github.com/bgill55/daedalus/commit/cb851f423ede38d080c6cfc30bc5c8a36a43fc79))

# [1.97.0](https://github.com/bgill55/daedalus/compare/v1.96.0...v1.97.0) (2026-07-30)


### Features

* Add a system stats memory and disk usage utility in srcutilssysstatsts with unit tests ([d440f03](https://github.com/bgill55/daedalus/commit/d440f0301eab554d24b32ebc56dbfb32a76b3a91))
* **sys-stats:** add system memory and disk usage utility with SpecFirst contract ([f00defc](https://github.com/bgill55/daedalus/commit/f00defc8d65da658c7c2d66e460875abcb7d370e))

# [1.96.0](https://github.com/bgill55/daedalus/compare/v1.95.4...v1.96.0) (2026-07-30)


### Features

* **spec:** add SpecFirst architecture, spec contract generator, and verification engine ([336a2cb](https://github.com/bgill55/daedalus/commit/336a2cbfd4e7fba29883aec8a83cfceb17fc4e71))

## [1.95.4](https://github.com/bgill55/daedalus/compare/v1.95.3...v1.95.4) (2026-07-30)


### Bug Fixes

* **demo:** write exit to outer PowerShell so terminalizer saves recording automatically ([785017a](https://github.com/bgill55/daedalus/commit/785017afb5aab48c3a70f3ee752623f864639d42))

## [1.95.3](https://github.com/bgill55/daedalus/compare/v1.95.2...v1.95.3) (2026-07-30)


### Bug Fixes

* **demo:** add exit pause so terminalizer saves recording before PTY exits ([35c883b](https://github.com/bgill55/daedalus/commit/35c883bb7f6ba4fa89f5afe8817b803b0b1d2407))

## [1.95.2](https://github.com/bgill55/daedalus/compare/v1.95.1...v1.95.2) (2026-07-30)


### Bug Fixes

* **demo:** type all spec answers as single line, increase API wait pauses, drop loop from demo ([d10b1d8](https://github.com/bgill55/daedalus/commit/d10b1d8e76aa8b84590224f4fb421f66564f9406))

## [1.95.1](https://github.com/bgill55/daedalus/compare/v1.95.0...v1.95.1) (2026-07-30)


### Bug Fixes

* **demo:** use absolute paths in terminalizer.yml for Windows compatibility ([67e69cb](https://github.com/bgill55/daedalus/commit/67e69cbe2e52dcf1bbdc3f1e5d1239372dfa0fa4))

# [1.95.0](https://github.com/bgill55/daedalus/compare/v1.94.4...v1.95.0) (2026-07-30)


### Features

* **demo:** add terminalizer auto-typer demo recording setup for YouTube showcase ([7e58c31](https://github.com/bgill55/daedalus/commit/7e58c3184137a51eabef2bbfb0aa6cc432939c0f))

## [1.94.4](https://github.com/bgill55/daedalus/compare/v1.94.3...v1.94.4) (2026-07-30)


### Bug Fixes

* **docs:** resolve super-imposed code block labels and fix Docsify Mermaid rendering integration ([df942fe](https://github.com/bgill55/daedalus/commit/df942fe24bd8bee80c7aed9b6d368a142b934bf1))

## [1.94.3](https://github.com/bgill55/daedalus/compare/v1.94.2...v1.94.3) (2026-07-30)


### Bug Fixes

* **docs:** update Docsify Mermaid configuration to startOnLoad:false and quote message strings ([c5e3197](https://github.com/bgill55/daedalus/commit/c5e3197130040d93dfd36fa9c8e31a9700ae67ed))

## [1.94.2](https://github.com/bgill55/daedalus/compare/v1.94.1...v1.94.2) (2026-07-30)


### Bug Fixes

* **docs:** fix Mermaid sequence diagram syntax for Docsify rendering ([05cee21](https://github.com/bgill55/daedalus/commit/05cee21bd9cefb5461f6f334bdb431c08ef5c89c))

## [1.94.1](https://github.com/bgill55/daedalus/compare/v1.94.0...v1.94.1) (2026-07-30)


### Bug Fixes

* **ci:** prevent HTTP 422 Body cannot be blank when posting GitHub Action PR review comments ([12d5cc6](https://github.com/bgill55/daedalus/commit/12d5cc6acc992ec8dd8fa25f6a0ee9f5eaf367fa))

# [1.94.0](https://github.com/bgill55/daedalus/compare/v1.93.1...v1.94.0) (2026-07-30)


### Features

* **review:** add JSDoc contract mismatch and AGENTS.md comment rule audits to Reviewer agent, Self-Review Gate, and CI Reviewer ([2684a1c](https://github.com/bgill55/daedalus/commit/2684a1c19ac19826ba681f9b7c99d27361aa0347))

## [1.93.1](https://github.com/bgill55/daedalus/compare/v1.93.0...v1.93.1) (2026-07-30)


### Bug Fixes

* **loop:** auto-approve reviewer repair passes in loop mode and add DISCORD_LOOP_WEBHOOK_URL precedence ([5af4194](https://github.com/bgill55/daedalus/commit/5af4194cc50885f80717cf308f755461f7a33233))

# [1.93.0](https://github.com/bgill55/daedalus/compare/v1.92.1...v1.93.0) (2026-07-30)


### Features

* **bot:** add anti-repetition & banter variety guardrails to Discord bot prompt ([bbc0fcf](https://github.com/bgill55/daedalus/commit/bbc0fcfef58c8dadde154ab650180858e6779f89))

## [1.92.1](https://github.com/bgill55/daedalus/compare/v1.92.0...v1.92.1) (2026-07-30)


### Bug Fixes

* **bot:** chunk slash command interaction replies so long responses follow up without truncating mid-sentence ([8392e46](https://github.com/bgill55/daedalus/commit/8392e46b53b7461f48e47dfe933f79e21262c824))

# [1.92.0](https://github.com/bgill55/daedalus/compare/v1.91.0...v1.92.0) (2026-07-30)


### Features

* **bot:** dynamically inject current package version and recent changelog updates into Discord bot prompt ([3c0dd03](https://github.com/bgill55/daedalus/commit/3c0dd038eae8bf70f00da4e85a5e50c9d641960c))

# [1.91.0](https://github.com/bgill55/daedalus/compare/v1.90.0...v1.91.0) (2026-07-30)


### Bug Fixes

* **loop:** sanitize Discord embed payload, resolve webhook from env/config, and fallback PR URL lookup ([a0e912c](https://github.com/bgill55/daedalus/commit/a0e912c464fc2893f17d1418687a632bc7fb17a6))


### Features

* **config:** add FreeLLMAPI to DEFAULT_CONFIG and auto-discovery candidates ([0f07b5f](https://github.com/bgill55/daedalus/commit/0f07b5f5a9c1790c8b71f8803430b7ee6fa91b75))

# [1.90.0](https://github.com/bgill55/daedalus/compare/v1.89.0...v1.90.0) (2026-07-29)


### Features

* add /shortcut command for custom slash-command aliases ([9e83e46](https://github.com/bgill55/daedalus/commit/9e83e46d2825856a30611322ff145ee6d07d1c95))

# [1.89.0](https://github.com/bgill55/daedalus/compare/v1.88.0...v1.89.0) (2026-07-29)


### Features

* add /badge command for automatic and custom Shields.io badges (closes [#12](https://github.com/bgill55/daedalus/issues/12)) ([2075122](https://github.com/bgill55/daedalus/commit/2075122ef0e6b6a6b0c16e078e495db372405ce8))

# [1.88.0](https://github.com/bgill55/daedalus/compare/v1.87.0...v1.88.0) (2026-07-29)


### Features

* add headless CI/CD PR reviewer (daedalus --ci), /ci command, and GitHub Action workflow template ([bfd0488](https://github.com/bgill55/daedalus/commit/bfd0488d6cfb9d40b2f4f210a855f4d50e2796f2))
* add headless CI/CD PR reviewer (daedalus --ci), /ci command, and GitHub Action workflow template ([1a0f734](https://github.com/bgill55/daedalus/commit/1a0f73498cec750f99aa00f1301578a338a21d5c))

# [1.87.0](https://github.com/bgill55/daedalus/compare/v1.86.3...v1.87.0) (2026-07-29)


### Features

* add AST-aware call graph (/callgraph), impact engine (/impact), and get_call_graph tool ([6f722e6](https://github.com/bgill55/daedalus/commit/6f722e6c8ee0e6b0b5d180e8805f1c169df1f9ab))

## [1.86.3](https://github.com/bgill55/daedalus/compare/v1.86.2...v1.86.3) (2026-07-29)


### Bug Fixes

* **types:** resolve TypeScript compiler errors in CI workflow ([82b618c](https://github.com/bgill55/daedalus/commit/82b618cbda7c0956df2ee55066a74af350d6bc31))

## [1.86.2](https://github.com/bgill55/daedalus/compare/v1.86.1...v1.86.2) (2026-07-29)


### Bug Fixes

* add READ BEFORE WRITE hint to MCP system prompt to prevent model confusion ([8b08163](https://github.com/bgill55/daedalus/commit/8b08163db06999e037d5df1ba244abbf6651d694))

## [1.86.1](https://github.com/bgill55/daedalus/compare/v1.86.0...v1.86.1) (2026-07-29)


### Bug Fixes

* expand ~ in file tool paths to support home directory access ([b8c366d](https://github.com/bgill55/daedalus/commit/b8c366db088067899dc468097005dc5e99b336b6))

# [1.86.0](https://github.com/bgill55/daedalus/compare/v1.85.1...v1.86.0) (2026-07-29)


### Features

* sub-agents can now use MCP tools ([fb5cfe9](https://github.com/bgill55/daedalus/commit/fb5cfe97f59acaba0f3389b454f35bb5a95cdac1))

## [1.85.1](https://github.com/bgill55/daedalus/compare/v1.85.0...v1.85.1) (2026-07-29)


### Bug Fixes

* update mcp help with npm template, add filesystem to local config ([c875992](https://github.com/bgill55/daedalus/commit/c8759920a92e49a750fcd7b3e7fb72848ced52e4))

# [1.85.0](https://github.com/bgill55/daedalus/compare/v1.84.0...v1.85.0) (2026-07-29)


### Bug Fixes

* replace require() calls with ESM import in feedback.ts ([e024af8](https://github.com/bgill55/daedalus/commit/e024af83ba4bc4cb5e8723f6c45b4217298e3221))
* resolve TypeScript build errors (diff.Hunk -> diff.StructuredPatchHunk, mock type fix) ([66aa80f](https://github.com/bgill55/daedalus/commit/66aa80f09cd007014cab4ce36a657e38cf413af9))
* update docs and tests for /feedback command and help categorization ([b203a63](https://github.com/bgill55/daedalus/commit/b203a63c4bf111e8f2bf2ca36c06879c0727dc0b))
* use local DiffHunk type instead of diff.StructuredPatchHunk for CI compat ([13c13d2](https://github.com/bgill55/daedalus/commit/13c13d2f5c17ab974edab24157f55b492a6faa07))


### Features

* add Smithery.ai as a second MCP server registry ([cf6854a](https://github.com/bgill55/daedalus/commit/cf6854a2c09c2dbd02115d96aa0fc7d6131472c3))

## [1.84.1](https://github.com/bgill55/daedalus/compare/v1.84.0...v1.84.1) (2026-07-29)


### Bug Fixes

* replace require() calls with ESM import in feedback.ts ([e024af8](https://github.com/bgill55/daedalus/commit/e024af83ba4bc4cb5e8723f6c45b4217298e3221))
* resolve TypeScript build errors (diff.Hunk -> diff.StructuredPatchHunk, mock type fix) ([66aa80f](https://github.com/bgill55/daedalus/commit/66aa80f09cd007014cab4ce36a657e38cf413af9))
* update docs and tests for /feedback command and help categorization ([b203a63](https://github.com/bgill55/daedalus/commit/b203a63c4bf111e8f2bf2ca36c06879c0727dc0b))
* use local DiffHunk type instead of diff.StructuredPatchHunk for CI compat ([13c13d2](https://github.com/bgill55/daedalus/commit/13c13d2f5c17ab974edab24157f55b492a6faa07))

## [1.84.1](https://github.com/bgill55/daedalus/compare/v1.84.0...v1.84.1) (2026-07-28)


### Bug Fixes

* update docs and tests for /feedback command and help categorization ([b203a63](https://github.com/bgill55/daedalus/commit/b203a63c4bf111e8f2bf2ca36c06879c0727dc0b))

# [1.84.0](https://github.com/bgill55/daedalus/compare/v1.83.8...v1.84.0) (2026-07-28)


### Features

* add /feedback command with GitHub label support and tests ([a3b3df8](https://github.com/bgill55/daedalus/commit/a3b3df8119a6cee14d1f785fcc8f95a26f9fbb06))
* add /hunt command for autonomous bug fixing ([dbba7a0](https://github.com/bgill55/daedalus/commit/dbba7a013d55745f3a96d106c529cf253a7ea2d0))

## [1.83.8](https://github.com/bgill55/daedalus/compare/v1.83.7...v1.83.8) (2026-07-28)


### Bug Fixes

* consolidate multiple tool-turn blocks into one per user turn ([0801d2d](https://github.com/bgill55/daedalus/commit/0801d2def4fe37a2ba9ee2e2c35583752745125a))

## [1.83.7](https://github.com/bgill55/daedalus/compare/v1.83.6...v1.83.7) (2026-07-28)


### Bug Fixes

* **docs:** set explicit dark bg on table cells, fix white background readability ([fa31f24](https://github.com/bgill55/daedalus/commit/fa31f24249639c63a342d2f95446a1d49d35fdd6))

## [1.83.6](https://github.com/bgill55/daedalus/compare/v1.83.5...v1.83.6) (2026-07-28)


### Bug Fixes

* **docs:** resolve 404s — copy root docs into docs/, disable unused navbar ([923683c](https://github.com/bgill55/daedalus/commit/923683cb86c3b53a42235b8999d6929df12b55d8))

## [1.83.5](https://github.com/bgill55/daedalus/compare/v1.83.4...v1.83.5) (2026-07-28)


### Bug Fixes

* **docs:** rename sidebar link to NotebookLM so users can find it ([ee9f50f](https://github.com/bgill55/daedalus/commit/ee9f50f8ec571da8b0be4cc00037af18f2db0d07))

## [1.83.4](https://github.com/bgill55/daedalus/compare/v1.83.3...v1.83.4) (2026-07-28)


### Bug Fixes

* **docs:** move sidebar toggle to right side to fix overlap with search bar ([b452e75](https://github.com/bgill55/daedalus/commit/b452e75e03d6bbebc4563e706b8384acd003e97e))

## [1.83.3](https://github.com/bgill55/daedalus/compare/v1.83.2...v1.83.3) (2026-07-28)


### Bug Fixes

* **docs:** remove GitHub corner ribbon, top border-line, move sidebar toggle to top ([2b914b0](https://github.com/bgill55/daedalus/commit/2b914b02e8549fbaabb7f35fb9d28cd3e7629e80))

## [1.83.2](https://github.com/bgill55/daedalus/compare/v1.83.1...v1.83.2) (2026-07-27)


### Bug Fixes

* add error handling to TUI spinner to prevent crashes ([c275334](https://github.com/bgill55/daedalus/commit/c275334f58fd09af699477206106b1edb17bfbe0))

## [1.83.1](https://github.com/bgill55/daedalus/compare/v1.83.0...v1.83.1) (2026-07-27)


### Reverts

* Revert "chore(release): 1.83.0" ([f88c6dc](https://github.com/bgill55/daedalus/commit/f88c6dcd41b47971cd6c9c164ce0d9be8029074d))

# [1.82.0](https://github.com/bgill55/daedalus/compare/v1.81.0...v1.82.0) (2026-07-27)


### Features

* complete three development sprints ([79cc161](https://github.com/bgill55/daedalus/commit/79cc161758b33571db8563abe4d79cbb6675e3f6))

# [1.81.0](https://github.com/bgill55/daedalus/compare/v1.80.0...v1.81.0) (2026-07-27)


### Features

* **tui:** change spinner color from cyan to blue for consistency ([a93fd4d](https://github.com/bgill55/daedalus/commit/a93fd4d250d41feff2cc296f5a84afff564dbc5f))

# [1.80.0](https://github.com/bgill55/daedalus/compare/v1.79.0...v1.80.0) (2026-07-27)


### Features

* **tui:** enhance scrolling with scrollbar and arrow key support for laptops ([ce46abc](https://github.com/bgill55/daedalus/commit/ce46abc1d4bf1842c3b3abe377e37701c29cd1eb))

# [1.79.0](https://github.com/bgill55/daedalus/compare/v1.78.2...v1.79.0) (2026-07-27)


### Features

* make onboarding wizard noob-friendly with helpful links, error messages, and spinner ([1c87f98](https://github.com/bgill55/daedalus/commit/1c87f98a097c9cf517ec05ab18707d00d1c24eca))

## [1.78.2](https://github.com/bgill55/daedalus/compare/v1.78.1...v1.78.2) (2026-07-27)


### Bug Fixes

* improve session export path handling and docs ([7c794a4](https://github.com/bgill55/daedalus/commit/7c794a4fe15e04459d81227b0edc8e7d47367bc4))

## [1.78.1](https://github.com/bgill55/daedalus/compare/v1.78.0...v1.78.1) (2026-07-27)


### Bug Fixes

* normalize line endings in gitMerger test ([569a4b3](https://github.com/bgill55/daedalus/commit/569a4b3ffe0f4a88ebe72342a774951204e3d519))

# [1.78.0](https://github.com/bgill55/daedalus/compare/v1.77.0...v1.78.0) (2026-07-27)


### Features

* enhance /paste command with specific image detection and line count feedback ([5d96c59](https://github.com/bgill55/daedalus/commit/5d96c594dfed307027524fde1723ebfb3d3b1b85))

# [1.77.0](https://github.com/bgill55/daedalus/compare/v1.76.2...v1.77.0) (2026-07-27)


### Features

* **cli:** add /autopilot command for autonomous feature branching & self-PR ([b479658](https://github.com/bgill55/daedalus/commit/b479658680b58ed1146b139492b921f44c21593a))

## [1.76.3](https://github.com/bgill55/daedalus/compare/v1.76.2...v1.76.3) (2026-07-27)


### Features

* **cli:** add /autopilot command for autonomous feature branching & self-PR

## [1.76.1](https://github.com/bgill55/daedalus/compare/v1.76.0...v1.76.1) (2026-07-27)


### Bug Fixes

* **docs:** escape pipe in preview table cell ([af47786](https://github.com/bgill55/daedalus/commit/af477867303a7f253c7773d465c196dc25541873))

# [1.76.0](https://github.com/bgill55/daedalus/compare/v1.75.1...v1.76.0) (2026-07-27)


### Features

* **cli:** add /preview command for HTML/URL screenshot previews ([388a297](https://github.com/bgill55/daedalus/commit/388a297d4926fa23a572d5af7ef8dc2f1717c8a4))

## [1.75.1](https://github.com/bgill55/daedalus/compare/v1.75.0...v1.75.1) (2026-07-27)


### Bug Fixes

* **session:** tighten any, improve merge error handling, add tests ([3015447](https://github.com/bgill55/daedalus/commit/30154475f4b1710cd0f6982c4dba4f11da3abe0d))

# [1.75.0](https://github.com/bgill55/daedalus/compare/v1.74.1...v1.75.0) (2026-07-27)


### Features

* add system_info tool for OS/hardware diagnostics ([d0fc683](https://github.com/bgill55/daedalus/commit/d0fc68381ae43d0f9214ae69f5f30608d123e6f1))

## [1.74.1](https://github.com/bgill55/daedalus/compare/v1.74.0...v1.74.1) (2026-07-26)


### Bug Fixes

* **persona:** restore CLI wit and banter directives with specific example-driven humor ([f964bc2](https://github.com/bgill55/daedalus/commit/f964bc20d7b0187670aec1b17c1ee9dbe5fb2051))

# [1.74.0](https://github.com/bgill55/daedalus/compare/v1.73.0...v1.74.0) (2026-07-26)


### Features

* **config:** add OS & System Diagnostics Awareness module and system prompt headers ([daf9147](https://github.com/bgill55/daedalus/commit/daf914787d08a21fad9a4d8d570d87db14ae3066))

# [1.73.0](https://github.com/bgill55/daedalus/compare/v1.72.0...v1.73.0) (2026-07-26)


### Bug Fixes

* **tsc:** add public db getter to SessionManager and pass loaded session object to initializeSessionState ([176b703](https://github.com/bgill55/daedalus/commit/176b70387ca82e6e242261b54b0a5e4a5c9b4afa))


### Features

* **session:** implement Chat-History Branching system (/session branch, checkout, list, merge) ([1658410](https://github.com/bgill55/daedalus/commit/1658410b19f1de1c7129ef13952bdcb4be19733d))

# [1.72.0](https://github.com/bgill55/daedalus/compare/v1.71.2...v1.72.0) (2026-07-26)


### Bug Fixes

* **discord:** add error handling, exit codes, and npm script for post-infographic ([591be23](https://github.com/bgill55/daedalus/commit/591be234b420b204333de01dabbc84a4d7c6c308))


### Features

* **issue-8:** [Daedalus Spec] Chat‑History Branching – “What‑if” sessions | Snapshot a chat, branch it, try a different approach, then merge the winning edits back. Perfect for brainstorming multiple implementations. | daedalus /session branch <name> ([3fc857d](https://github.com/bgill55/daedalus/commit/3fc857dfda04037c2474d9cae2ca7cb946ac663e))

## [1.71.2](https://github.com/bgill55/daedalus/compare/v1.71.1...v1.71.2) (2026-07-25)


### Bug Fixes

* **discord:** auto-extract release notes bullet points from CHANGELOG.md for Discord embeds ([7ddca53](https://github.com/bgill55/daedalus/commit/7ddca53e1dd8e1e45818fbd93e0295f36d3b7b72))

## [1.71.1](https://github.com/bgill55/daedalus/compare/v1.71.0...v1.71.1) (2026-07-25)


### Bug Fixes

* **test:** update src/docs.test.ts to match categorized commands table in README.md ([7498aa4](https://github.com/bgill55/daedalus/commit/7498aa48a73bb11a592a57412626d541db80c358))

# [1.71.0](https://github.com/bgill55/daedalus/compare/v1.70.0...v1.71.0) (2026-07-25)


### Bug Fixes

* **ci:** replace .releaserc.json with release.config.cjs to fix JSON parse error ([0af68fe](https://github.com/bgill55/daedalus/commit/0af68fec94dcb9b706c39714d36d088a09be0a02))
* **ci:** trigger Discord release announcements directly from semantic-release via @semantic-release/exec ([1562ecd](https://github.com/bgill55/daedalus/commit/1562ecdc04a35a1bacfd0605c36c851770da09bb))


### Features

* **commands:** implement Sprint 2 /test --git-aware smart test selection ([72dec56](https://github.com/bgill55/daedalus/commit/72dec567a87c28d7bb8633d09439fa042f02a621))
* **indexing:** implement Sprint 3 /watch command for live background re-indexing ([33bb2bd](https://github.com/bgill55/daedalus/commit/33bb2bd023c5c7454759aa6e322f42bc5b11a0c4))
* **mcp:** implement Sprint 4 /mcp explore marketplace subcommand ([cfc560d](https://github.com/bgill55/daedalus/commit/cfc560d87ea68974b6822bf0bbe21eb878518ac6))
* **router:** implement Sprint 1 multi-model fallback chain for zero-interruption sessions ([91d79ce](https://github.com/bgill55/daedalus/commit/91d79ceb4b8229a39b903e6a2d7e228e27a34e30))

# [1.70.0](https://github.com/bgill55/daedalus/compare/v1.69.0...v1.70.0) (2026-07-25)


### Features

* **bot:** add bgill55.art to creator recognition check ([0d1021a](https://github.com/bgill55/daedalus/commit/0d1021ad8347546c2d7a5def0bd52261afed7106))

# [1.69.0](https://github.com/bgill55/daedalus/compare/v1.68.0...v1.69.0) (2026-07-25)


### Features

* **bot:** add dynamic commands knowledge base and creator recognition banter for bgill55 ([2fc4207](https://github.com/bgill55/daedalus/commit/2fc42077164d6856b24ddfc5a8b8b8ffe1328225))

# [1.68.0](https://github.com/bgill55/daedalus/compare/v1.67.0...v1.68.0) (2026-07-25)


### Features

* **repl:** wire up /health command in REPL registry and sync README commands table ([cec6c09](https://github.com/bgill55/daedalus/commit/cec6c09a98773e46bdee80775362dfa9f421a8b7))

# [1.67.0](https://github.com/bgill55/daedalus/compare/v1.66.2...v1.67.0) (2026-07-25)


### Bug Fixes

* **health:** centralize types in src/types.ts, fix maskKey empty string edge case, use ASCII hyphen in headers, and add unit test suite ([ad581ba](https://github.com/bgill55/daedalus/commit/ad581badf59c7e92fe99a5c676b3d73b1dd1645a))


### Features

* **issue-6:** [Daedalus Spec] Add /health REPL command to display model router provider latency, health status, and API key status ([3be2e6f](https://github.com/bgill55/daedalus/commit/3be2e6f682138604e3325156280f3f201679ca03))

## [1.66.2](https://github.com/bgill55/daedalus/compare/v1.66.1...v1.66.2) (2026-07-25)


### Bug Fixes

* **reviewer:** add TYPE LOCATION and DEFENSIVE GUARDS & ASCII audit rules to reviewer prompt ([7058c7d](https://github.com/bgill55/daedalus/commit/7058c7dfc0ee9f28acc7fe312d2c9d6e8183d1b0))

## [1.66.1](https://github.com/bgill55/daedalus/compare/v1.66.0...v1.66.1) (2026-07-25)


### Bug Fixes

* **ci:** respect .gitignore for src/bot.ts and exclude from build ([d7f2718](https://github.com/bgill55/daedalus/commit/d7f271866c48d37ed1fe75374a3d27cb30a60c30))

# [1.66.0](https://github.com/bgill55/daedalus/compare/v1.65.1...v1.66.0) (2026-07-25)


### Bug Fixes

* **ci:** add discord.js and dotenv dependencies for bot and daemon ([49c10d4](https://github.com/bgill55/daedalus/commit/49c10d44081d6b6f21c4ebd2fd8ee8efefe6f6ea))
* **loop:** add dotenv.config() and robust response checking to sendDiscordEmbed in loop.ts ([fe806a4](https://github.com/bgill55/daedalus/commit/fe806a49e7cd14c6d8918f04f31d07ce9fac9634))
* **reviewer:** add SPECIFICATION COMPLETENESS audit rule to reviewer prompt ([912edd1](https://github.com/bgill55/daedalus/commit/912edd1a93c0c0ab0e807a497df4035428ed882c))


### Features

* **bot:** register /stats slash command for Discord bot ([8f0e67e](https://github.com/bgill55/daedalus/commit/8f0e67e8238a0bf7e354803ad581927a49ed393f))

## [1.65.1](https://github.com/bgill55/daedalus/compare/v1.65.0...v1.65.1) (2026-07-25)


### Bug Fixes

* **stats:** align /stats CLI output formatting to match REPL theme ([bc7caf4](https://github.com/bgill55/daedalus/commit/bc7caf4824f4e89f12a90529d6cadd2e1dfe97e1))

# [1.65.0](https://github.com/bgill55/daedalus/compare/v1.64.0...v1.65.0) (2026-07-25)


### Features

* **docs:** add auto sync-docs execution after build verification and enforce documentation rule in planner prompt ([6ad9b0a](https://github.com/bgill55/daedalus/commit/6ad9b0a3818f98988e8e3669a2920b58057b35dd))

# [1.64.0](https://github.com/bgill55/daedalus/compare/v1.63.0...v1.64.0) (2026-07-25)


### Features

* **issue-4:** [Daedalus Spec] Add /stats REPL command to display session analytics, token usage, codebase index count, and model router status ([d2a0c50](https://github.com/bgill55/daedalus/commit/d2a0c504e2738ee2a21f6ab33c0d7790fb030613))

# [1.63.0](https://github.com/bgill55/daedalus/compare/v1.62.0...v1.63.0) (2026-07-25)


### Features

* **repl:** wire up /stats command in REPL commands registry ([16bba45](https://github.com/bgill55/daedalus/commit/16bba45ff410bd1dbc89961010e2a99541a765ae))

# [1.62.0](https://github.com/bgill55/daedalus/compare/v1.61.1...v1.62.0) (2026-07-25)


### Features

* **analytics:** add SessionStats and /stats command handler, and add DEPENDENCY ORDERING RULE to planner prompt ([ee1c2bd](https://github.com/bgill55/daedalus/commit/ee1c2bd39e930b8005babd2d47e423ae9da6b608))

## [1.61.1](https://github.com/bgill55/daedalus/compare/v1.61.0...v1.61.1) (2026-07-25)


### Bug Fixes

* **loop:** enable DAEDALUS_AUTO_APPROVE in Finn Loop daemon mode to bypass interactive task prompts ([45c6b7f](https://github.com/bgill55/daedalus/commit/45c6b7f787de4186d438817d3b6caa0d7187b8e8))

# [1.61.0](https://github.com/bgill55/daedalus/compare/v1.60.10...v1.61.0) (2026-07-25)


### Bug Fixes

* **discord:** resolve package name resolution and strict arg type validation flagged in PR [#3](https://github.com/bgill55/daedalus/issues/3) code review ([ce58535](https://github.com/bgill55/daedalus/commit/ce58535108bb0a57dad69d35ca51b3e34644e5e2))


### Features

* **issue-2:** [Daedalus Spec] 'Add Discord webhook announcer for GitHub release updates' ([a2d4dce](https://github.com/bgill55/daedalus/commit/a2d4dce9ed3a4215b95e9b03ac73cd5e9f26d74f))
* **reviewer:** add strict execution context and CLI argument type checks to reviewer agent prompt ([e327e73](https://github.com/bgill55/daedalus/commit/e327e73eff2ff34211baf353e2d94a44e086110a))

## [1.60.10](https://github.com/bgill55/daedalus/compare/v1.60.9...v1.60.10) (2026-07-25)


### Bug Fixes

* **loop:** check both daedalus-todo and daedalus-in-progress issues on daemon restart ([d949d03](https://github.com/bgill55/daedalus/commit/d949d03471f6f0fa0e7d24f0100e3da5b3d84b24))

## [1.60.9](https://github.com/bgill55/daedalus/compare/v1.60.8...v1.60.9) (2026-07-25)


### Bug Fixes

* **loop:** sanitize quotes in git commit message and use git checkout -B for issue branches ([8894b26](https://github.com/bgill55/daedalus/commit/8894b262155ce5b8548585ad3554f8cb84ae1e85))

## [1.60.8](https://github.com/bgill55/daedalus/compare/v1.60.7...v1.60.8) (2026-07-25)


### Bug Fixes

* **router:** deduplicate health check requests per endpoint and add discoverModel fallback to eliminate 429 rate limit errors ([0fbf2a7](https://github.com/bgill55/daedalus/commit/0fbf2a7025a370e35024b2c462d64e74c3e5bcd3))

## [1.60.7](https://github.com/bgill55/daedalus/compare/v1.60.6...v1.60.7) (2026-07-25)


### Bug Fixes

* **router:** fallback to enabled models when all candidate health checks return unhealthy ([142f2b4](https://github.com/bgill55/daedalus/commit/142f2b4d858a60d0bee9854fba125465fc408a18))

## [1.60.6](https://github.com/bgill55/daedalus/compare/v1.60.5...v1.60.6) (2026-07-25)


### Bug Fixes

* **router:** add automatic model fallback retry loop when endpoint model loading throws 400 error ([581e90e](https://github.com/bgill55/daedalus/commit/581e90eda343a7c0aa8be0b01aaeb4dd9ba96a1c))

## [1.60.5](https://github.com/bgill55/daedalus/compare/v1.60.4...v1.60.5) (2026-07-25)


### Bug Fixes

* **cli:** support both --loop and --daemon flags for starting Finn Loop daemon ([1a6a4e7](https://github.com/bgill55/daedalus/commit/1a6a4e77baab659c40c8859b6feb73ea6b37d0e9))

## [1.60.4](https://github.com/bgill55/daedalus/compare/v1.60.3...v1.60.4) (2026-07-25)


### Bug Fixes

* **loop:** add gh auth token fallback for /spec and Finn Loop daemon ([0629e12](https://github.com/bgill55/daedalus/commit/0629e123f6ee32dddaef95598dca153b69a4f190))

## [1.60.3](https://github.com/bgill55/daedalus/compare/v1.60.2...v1.60.3) (2026-07-24)


### Bug Fixes

* **router:** filter candidate models by supportsVision when message contains image payload ([3498578](https://github.com/bgill55/daedalus/commit/34985789b94c2ff5d2c22f440f6e9bbf35519ada))

## [1.60.2](https://github.com/bgill55/daedalus/compare/v1.60.1...v1.60.2) (2026-07-24)


### Bug Fixes

* **commands:** strip quotes from file paths passed to /paste command ([7ad97ba](https://github.com/bgill55/daedalus/commit/7ad97ba087b54e87146639780aa6b0d190a2ef91))

## [1.60.1](https://github.com/bgill55/daedalus/compare/v1.60.0...v1.60.1) (2026-07-24)


### Bug Fixes

* **context:** strip quotes from /add file paths and handle binary image files gracefully ([498d217](https://github.com/bgill55/daedalus/commit/498d2174cc1061e06e527a85f47de9511b21dd16))

# [1.60.0](https://github.com/bgill55/daedalus/compare/v1.59.1...v1.60.0) (2026-07-24)


### Features

* **scripts:** auto-generate changelog release notes from recent git commits ([bac4f2e](https://github.com/bgill55/daedalus/commit/bac4f2e3920a9ccc5cd47f91eeb500a7f0139eb4))

## [1.59.1](https://github.com/bgill55/daedalus/compare/v1.59.0...v1.59.1) (2026-07-24)


### Bug Fixes

* **agent:** add Direct Tool Execution rule to prevent search loops when running scripts ([c69c4b2](https://github.com/bgill55/daedalus/commit/c69c4b20feb8c01ba71e472d7318e888014db864))

# [1.59.0](https://github.com/bgill55/daedalus/compare/v1.58.0...v1.59.0) (2026-07-24)


### Bug Fixes

* **agent:** add tool scoping rule to system prompt preventing unwanted write_file calls on text review ([f297caa](https://github.com/bgill55/daedalus/commit/f297caa1454843cde396ab00af4326ad5026bf25))
* **lint:** escape backticks in system prompt string on line 221 ([cc09dbe](https://github.com/bgill55/daedalus/commit/cc09dbe019d75bda5ba32ae3bbc76f11dbfef4b1))


### Features

* **scripts:** add automated Discord changelog poster script and npm run bot command ([9d9731f](https://github.com/bgill55/daedalus/commit/9d9731fcd22ad84b37c990a14d8e42363c9feb4f))

# [1.58.0](https://github.com/bgill55/daedalus/compare/v1.57.0...v1.58.0) (2026-07-24)


### Features

* **cli:** add Discord server link https://discord.gg/GPH2ZH57up to startup banner and README ([ebd9a5d](https://github.com/bgill55/daedalus/commit/ebd9a5d4fac53f3c7751067744370583a4ff8bbc))

# [1.57.0](https://github.com/bgill55/daedalus/compare/v1.56.4...v1.57.0) (2026-07-24)


### Features

* **cli:** add GitHub repository star prompt to banner startup footer ([6901ad0](https://github.com/bgill55/daedalus/commit/6901ad0a24cc7f8ae8dbabc937aba2a5a74fcef6))

## [1.56.4](https://github.com/bgill55/daedalus/compare/v1.56.3...v1.56.4) (2026-07-24)


### Bug Fixes

* **router:** add presence and frequency penalties to prevent model repetition loops ([b9c4bf1](https://github.com/bgill55/daedalus/commit/b9c4bf14c720147b9380b34fcfaac3b4fc69b94a))

## [1.56.3](https://github.com/bgill55/daedalus/compare/v1.56.2...v1.56.3) (2026-07-22)


### Bug Fixes

* restore Daedalus dry witty persona in main system prompt and remove anti-humor guardrails from agent roles ([5c9944e](https://github.com/bgill55/daedalus/commit/5c9944e80f191d6c6437ade8831c7f68d2181740))

## [1.56.2](https://github.com/bgill55/daedalus/compare/v1.56.1...v1.56.2) (2026-07-22)


### Bug Fixes

* make pattern optional in search_files schema, add pattern fallback, and add Windows zip command diagnostic hint ([5140588](https://github.com/bgill55/daedalus/commit/5140588c6f2aa64c56aac9e33d9455dfabad57c8))

## [1.56.1](https://github.com/bgill55/daedalus/compare/v1.56.0...v1.56.1) (2026-07-22)


### Bug Fixes

* normalize CRLF in patch-utils and add missing package error diagnostic hints in terminal tool ([6683a47](https://github.com/bgill55/daedalus/commit/6683a47a749a3a236c86a41638bf6f607346c894))

# [1.56.0](https://github.com/bgill55/daedalus/compare/v1.55.0...v1.56.0) (2026-07-22)


### Features

* add /summarize command for manual context compression ([51f4a88](https://github.com/bgill55/daedalus/commit/51f4a88ad4c8fcd60964e271c525e9c9908a6535))

# [1.55.0](https://github.com/bgill55/daedalus/compare/v1.54.0...v1.55.0) (2026-07-21)


### Features

* add multi-language codebase indexing & stream TPS telemetry, resolve tech debt ([60df919](https://github.com/bgill55/daedalus/commit/60df919051e3577be1b6c2410d568be1cd63678e))

# [1.54.0](https://github.com/bgill55/daedalus/compare/v1.53.1...v1.54.0) (2026-07-21)


### Bug Fixes

* **types:** make timestamp optional in PatchEntry and update commands test mock ([08b69cf](https://github.com/bgill55/daedalus/commit/08b69cf0d654da092e578ecbe2ea08a977a11fd9))


### Features

* add batch /undo command and [@agent](https://github.com/agent) prompt tagging ([187d085](https://github.com/bgill55/daedalus/commit/187d085d50e1f3d61d2e2b6badb86af3d7f73487))

## [1.53.1](https://github.com/bgill55/daedalus/compare/v1.53.0...v1.53.1) (2026-07-21)


### Bug Fixes

* **tools:** point generate_image implementation mapping to generateImage function ([06db057](https://github.com/bgill55/daedalus/commit/06db0573900be7e5be5b6f4ac91e753c06ee70f0))

# [1.53.0](https://github.com/bgill55/daedalus/compare/v1.52.3...v1.53.0) (2026-07-21)


### Bug Fixes

* **build:** resolve strict TypeScript compiler errors for CI build ([9b4b826](https://github.com/bgill55/daedalus/commit/9b4b82617913a0531f47242ae65d6f2cc61028e8))


### Features

* **tools:** add local Stable Diffusion image generation tool and /image command ([b5d30ec](https://github.com/bgill55/daedalus/commit/b5d30ecac5c54df39869cc52c193d1243033f45b))
* **tools:** add Pollinations AI fallback and engine selection for image generation ([b90bd5f](https://github.com/bgill55/daedalus/commit/b90bd5f14122db347e03f0b2b9e2385fb03c7461))

## [1.52.3](https://github.com/bgill55/daedalus/compare/v1.52.2...v1.52.3) (2026-07-21)


### Bug Fixes

* restore clean README.md formatting and embed Daedalus Evolution infographic ([5236fe6](https://github.com/bgill55/daedalus/commit/5236fe6971707675c591a199aa2a7340013f479d))

## [1.52.2](https://github.com/bgill55/daedalus/compare/v1.52.1...v1.52.2) (2026-07-20) ### Bug Fixes * **files:** allow absolute path cross-project writes and normalize drive paths ([d331663](https://github.com/bgill55/daedalus/commit/d331663666f08b0b86a3a9d91afa33bba085dad6)) ## [1.52.1](https://github.com/bgill55/daedalus/compare/v1.52.0...v1.52.1) (2026-07-20) ### Bug Fixes * **model:** increase detectRepetition window size to 32 to avoid false positive triggers in directory tables ([df03f19](https://github.com/bgill55/daedalus/commit/df03f19b8a3b0beb6067db0bb1c379b6972d3a35)) # [1.52.0](https://github.com/bgill55/daedalus/compare/v1.51.0...v1.52.0) (2026-07-19) ### Features * **definitions:** force release of read_file vision schemas ([8895556](https://github.com/bgill55/daedalus/commit/88955562108c6348a16d34835f5ed52458593cc9)) # [1.51.0](https://github.com/bgill55/daedalus/compare/v1.50.2...v1.51.0) (2026-07-19) ### Features * **vision:** enable reading local image files via read_file and injecting them as vision messages ([5f0cf94](https://github.com/bgill55/daedalus/commit/5f0cf94efeffa4e70adaa8a9ff2d7da06977409d)) ## [1.50.2](https://github.com/bgill55/daedalus/compare/v1.50.1...v1.50.2) (2026-07-19) ### Bug Fixes * **files:** cast ESM dynamic import of pdf-parse to any to fix compile error TS2578 ([7227388](https://github.com/bgill55/daedalus/commit/72273887f0f8115a1435c1817046469eef6f9a5d))
* **files:** import and instantiate named class PDFParse from pdf-parse ESM ([64092d6](https://github.com/bgill55/daedalus/commit/64092d629a1c283e9ef85b0ec49666325d46ad37)) ## [1.50.1](https://github.com/bgill55/daedalus/compare/v1.50.0...v1.50.1) (2026-07-19) ### Bug Fixes * **files:** add required explanation description to ts-expect-error comment ([bc1efa9](https://github.com/bgill55/daedalus/commit/bc1efa99b08500147dc6c53dbac5bff137354f44)) # [1.50.0](https://github.com/bgill55/daedalus/compare/v1.49.4...v1.50.0) (2026-07-19) ### Features * add native PDF parsing support to readFile tool using pdf-parse ([59fa377](https://github.com/bgill55/daedalus/commit/59fa3778a780d02ceb0af46b87e452aa2d29094d)) ## [1.49.4](https://github.com/bgill55/daedalus/compare/v1.49.3...v1.49.4) (2026-07-18) ### Bug Fixes * skip build check on config/docs modifications in orchestrator ([1882c17](https://github.com/bgill55/daedalus/commit/1882c17676768f0f91bf7ed7c8a1d25436653bee)) ## [1.49.3](https://github.com/bgill55/daedalus/compare/v1.49.2...v1.49.3) (2026-07-18) ### Bug Fixes * implement repetition loop detection inside model streaming response handler ([808c895](https://github.com/bgill55/daedalus/commit/808c895181e85e58654aa207b51692e9a9e226c9)) ## [1.49.2](https://github.com/bgill55/daedalus/compare/v1.49.1...v1.49.2) (2026-07-18) ### Bug Fixes * auto-generate walkthrough.md upon successful orchestration completion ([6cccf3f](https://github.com/bgill55/daedalus/commit/6cccf3f78772f0409b9ab396256c580abb78656e)) ## [1.49.1](https://github.com/bgill55/daedalus/compare/v1.49.0...v1.49.1) (2026-07-18) ### Bug Fixes * include full configuration schema reference in help config manual ([2b862c0](https://github.com/bgill55/daedalus/commit/2b862c07b19d27c44a41c11dfcf846bbbfcc0363)) # [1.49.0](https://github.com/bgill55/daedalus/compare/v1.48.0...v1.49.0) (2026-07-18) ### Features * add interactive man page help for slash commands ([a041254](https://github.com/bgill55/daedalus/commit/a041254aa00013eb9e4b9696dd09418d7e3eda7d)) # [1.48.0](https://github.com/bgill55/daedalus/compare/v1.47.0...v1.48.0) (2026-07-17) ### Features * pin routed model inside single turn tool loops ([6d60e89](https://github.com/bgill55/daedalus/commit/6d60e89dae0e6eaa851843fdf068b84ddc20ed19)) # [1.47.0](https://github.com/bgill55/daedalus/compare/v1.46.0...v1.47.0) (2026-07-17) ### Bug Fixes * resolve duplicate updateConfig method implementation in LocalRouter ([4b538cb](https://github.com/bgill55/daedalus/commit/4b538cbaa1951968a3695e4a3946a07899b1e12a)) ### Features * apply router config updates in real-time without restarting CLI ([20b4412](https://github.com/bgill55/daedalus/commit/20b44129b7b5fc4bb2e597e6663e150c914e7450)) # [1.46.0](https://github.com/bgill55/daedalus/compare/v1.45.1...v1.46.0) (2026-07-16) ### Features * add centralized schema validation and auto-read fallback on patch failure ([edf7618](https://github.com/bgill55/daedalus/commit/edf761850fbf8188e5eae58673496cb07e9a3353)) ## [1.45.1](https://github.com/bgill55/daedalus/compare/v1.45.0...v1.45.1) (2026-07-15) ### Performance Improvements * **files:** normalize CRLF line endings at API boundary and preserve on write ([87746a1](https://github.com/bgill55/daedalus/commit/87746a1dd20b495836c8d2d2864f7bc90060ef49)) # [1.45.0](https://github.com/bgill55/daedalus/compare/v1.44.0...v1.45.0) (2026-07-15) ### Features * **rules:** inject project-scoped rules into planner and sub-agents, and add /system command ([0935c5c](https://github.com/bgill55/daedalus/commit/0935c5c276ee9438d754bc3dc47020971eb77179)) # [1.44.0](https://github.com/bgill55/daedalus/compare/v1.43.0...v1.44.0) (2026-07-15) ### Features * **rules:** log detected project rules files on startup ([9675acc](https://github.com/bgill55/daedalus/commit/9675acce163fe3d3b85974dc8d7c77fcaf2ffe5d)) # [1.43.0](https://github.com/bgill55/daedalus/compare/v1.42.0...v1.43.0) (2026-07-15) ### Features * **rules:** auto-detect and load CLAUDE.md, .cursorrules, and .daedalusrules from project root ([b8627db](https://github.com/bgill55/daedalus/commit/b8627db6f2ea37e90425ed92d07edf0d77fb7ca4)) # [1.42.0](https://github.com/bgill55/daedalus/compare/v1.41.0...v1.42.0) (2026-07-15) ### Features * **ui:** implement Dual-Channel UI Commentary Collapse in CLI mode ([f340d08](https://github.com/bgill55/daedalus/commit/f340d082b11451be49c1fbec34a66a680bee43c6)) # [1.41.0](https://github.com/bgill55/daedalus/compare/v1.40.5...v1.41.0) (2026-07-15) ### Features * **loop:** implement the Finn Loop spec gathering and loop daemon engine ([008adb8](https://github.com/bgill55/daedalus/commit/008adb8ab898c53fac7cc11d64639a6cd9e45112)) ## [1.40.5](https://github.com/bgill55/daedalus/compare/v1.40.4...v1.40.5) (2026-07-13) ### Bug Fixes * **orchestrator:** allow non-file tasks and prioritize coder role in fallback plans ([0e159ec](https://github.com/bgill55/daedalus/commit/0e159ecc857ba3763f31eb81dfc2c658aa7df674)) ## [1.40.4](https://github.com/bgill55/daedalus/compare/v1.40.3...v1.40.4) (2026-07-12) ### Bug Fixes * **files:** block destructive short replace_all and update session mtime cache on reverts ([e373d0c](https://github.com/bgill55/daedalus/commit/e373d0cb9008c90360b417c419f01eac511258fd)) ## [1.40.3](https://github.com/bgill55/daedalus/compare/v1.40.2...v1.40.3) (2026-07-12) ### Bug Fixes * **orchestrator:** resolve projectRoot paths and build verification scope for sub-projects ([da34185](https://github.com/bgill55/daedalus/commit/da34185e9902a9b03a4e1cc076caae054dceb88e)) ## [1.40.2](https://github.com/bgill55/daedalus/compare/v1.40.1...v1.40.2) (2026-07-12) ### Bug Fixes * **router:** sanitize messages to prevent 400 errors from strict providers ([8929392](https://github.com/bgill55/daedalus/commit/89293926a90a1f72705149566dae5dcfc7a9ad5a)) ## [1.40.1](https://github.com/bgill55/daedalus/compare/v1.40.0...v1.40.1) (2026-07-11) ### Bug Fixes * **extraction:** parse JSON containing nested brackets robustly ([8bb2223](https://github.com/bgill55/daedalus/commit/8bb2223dd34b58c6f9a7ed4667968ba40e3a8baa)) # [1.40.0](https://github.com/bgill55/daedalus/compare/v1.39.10...v1.40.0) (2026-07-10) ### Features * **tools:** add ask_user tool for interactive prompt input ([005adb9](https://github.com/bgill55/daedalus/commit/005adb98d9a21aeeb94f01a1199b2c3215665a11)) ## [1.39.10](https://github.com/bgill55/daedalus/compare/v1.39.9...v1.39.10) (2026-07-08) ### Bug Fixes * **model:** inject strict system warnings for failed patch and write_file tools to force correction and prevent skipping ([3af31f2](https://github.com/bgill55/daedalus/commit/3af31f2636c1f7aa6f7fe44caa65d40f66253f27)) ## [1.39.9](https://github.com/bgill55/daedalus/compare/v1.39.8...v1.39.9) (2026-07-08) ### Bug Fixes * **tui:** add responsive thinking spinner animation inside logBox border label ([b2122d5](https://github.com/bgill55/daedalus/commit/b2122d5417a571dc55da414e30bffb1b81dedc7e)) ## [1.39.8](https://github.com/bgill55/daedalus/compare/v1.39.7...v1.39.8) (2026-07-08) ### Bug Fixes * **tui:** dynamically calculate user box wrap width based on mode to prevent nested border wrapping ([4362d01](https://github.com/bgill55/daedalus/commit/4362d01d6e1444f5963282a30dc44e0389ba0c1a)) ## [1.39.7](https://github.com/bgill55/daedalus/compare/v1.39.6...v1.39.7) (2026-07-08) ### Bug Fixes * **tui:** remove custom input blur listener to prevent double character typing ([6494f48](https://github.com/bgill55/daedalus/commit/6494f4830c1fded59fb7debebde75f7b05e360bb)) ## [1.39.6](https://github.com/bgill55/daedalus/compare/v1.39.5...v1.39.6) (2026-07-07) ### Bug Fixes * **tui:** call list.setItems explicitly after construction to enable key navigation ([97ad1db](https://github.com/bgill55/daedalus/commit/97ad1db0efe7208f7aa2942a33a4ef4742b2ff3b)) ## [1.39.5](https://github.com/bgill55/daedalus/compare/v1.39.4...v1.39.5) (2026-07-07) ### Bug Fixes * **tui:** cancel textbox readInput when blurred to allow navigation in other focused widgets ([50b54b4](https://github.com/bgill55/daedalus/commit/50b54b4d11dbdedf80f4128a523b1210443f0568)) ## [1.39.4](https://github.com/bgill55/daedalus/compare/v1.39.3...v1.39.4) (2026-07-07) ### Bug Fixes * **tui:** add mouse click-to-focus and wheel scroll support to lists and console ([59ed40b](https://github.com/bgill55/daedalus/commit/59ed40b9e4020ee45c5e887dba1837fd39d3f24c))
* **tui:** pass amount argument to list up and down methods ([8de67f9](https://github.com/bgill55/daedalus/commit/8de67f9aa7762168e4be7f29e70d3d96dcaef934)) ## [1.39.3](https://github.com/bgill55/daedalus/compare/v1.39.2...v1.39.3) (2026-07-06) ### Bug Fixes * **session:** clean conversational prefixes from generated titles ([3120760](https://github.com/bgill55/daedalus/commit/312076044a735f679c499373b9d8f52a13ceb8bc)) ## [1.39.2](https://github.com/bgill55/daedalus/compare/v1.39.1...v1.39.2) (2026-07-05) ### Bug Fixes * **tui:** register original stdout/stderr streams on globalThis to prevent stream redirection leaks on unexpected crashes ([5e3fb19](https://github.com/bgill55/daedalus/commit/5e3fb1915dbdbadb7185fe5b8004f974afffed70)) ## [1.39.1](https://github.com/bgill55/daedalus/compare/v1.39.0...v1.39.1) (2026-07-05) ### Bug Fixes * **router:** sanitize messages to strip vision/image payloads for models without vision capabilities and default null/undefined content ([1728853](https://github.com/bgill55/daedalus/commit/1728853309add47d5de49b5d94cf458aacde474d)) # [1.39.0](https://github.com/bgill55/daedalus/compare/v1.38.3...v1.39.0) (2026-07-05) ### Features * **session:** add /session export subcommand to export current conversation to a styled Markdown file ([e01be16](https://github.com/bgill55/daedalus/commit/e01be16b3051712add44cbf17a686a28fb80207c)) ## [1.38.3](https://github.com/bgill55/daedalus/compare/v1.38.2...v1.38.3) (2026-07-05) ### Bug Fixes * **executor:** execute tool calls sequentially instead of in parallel to avoid concurrent stdin/readline collisions and file-writing races ([099578b](https://github.com/bgill55/daedalus/commit/099578b8a9430e070e7bb7d0b92c69736a5882bf)) ## [1.38.2](https://github.com/bgill55/daedalus/compare/v1.38.1...v1.38.2) (2026-07-05) ### Bug Fixes * **todo:** support property-level merging and default empty content to prevent SQLite NOT NULL constraint failures ([c7abc8f](https://github.com/bgill55/daedalus/commit/c7abc8fe117877b93c4dab6eff9fe70b80c05e05)) ## [1.38.1](https://github.com/bgill55/daedalus/compare/v1.38.0...v1.38.1) (2026-07-05) ### Bug Fixes * **cli:** eliminate turn-gate prompt for read-only tools and fix process termination leaks on Windows ([97163d1](https://github.com/bgill55/daedalus/commit/97163d17d363940ecd0fbc111d5755aa5cb6b3fe)) # [1.38.0](https://github.com/bgill55/daedalus/compare/v1.37.6...v1.38.0) (2026-07-05) ### Features * **cli:** enhance code generation quality, prompts, verification pipelines, and design token integration ([83aed68](https://github.com/bgill55/daedalus/commit/83aed68cba1c4b4985870515505af0966fd6263f)) ## [1.37.6](https://github.com/bgill55/daedalus/compare/v1.37.5...v1.37.6) (2026-07-04) ### Bug Fixes * add arg validation to patch tool and optimize router openai request compatibility ([538af50](https://github.com/bgill55/daedalus/commit/538af507b61b1f90cc7d71fc441a41652c1b213a)) ## [1.37.5](https://github.com/bgill55/daedalus/compare/v1.37.4...v1.37.5) (2026-07-04) ### Bug Fixes * **router:** strip signal from OpenAI body to prevent 422 errors ([883a5e8](https://github.com/bgill55/daedalus/commit/883a5e8628103619ee161cc32a680df5fb4d6346)) ## [1.37.4](https://github.com/bgill55/daedalus/compare/v1.37.3...v1.37.4) (2026-07-04) ### Bug Fixes * **orchestrator:** refine React import rules for Next.js Pages Router ([dcbfb01](https://github.com/bgill55/daedalus/commit/dcbfb0176a28c76886869ee8b32ec6b3a0e0eaa7)) ## [1.37.3](https://github.com/bgill55/daedalus/compare/v1.37.2...v1.37.3) (2026-07-04) ### Bug Fixes * **orchestrator,index:** fix fallback plan cwd paths and argv flag filtering ([9177e85](https://github.com/bgill55/daedalus/commit/9177e8556213abfc40224af7496c367bd7d4e082)) ## [1.37.2](https://github.com/bgill55/daedalus/compare/v1.37.1...v1.37.2) (2026-07-04) ### Bug Fixes * **orchestrator:** fix planner failure on vague frontend UI goals ([afd1a4b](https://github.com/bgill55/daedalus/commit/afd1a4bcebb508e00bd30d7dc5a5df60e6dad4ad)) ## [1.37.1](https://github.com/bgill55/daedalus/compare/v1.37.0...v1.37.1) (2026-07-04) ### Bug Fixes * **agents:** harden production code generation against anti-pattern contamination ([3519a1b](https://github.com/bgill55/daedalus/commit/3519a1b94c4333d4ad7f35ffc54f19e742abc26a)) # [1.37.0](https://github.com/bgill55/daedalus/compare/v1.36.1...v1.37.0) (2026-07-03) ### Features * **agents:** inject versioned Next.js production coding rules into coder context ([a3971f8](https://github.com/bgill55/daedalus/commit/a3971f8396ace5c71354a269faf73a04e0c627bc)) ## [1.36.1](https://github.com/bgill55/daedalus/compare/v1.36.0...v1.36.1) (2026-07-02) ### Bug Fixes * **cli:** prevent stale read on consecutive writes and reset circuit breaker on read_file ([e5341d0](https://github.com/bgill55/daedalus/commit/e5341d00048387657317a5492179ca3965c28dcb)) # [1.36.0](https://github.com/bgill55/daedalus/compare/v1.35.9...v1.36.0) (2026-07-02) ### Features * **cli:** add auto-approve flags and prevent tool-calling loops ([399c30b](https://github.com/bgill55/daedalus/commit/399c30b3a77b346592abdacbe1dc3e51ed07fc86)) ## [1.35.9](https://github.com/bgill55/daedalus/compare/v1.35.8...v1.35.9) (2026-07-02) ### Bug Fixes * **orchestrator:** filter build errors by modified files and add error hints ([8b3e91d](https://github.com/bgill55/daedalus/commit/8b3e91d808a4cdcc710a4ac571ea715cbc047ce4))
* **orchestrator:** resolve TS2532 compiler error on patchHistory access ([88183a4](https://github.com/bgill55/daedalus/commit/88183a4aab945e373d3d7a833a3d89c5c8162246)) ## [1.35.8](https://github.com/bgill55/daedalus/compare/v1.35.7...v1.35.8) (2026-07-02) ### Bug Fixes * **orchestrator:** disable tools on the final turn of agent execution to guarantee a text-only summary output ([0a1bc38](https://github.com/bgill55/daedalus/commit/0a1bc385fdbcff2d1c42b088ad56f83a3ea9751e)) ## [1.35.7](https://github.com/bgill55/daedalus/compare/v1.35.6...v1.35.7) (2026-07-02) ### Bug Fixes * **orchestrator:** filter out framework names from file path matching and block single-task collapsed plans for complex goals ([6bb0212](https://github.com/bgill55/daedalus/commit/6bb02127a01dc4fed5946058b45c949f1456d4bf)) ## [1.35.6](https://github.com/bgill55/daedalus/compare/v1.35.5...v1.35.6) (2026-07-02) ### Bug Fixes * **orchestrator:** comprehensive stability overhaul — 18 bug fixes across plan validation, parser, verification, repair, and role config ([8c01c21](https://github.com/bgill55/daedalus/commit/8c01c21a41e6b39ee00765c338bb49c4129bd13e))
* **orchestrator:** comprehensive stability overhaul — 24 bug fixes across plan validation, parser, verification, repair, and role config ([92ba0c2](https://github.com/bgill55/daedalus/commit/92ba0c2fe350a89ec621cae50c9c3e570e439099)) ## [1.35.5](https://github.com/bgill55/daedalus/compare/v1.35.4...v1.35.5) (2026-07-02) ### Bug Fixes * **orchestrator:** only require file paths for coder and debugger tasks ([deaa66c](https://github.com/bgill55/daedalus/commit/deaa66c249745da54313cf896ce1ca405cfe8a14)) ## [1.35.4](https://github.com/bgill55/daedalus/compare/v1.35.3...v1.35.4) (2026-07-02) ### Bug Fixes * **orchestrator:** use auto tool choice for read-only roles and skip tools used line in parser ([dd54a3f](https://github.com/bgill55/daedalus/commit/dd54a3f61338e88b41f9e618cbb02eacda7934b1)) ## [1.35.3](https://github.com/bgill55/daedalus/compare/v1.35.2...v1.35.3) (2026-07-02) ### Bug Fixes * **orchestrator:** pass tasks and originalGoal to retried task delegations and fix split validation check ([cb96492](https://github.com/bgill55/daedalus/commit/cb96492c9a289a160d0a88c36f8adad3480ee517)) ## [1.35.2](https://github.com/bgill55/daedalus/compare/v1.35.1...v1.35.2) (2026-07-02) ### Bug Fixes * **planner:** refine vague word regex and instruct planner to resolve them ([e2ae045](https://github.com/bgill55/daedalus/commit/e2ae04573d30511c3ec2e3218bbed87eab07ab6a)) ## [1.35.1](https://github.com/bgill55/daedalus/compare/v1.35.0...v1.35.1) (2026-07-02) ### Bug Fixes * **prompts:** instruct agents to acknowledge tool results in history ([90c90e1](https://github.com/bgill55/daedalus/commit/90c90e1022ebf04c7e5ac853b37fabe01d65a73c)) # [1.35.0](https://github.com/bgill55/daedalus/compare/v1.34.18...v1.35.0) (2026-07-01) ### Features * **orchestrator:** implement build verification loops and auto rollbacks ([f0a2229](https://github.com/bgill55/daedalus/commit/f0a22298c69b8943c022aa0fd24a765e0cdf5cbf)) ## [1.34.18](https://github.com/bgill55/daedalus/compare/v1.34.17...v1.34.18) (2026-07-01) ### Bug Fixes * **tui:** allow scrolling with PageUp/PageDown while input textbox is focused ([833d69b](https://github.com/bgill55/daedalus/commit/833d69b9ece363198ab2802981df8d6e617acd60)) ## [1.34.17](https://github.com/bgill55/daedalus/compare/v1.34.16...v1.34.17) (2026-07-01) ### Bug Fixes * **tui:** handle Tab focus cycling when textbox is focused ([1974e1f](https://github.com/bgill55/daedalus/commit/1974e1ff2e0552f3ed66427908e618fd3cbb405a)) ## [1.34.16](https://github.com/bgill55/daedalus/compare/v1.34.15...v1.34.16) (2026-06-30) ### Bug Fixes * **cli:** limit list_files results to prevent context window token overflow ([620ba4a](https://github.com/bgill55/daedalus/commit/620ba4ac5d4d486aa2526ab5151e022406ae11f2)) ## [1.34.15](https://github.com/bgill55/daedalus/compare/v1.34.14...v1.34.15) (2026-06-30) ### Bug Fixes * **cli:** ignore build/dep folders in files tool & add max_tokens to completions ([346bb10](https://github.com/bgill55/daedalus/commit/346bb105a89e23099b15a40565e3620dd46ca5f8)) ## [1.34.14](https://github.com/bgill55/daedalus/compare/v1.34.13...v1.34.14) (2026-06-29) ### Bug Fixes * remove duplicate Tab key handlers that double-fire and skip widgets ([26dce71](https://github.com/bgill55/daedalus/commit/26dce713e0466f9f3fbb774deb374b1345626ede)) ## [1.34.13](https://github.com/bgill55/daedalus/compare/v1.34.12...v1.34.13) (2026-06-29) ### Bug Fixes * instruct model to skip tool calls for simple greetings in default system prompt ([7d21762](https://github.com/bgill55/daedalus/commit/7d21762ead99fa6e5d36e217e2cfd163d1cea8a0)) ## [1.34.12](https://github.com/bgill55/daedalus/compare/v1.34.11...v1.34.12) (2026-06-29) ### Bug Fixes * silence background terminal spinner in TUI mode to prevent logging escape sequences ([5f59c8d](https://github.com/bgill55/daedalus/commit/5f59c8d98db580b2fca07462c1106fd4d96225ee)) ## [1.34.11](https://github.com/bgill55/daedalus/compare/v1.34.10...v1.34.11) (2026-06-29) ### Bug Fixes * enable mouse tracking on blessed screen to activate mouse clicks on TUI widgets ([c76180a](https://github.com/bgill55/daedalus/commit/c76180a011aadb1bfcdc4368fae56d9a66466ea0)) ## [1.34.10](https://github.com/bgill55/daedalus/compare/v1.34.9...v1.34.10) (2026-06-29) ### Bug Fixes * intercept and discard tab keypresses in inputField textbox to prevent tab character input during focus shifts ([afc7cd7](https://github.com/bgill55/daedalus/commit/afc7cd7c79f859686192a0e7e193064aaf961cc9)) ## [1.34.9](https://github.com/bgill55/daedalus/compare/v1.34.8...v1.34.9) (2026-06-29) ### Bug Fixes * cast list element to any in click listeners to satisfy tsc ([df59155](https://github.com/bgill55/daedalus/commit/df59155b784e5a459ae6fccb9d830dc3fc69b99f))
* resolve overlapping sidebar borders, inputField tab focus capture, and mouse-clicks on TUI lists ([e90ddca](https://github.com/bgill55/daedalus/commit/e90ddca8ba84d242c40869acfb28f61eb31f4a3b)) ## [1.34.8](https://github.com/bgill55/daedalus/compare/v1.34.7...v1.34.8) (2026-06-29) ### Bug Fixes * set isTTY/columns/rows on customStdout so blessed gets proper terminal capabilities ([8792545](https://github.com/bgill55/daedalus/commit/879254555b1c5f2216697d40f2658b0618fa4217)) ## [1.34.7](https://github.com/bgill55/daedalus/compare/v1.34.6...v1.34.7) (2026-06-29) ### Bug Fixes * enable alternate screen buffer for TUI so terminal is properly cleared and restored on /tui ([413eac4](https://github.com/bgill55/daedalus/commit/413eac449b74d1c994fb6d287d45299e3abb0d92)) ## [1.34.6](https://github.com/bgill55/daedalus/compare/v1.34.5...v1.34.6) (2026-06-29) ### Bug Fixes * prevent rl.close() from ending process.stdout so TUI renders on /tui mode switch ([bfb6e7d](https://github.com/bgill55/daedalus/commit/bfb6e7dc836ca3e801f6f7cf8a3ac35f3e41c49e)) ## [1.34.5](https://github.com/bgill55/daedalus/compare/v1.34.4...v1.34.5) (2026-06-28) ### Bug Fixes * call customStdout write callback manually without passing to originalStdoutWrite to prevent buffering hangs on Windows ([871488e](https://github.com/bgill55/daedalus/commit/871488ec514583a2f74411a8607aef77a382c55b)) ## [1.34.4](https://github.com/bgill55/daedalus/compare/v1.34.3...v1.34.4) (2026-06-28) ### Bug Fixes * restore original stdout/stderr on main process catch ([cf5dc1b](https://github.com/bgill55/daedalus/commit/cf5dc1b496c87a6899f05161312f21ca86fef0bf)) ## [1.34.3](https://github.com/bgill55/daedalus/compare/v1.34.2...v1.34.3) (2026-06-28) ### Bug Fixes * remove manual callback invocation from customStdout stream to prevent ERR_MULTIPLE_CALLBACK crash ([ce083ab](https://github.com/bgill55/daedalus/commit/ce083ab28248ff26f4128fbf9e24fc3588a02612)) ## [1.34.2](https://github.com/bgill55/daedalus/compare/v1.34.1...v1.34.2) (2026-06-28) ### Bug Fixes * cast customStdout stream to any to resolve screen output type check error ([b241dd4](https://github.com/bgill55/daedalus/commit/b241dd40b22a38ac6f35a5d2cba45a842fbdb6d1))
* resolve infinite stdout write loop by introducing custom output stream wrapper for Blessed screen ([31340c7](https://github.com/bgill55/daedalus/commit/31340c7931830a79056c3b34470bf2971baa7ce7)) ## [1.34.1](https://github.com/bgill55/daedalus/compare/v1.34.0...v1.34.1) (2026-06-28) ### Bug Fixes * ensure readline interface is closed when exiting CLI REPL loop to prevent stdin lockups in TUI mode ([94da03c](https://github.com/bgill55/daedalus/commit/94da03c29e8e5bf8beda9bfa9574464ebfe64d40)) # [1.34.0](https://github.com/bgill55/daedalus/compare/v1.33.1...v1.34.0) (2026-06-28) ### Features * add /tui command to toggle between TUI and CLI modes dynamically ([1afde32](https://github.com/bgill55/daedalus/commit/1afde329fb61bf588e96a1bc27d80eec30dbd9b7)) ## [1.33.1](https://github.com/bgill55/daedalus/compare/v1.33.0...v1.33.1) (2026-06-28) ### Bug Fixes * resolve documentation out-of-sync test failures by updating sync script safety section and zod schema ([eeb137a](https://github.com/bgill55/daedalus/commit/eeb137a82f2961a4c02fd5e3e28aa2b7cd095d31)) # [1.33.0](https://github.com/bgill55/daedalus/compare/v1.32.3...v1.33.0) (2026-06-28) ### Features * implement interactive terminal dashboard TUI layout with system stats, model selection override, and codebase file explorer ([34cc593](https://github.com/bgill55/daedalus/commit/34cc593189a79831860663136ac30c6886e42116)) ## [1.32.3](https://github.com/bgill55/daedalus/compare/v1.32.2...v1.32.3) (2026-06-27) ### Bug Fixes * **orchestrator:** filter think blocks from execution results before error parsing ([8a43c31](https://github.com/bgill55/daedalus/commit/8a43c3118035b1226f42ded35757069574a23a75)) ## [1.32.2](https://github.com/bgill55/daedalus/compare/v1.32.1...v1.32.2) (2026-06-27) ### Bug Fixes * **orchestrator:** allow up to 4 consecutive read-only turns after file write before early exit ([3cc7f2b](https://github.com/bgill55/daedalus/commit/3cc7f2b010d8e9d1d0549362ab042263d6ec044e)) ## [1.32.1](https://github.com/bgill55/daedalus/compare/v1.32.0...v1.32.1) (2026-06-27) ### Bug Fixes * **orchestrator:** relax vague goal validation regex to support natural planning wording ([96ec6f2](https://github.com/bgill55/daedalus/commit/96ec6f2ccbd001f2650349cdc964d2a1674e6eb1)) # [1.32.0](https://github.com/bgill55/daedalus/compare/v1.31.0...v1.32.0) (2026-06-27) ### Features * add tech stack auto-scanning, todo checklist context, and model tier routing ([8ad7656](https://github.com/bgill55/daedalus/commit/8ad765693f6106387fc7132c61485db353a6ff27)) # [1.31.0](https://github.com/bgill55/daedalus/compare/v1.30.0...v1.31.0) (2026-06-27) ### Features * add vscode-extension to .gitignore and fix guardrail backticks ([d48bb93](https://github.com/bgill55/daedalus/commit/d48bb9304549a3e2db96bc5434090058473b9655))
* add vscode-extension to .gitignore and fix guardrail formatting ([a40a615](https://github.com/bgill55/daedalus/commit/a40a61534f5fb38a749abbcfd4c8f1639552ade5)) # [1.30.0](https://github.com/bgill55/daedalus/compare/v1.29.0...v1.30.0) (2026-06-25) ### Features * add git safety guard to prevent accidental deletion of git tracking data ([8828487](https://github.com/bgill55/daedalus/commit/88284872736a61a08c7736e3654c8352a31deaaf)) # [1.29.0](https://github.com/bgill55/daedalus/compare/v1.28.0...v1.29.0) (2026-06-25) ### Features * auto-detect scaffold anti-patterns and verify work after patches ([981531a](https://github.com/bgill55/daedalus/commit/981531ae161c4b44060da38f627ec2af9c20bfa5)) # [1.28.0](https://github.com/bgill55/daedalus/compare/v1.27.1...v1.28.0) (2026-06-25) ### Bug Fixes * satisfy strictPropertyInitialization for per-session projectRoot/projectHash ([7d9f008](https://github.com/bgill55/daedalus/commit/7d9f008d41ed8f8e4b1850ed3e6373ce8e4a56f5)) ### Features * make projectRoot and projectHash per-session; switch project contexts without restarting ([424fd8b](https://github.com/bgill55/daedalus/commit/424fd8b0404fb8f5b64b6629093e9df236f9858e)) ## [1.27.1](https://github.com/bgill55/daedalus/compare/v1.27.0...v1.27.1) (2026-06-24) ### Bug Fixes * prevent session auto-naming from using leaked system prompt text ([f06a493](https://github.com/bgill55/daedalus/commit/f06a493d4ac9956a91999573fcb73ecb82988535)) # [1.27.0](https://github.com/bgill55/daedalus/compare/v1.26.2...v1.27.0) (2026-06-24) ### Features * per-session project root switching — `/session new <path>` and `/session load` restore isolated project contexts in a single CLI instance; session-scoped projectRoot is now the source of truth for file access and codebase indexing
* cleaner CLI formatting — user box, assistant header, tool start fix, shorter separator ([4e23d5b](https://github.com/bgill55/daedalus/commit/4e23d5be18eeae4abda35e8f00ef6bdf0a20c260)) ## [1.26.2](https://github.com/bgill55/daedalus/compare/v1.26.1...v1.26.2) (2026-06-24) ### Bug Fixes * MCP on Windows, startup ordering, piped stdin race, tool awareness in system prompt ([cd34b43](https://github.com/bgill55/daedalus/commit/cd34b4372f292a192cea07322a7012ece799438a)) ## [1.26.1](https://github.com/bgill55/daedalus/compare/v1.26.0...v1.26.1) (2026-06-24) ### Bug Fixes * preserve pending tasks when replan validation fails ([e744f5e](https://github.com/bgill55/daedalus/commit/e744f5e1c57ba7fe7e970964569ac01e2cf9e6a1)) # [1.26.0](https://github.com/bgill55/daedalus/compare/v1.25.0...v1.26.0) (2026-06-24) ### Features * Sprint 2-4 — retry, resume, concurrency, debug cleanup ([d795479](https://github.com/bgill55/daedalus/commit/d7954794b6a13f3e9f63407eea33cf92c3874a61)) # [1.25.0](https://github.com/bgill55/daedalus/compare/v1.24.1...v1.25.0) (2026-06-24) ### Features * planner prompt rewrite, plan validation with retry, stronger coder content requirements ([e695858](https://github.com/bgill55/daedalus/commit/e695858d7175cc96d4bdbc7125809e461676c0f5)) ## [1.24.1](https://github.com/bgill55/daedalus/compare/v1.24.0...v1.24.1) (2026-06-24) ### Bug Fixes * prompt for install commands, block coder from running tests/git, early-exit on idle turns ([2ce178a](https://github.com/bgill55/daedalus/commit/2ce178a8c158cfc733f00b4bba28f80cbd75bffc)) # [1.24.0](https://github.com/bgill55/daedalus/compare/v1.23.0...v1.24.0) (2026-06-24) ### Features * improve orchestration reliability and model tool handling ([cbdd37f](https://github.com/bgill55/daedalus/commit/cbdd37fc9ffd6f9c43403ad51b10cf0934baa492)) # [1.23.0](https://github.com/bgill55/daedalus/compare/v1.22.7...v1.23.0) (2026-06-24) ### Features * improve orchestration reliability and model tool handling ([414cfd6](https://github.com/bgill55/daedalus/commit/414cfd64ecdb21d4371ac352c6cf7126fe783fca)) ## [1.22.7](https://github.com/bgill55/daedalus/compare/v1.22.6...v1.22.7) (2026-06-23) ### Bug Fixes * require real patch evidence for artifact verification ([453d47f](https://github.com/bgill55/daedalus/commit/453d47fc117f1a96f7c2044e22dfacbddc0133d2))
* improve orchestration reliability with model-agnostic tool call parsing and LM Studio custom tool block fallback ([6f5e78a](https://github.com/bgill55/daedalus/commit/6f5e78a))
* prevent task deduplication loops in re-planning and task-split paths by filtering completed file targets ([9a12b4c](https://github.com/bgill55/daedalus/commit/9a12b4c))
* raise coder agent maxTurns to 4 to allow exploration, write, and self-correction within a single task ([d4e8f1a](https://github.com/bgill55/daedalus/commit/d4e8f1a))
* improve artifact verification so hasRealWrites checks patch history instead of pre-existing file state ([b7c2e9d](https://github.com/bgill55/daedalus/commit/b7c2e9d)) ## [1.22.6](https://github.com/bgill55/daedalus/compare/v1.22.5...v1.22.6) (2026-06-23) ### Bug Fixes * deduplicate coder tasks by file path and block GUI test runners from plans ([3c156c3](https://github.com/bgill55/daedalus/commit/3c156c3baccc617e5075dbbf668fb71a20bab703)) ## [1.22.5](https://github.com/bgill55/daedalus/compare/v1.22.4...v1.22.5) (2026-06-23) ### Bug Fixes * block GUI app launchers (cypress/playwright) from terminal tool ([de02e1e](https://github.com/bgill55/daedalus/commit/de02e1e0bec9fc8e445cd755edeb7e32d80dc7c1)) ## [1.22.4](https://github.com/bgill55/daedalus/compare/v1.22.3...v1.22.4) (2026-06-23) ### Bug Fixes * improve orchestrate planner reliability and watchdog behavior ([81de52e](https://github.com/bgill55/daedalus/commit/81de52e5266a7a2737c9278cefb41dea9e2c740e)) ## [1.22.3](https://github.com/bgill55/daedalus/compare/v1.22.2...v1.22.3) (2026-06-23) ### Bug Fixes * enforce file-scope boundaries in orchestration, add /exit aliases, gate npm install commands ([744e035](https://github.com/bgill55/daedalus/commit/744e0358075aaeb3833923cdce491ddecce99c4e)) ## [1.22.2](https://github.com/bgill55/daedalus/compare/v1.22.1...v1.22.2) (2026-06-23) ### Bug Fixes * handle model refusal in agent tool calls and auto-retry in failure checkpoint ([3e3f6ae](https://github.com/bgill55/daedalus/commit/3e3f6aea8e4fd5770eed195501a080ff30c4fd11)) ## [1.22.1](https://github.com/bgill55/daedalus/compare/v1.22.0...v1.22.1) (2026-06-23) ### Bug Fixes * resolve orchestrator delegateTask test failure and clean up all lint warnings ([9c6ed59](https://github.com/bgill55/daedalus/commit/9c6ed59012283e40da97209dd6f6376fd1220fca))
* restore DiffOptions type import in files.ts ([3243f31](https://github.com/bgill55/daedalus/commit/3243f31e86998878d9f241e5555c03214f676e72)) # [1.22.0](https://github.com/bgill55/daedalus/compare/v1.21.5...v1.22.0) (2026-06-23) ### Features * add self-improvement via failure lessons and reviewer role ([9c1ad7f](https://github.com/bgill55/daedalus/commit/9c1ad7fe8e792bef92bd51d57a7124adef40df32)) ## [1.21.5](https://github.com/bgill55/daedalus/compare/v1.21.4...v1.21.5) (2026-06-23) ### Bug Fixes * **patch:** add line-level error attribution so pre-existing TS errors don't block edits ([6437331](https://github.com/bgill55/daedalus/commit/64373312239318a6f9dcfa165a319ebb47c069d0)) ## [1.21.4](https://github.com/bgill55/daedalus/compare/v1.21.3...v1.21.4) (2026-06-22) ### Bug Fixes * **orchestrator:** break patch retry spirals with per-file failure cap; improve diff-ui input handling ([fed4175](https://github.com/bgill55/daedalus/commit/fed41756c9ff547cd392e1fc203f4e71cc850ded)) ## [1.21.3](https://github.com/bgill55/daedalus/compare/v1.21.2...v1.21.3) (2026-06-22) ### Bug Fixes * per-task auto-approve, diff-ui hang, patch root-cause protections ([bdb910d](https://github.com/bgill55/daedalus/commit/bdb910d0beaf34eef76e336f099dc97609f1ae52)) ## [1.21.2](https://github.com/bgill55/daedalus/compare/v1.21.1...v1.21.2) (2026-06-22) ### Bug Fixes * **patch:** only flag TS errors in the patched file, not the whole project ([e73fac3](https://github.com/bgill55/daedalus/commit/e73fac3ec425cdbbebbbd4c565c036ae012f912a)) ## [1.21.1](https://github.com/bgill55/daedalus/compare/v1.21.0...v1.21.1) (2026-06-22) ### Bug Fixes * **index:** treat direct action requests as execute, not outline ([14c0ea3](https://github.com/bgill55/daedalus/commit/14c0ea3b1e99430719af89c08849ca4418eec8eb)) # [1.21.0](https://github.com/bgill55/daedalus/compare/v1.20.0...v1.21.0) (2026-06-22) ### Features * **orchestrator:** harden artifact verification against fake agent reports; tighten success checks and update system prompt persona ([aa2fc6d](https://github.com/bgill55/daedalus/commit/aa2fc6d646a6c3d9e78a39c2e6d064b0720d628e)) # [1.20.0](https://github.com/bgill55/daedalus/compare/v1.19.0...v1.20.0) (2026-06-22) ### Features * **prompts:** restore and sharpen dry humor and wit in system prompts ([f996641](https://github.com/bgill55/daedalus/commit/f996641db1dfac20b1609bc218976be45ad0a255)) # [1.19.0](https://github.com/bgill55/daedalus/compare/v1.18.1...v1.19.0) (2026-06-22) ### Features * bypass proceed gate on tool execution failure to enable autonomous error recovery ([e23d3e9](https://github.com/bgill55/daedalus/commit/e23d3e9d4d5d375e917344eb069803d3e8b917cc)) ## [1.18.1](https://github.com/bgill55/daedalus/compare/v1.18.0...v1.18.1) (2026-06-22) ### Bug Fixes * parse raw JSON first during fact extraction to avoid cleaning corruption ([5c94fde](https://github.com/bgill55/daedalus/commit/5c94fdef70bf7a18d26feb14332cdbaab508e86c)) # [1.18.0](https://github.com/bgill55/daedalus/compare/v1.17.0...v1.18.0) (2026-06-22) ### Features * /mcp command — discover, install, and manage MCP servers from the REPL ([60eb672](https://github.com/bgill55/daedalus/commit/60eb67262bdbd7056e8adc714cbfcb11f5bce563)) # [1.17.0](https://github.com/bgill55/daedalus/compare/v1.16.0...v1.17.0) (2026-06-22) ### Features * context summarization, faster startup, faster patching, cleaner UI ([62df67a](https://github.com/bgill55/daedalus/commit/62df67a56c4f520ece2fd1488ffbb8ec192c77a2)) # [1.16.0](https://github.com/bgill55/daedalus/compare/v1.15.0...v1.16.0) (2026-06-21) ### Features * display documentation repository link in help output and startup banner ([e904f55](https://github.com/bgill55/daedalus/commit/e904f55f6d0ffddb61fa81c5090da25da66a3e1f))
* **context:** LLM-based conversation summarization before hard pruning
* **startup:** fire-and-forget health checks and MCP connections for instant REPL prompt
* **patching:** chunk-based hash pre-filter for faster Levenshtein in findClosestBlock
* **ui:** compact aligned CLI output with subtle metadata and consistent indentation # [1.15.0](https://github.com/bgill55/daedalus/compare/v1.14.1...v1.15.0) (2026-06-21) ### Features * add automatic session descriptive naming and manual rename subcommand ([fd144c8](https://github.com/bgill55/daedalus/commit/fd144c8c0f42527d22865511d7a42e8371385a8e)) ## [1.14.1](https://github.com/bgill55/daedalus/compare/v1.14.0...v1.14.1) (2026-06-21) ### Bug Fixes * **cli:** prepend slash to orchestrate aliases so they are parsed correctly as commands ([60fafe3](https://github.com/bgill55/daedalus/commit/60fafe30aefe6f9651ffcadd814de7b1890af91b)) # [1.14.0](https://github.com/bgill55/daedalus/compare/v1.13.0...v1.14.0) (2026-06-21) ### Features * **cli:** add short aliases 'orc', 'run', 'o' for /orchestrate command ([b6eece9](https://github.com/bgill55/daedalus/commit/b6eece98ec27a05d11d037fafc93d1b2852169c2)) # [1.13.0](https://github.com/bgill55/daedalus/compare/v1.12.0...v1.13.0) (2026-06-21) ### Features * **cli:** add /changelog command and automatic upgrade notes display ([6c9a607](https://github.com/bgill55/daedalus/commit/6c9a6075c1c7db20ecc2cb4396de2006eb401392)) # [1.12.0](https://github.com/bgill55/daedalus/compare/v1.11.0...v1.12.0) (2026-06-21) ### Features * **orchestration:** add interactive task checklist, failure checkpoints, state resume, and planner sizing rules ([19ebe8d](https://github.com/bgill55/daedalus/commit/19ebe8d9776f621c564f9ecba5342058f9936aef)) # [1.11.0](https://github.com/bgill55/daedalus/compare/v1.10.1...v1.11.0) (2026-06-21) ### Features * implement resumable, gated orchestration and single-agent proceed checkpoints ([d6c48b9](https://github.com/bgill55/daedalus/commit/d6c48b994d31966a86cd2b84f71b4d6cb64ba8e0)) ## [1.10.1](https://github.com/bgill55/daedalus/compare/v1.10.0...v1.10.1) (2026-06-20) ### Bug Fixes * **orchestrator:** airtight artifact verification; enforce planner delegation format ([756640d](https://github.com/bgill55/daedalus/commit/756640dc280c85f742c4e2a99bf22c677ab6fc98)) # [1.10.0](https://github.com/bgill55/daedalus/compare/v1.9.7...v1.10.0) (2026-06-20) ### Features * **roles:** add instructions for tool error handling, imports, global fetch, and tsconfig ([1c7845c](https://github.com/bgill55/daedalus/commit/1c7845c5f29394719f2db8503e890a823db43536)) ## [1.9.7](https://github.com/bgill55/daedalus/compare/v1.9.6...v1.9.7) (2026-06-20) ### Bug Fixes * **extraction:** robustly parse relaxed JSON in fact extraction ([eceae9f](https://github.com/bgill55/daedalus/commit/eceae9f7d64d22647583cc05e4d8b98665206ad8)) ## [1.9.6](https://github.com/bgill55/daedalus/compare/v1.9.5...v1.9.6) (2026-06-20) ### Bug Fixes * **orchestrator:** add spinners during task delegation and print full un-sliced summaries ([0a6205d](https://github.com/bgill55/daedalus/commit/0a6205d31e531cb1ad95a2bb90b415bc1f2fbf4c)) ## [1.9.5](https://github.com/bgill55/daedalus/compare/v1.9.4...v1.9.5) (2026-06-20) ### Bug Fixes * **orchestrator:** normalize file path separators for verifyArtifacts on Windows ([db972d8](https://github.com/bgill55/daedalus/commit/db972d83f7a1e3a0d59d4a2574ce06e2617352d7)) ## [1.9.4](https://github.com/bgill55/daedalus/compare/v1.9.3...v1.9.4) (2026-06-20) ### Bug Fixes * **orchestrator:** implement turn-level cancellation and abort task loops on SIGINT ([8e489e2](https://github.com/bgill55/daedalus/commit/8e489e2967ddb221702e7244561d1aa343d022ff)) ## [1.9.3](https://github.com/bgill55/daedalus/compare/v1.9.2...v1.9.3) (2026-06-20) ### Bug Fixes * **files:** push to patchHistory when creating new files with write_file ([9135fa3](https://github.com/bgill55/daedalus/commit/9135fa3944694814da0ec69116e3685c48310564)) ## [1.9.2](https://github.com/bgill55/daedalus/compare/v1.9.1...v1.9.2) (2026-06-20) ### Bug Fixes * **orchestrator:** implement artifact verification guardrails and repair loops ([71e5848](https://github.com/bgill55/daedalus/commit/71e58486a90d206d3d90b9f49d12acadae2429b8)) ## [1.9.1](https://github.com/bgill55/daedalus/compare/v1.9.0...v1.9.1) (2026-06-20) ### Bug Fixes * restore process.stdin stream flow on Windows after child process executions ([ba2743a](https://github.com/bgill55/daedalus/commit/ba2743a44a8aec92798fc9501687ab8384d52d5b)) # [1.9.0](https://github.com/bgill55/daedalus/compare/v1.8.1...v1.9.0) (2026-06-20) ### Features * implement documented /session command ([63f4961](https://github.com/bgill55/daedalus/commit/63f4961ddff7f4abc30d15f062471086a029ece7)) ## [1.8.1](https://github.com/bgill55/daedalus/compare/v1.8.0...v1.8.1) (2026-06-20) ### Bug Fixes * resolve keyboard lockout during visual diff approval ([8eb032d](https://github.com/bgill55/daedalus/commit/8eb032d35001d2a6c1818cf63cc0c976c90022bf)) # [1.8.0](https://github.com/bgill55/daedalus/compare/v1.7.5...v1.8.0) (2026-06-20) ### Features * show a terminal spinner animation while tools are executing ([b7d8b14](https://github.com/bgill55/daedalus/commit/b7d8b1452c6741a7e834a4c4dfbae22622a88452)) ## [1.7.5](https://github.com/bgill55/daedalus/compare/v1.7.4...v1.7.5) (2026-06-20) ### Bug Fixes * ignore fs.watch error events to prevent unhandled process exit crashes on Windows ([360b353](https://github.com/bgill55/daedalus/commit/360b3536f0e7a7fc4cb668e88a72c80fcbeda88d)) ## [1.7.4](https://github.com/bgill55/daedalus/compare/v1.7.3...v1.7.4) (2026-06-20) ### Bug Fixes * **test:** close watcher inside afterEach to ensure clean teardown and prevent database accesses after closure ([07ef108](https://github.com/bgill55/daedalus/commit/07ef10888439a89b25c9c30b7ab1591c8416281b)) ## [1.7.3](https://github.com/bgill55/daedalus/compare/v1.7.2...v1.7.3) (2026-06-20) ### Bug Fixes * **test:** resolve macOS FSEvents latency and Windows file locking in watcher tests ([d02764b](https://github.com/bgill55/daedalus/commit/d02764b00a11bac030b146c0af590d28e3c51778)) ## [1.7.2](https://github.com/bgill55/daedalus/compare/v1.7.1...v1.7.2) (2026-06-20) ### Bug Fixes * **test:** add explicit RouterConfig type to avoid widened type inference of strategy property ([30b93a9](https://github.com/bgill55/daedalus/commit/30b93a95ff364c6e97b89c0c5573329366d1506c)) ## [1.7.1](https://github.com/bgill55/daedalus/compare/v1.7.0...v1.7.1) (2026-06-20) ### Bug Fixes * register /help command and map help and ? to it ([92bcc13](https://github.com/bgill55/daedalus/commit/92bcc139c13ff27826d81ccec6fb4eb8d162e890)) # [1.7.0](https://github.com/bgill55/daedalus/compare/v1.6.0...v1.7.0) (2026-06-20) ### Features * implement inline config setting via /config set ([86516ff](https://github.com/bgill55/daedalus/commit/86516ffcc182924e6177e187519ae381eebc8d32)) # [1.6.0](https://github.com/bgill55/daedalus/compare/v1.5.0...v1.6.0) (2026-06-20) ### Features * implement proactive model routing and default agent prompt guardrails ([29ec1fc](https://github.com/bgill55/daedalus/commit/29ec1fcfc26453379af7ba315158e8abe332229b)) # [1.5.0](https://github.com/bgill55/daedalus/compare/v1.4.1...v1.5.0) (2026-06-20) ### Features * implement concurrent background agent execution and task commands ([c74263d](https://github.com/bgill55/daedalus/commit/c74263de9ad26a0c2be8a636f9012a3e06bbce01)) ## [1.4.1](https://github.com/bgill55/daedalus/compare/v1.4.0...v1.4.1) (2026-06-20) ### Bug Fixes * use type-only imports and exports for router interfaces to prevent runtime ESM syntax errors ([db5df1d](https://github.com/bgill55/daedalus/commit/db5df1d8711c0f049826e997bc6fab3e6d8c9185)) # [1.4.0](https://github.com/bgill55/daedalus/compare/v1.3.0...v1.4.0) (2026-06-20) ### Features * enhance system prompts with terminal sandboxing and codebase indexing guidelines ([0439603](https://github.com/bgill55/daedalus/commit/0439603cd9a45577c4cfe2933a323d53a022c85c)) # [1.3.0](https://github.com/bgill55/daedalus/compare/v1.2.0...v1.3.0) (2026-06-20) ### Features * implement command execution sandboxing via Docker and WSL ([da297e1](https://github.com/bgill55/daedalus/commit/da297e1db3abe051c017400fe0e96dd019ff058a)) # [1.2.0](https://github.com/bgill55/daedalus/compare/v1.1.0...v1.2.0) (2026-06-20) ### Features * implement multi-candidate voting in Ensemble mode ([4b70f29](https://github.com/bgill55/daedalus/commit/4b70f29be733bffe006e394c04c442cc4b457bff)) # [1.1.0](https://github.com/bgill55/daedalus/compare/v1.0.1...v1.1.0) (2026-06-20) ### Features * implement incremental FTS5 indexing on file watch events ([f37faef](https://github.com/bgill55/daedalus/commit/f37faefd6185602a4c982390a12d610c49b0410f)) ## [1.0.1](https://github.com/bgill55/daedalus/compare/v1.0.0...v1.0.1) (2026-06-20) ### Bug Fixes * address code quality issues from audit ([2638587](https://github.com/bgill55/daedalus/commit/2638587efafb5258f0c156116c0f8998b49b8435)) # 1.0.0 (2026-06-20) ### Bug Fixes * stdin leak in approval gate — use rl.question instead of raw mode ([3fa5c3b](https://github.com/bgill55/daedalus/commit/3fa5c3b3b93e862107469cc914e1c6fb29381a1a))
* yield every file in indexer to prevent keyboard lag (was every 10 files) ([761d99f](https://github.com/bgill55/daedalus/commit/761d99fd2ad109b82eb76b585610dd16c762f52f)) ### Features * automatic update checker on startup ([2c858c3](https://github.com/bgill55/daedalus/commit/2c858c37fe8084463150b2de65056e4062d8f2c9))
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
* v0.5.0 — security audit fixes and personality ([ce6aedd](https://github.com/bgill55/daedalus/commit/ce6aedd87e1c32d8f0dd35c6cddfcd2475fa34a0)) # Changelog All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). ## [Unreleased] ### Added
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
- **`DAEDALUS_PROFILE_PATH` env var** — allows overriding profile path without mocking `os.homedir()` ### Fixed
- **Orchestrator error handling** — `run()` now catches errors and returns a graceful fallback message instead of crashing ## [0.5.24] - 2026-06-19 ### Added
- **Write-without-read guardrail** — `patch` and `write_file` are blocked on any existing file that has not been read this session, preventing edits based on hallucinated or stale content
- **Stale-read detection** — if a file's mtime advances after the last `read_file` call, the tool blocks and asks the model to re-read before patching
- **Circuit breaker** — after 2 consecutive failed patches on the same file, all further patch attempts are halted with a `[CIRCUIT BREAKER]` message to stop infinite retry loops
- **Import existence validation** — after every `write_file` or `patch`, local file imports and npm package references are verified against the disk and `package.json`; missing imports are reported as warnings in the tool result
- **Export consistency check** — after every write/patch, detects `export { name }` statements where `name` is not actually defined in the file
- **Auto-test loop** — after a successful write or patch, the co-located `*.test.ts` / `*.spec.ts` file (if present) is automatically run and any failures are fed back to the model as a tool result so it can self-correct
- **Large-rewrite annotation** — when more than 40% of a file's lines are replaced in a single diff, a yellow ` LARGE REWRITE` banner is shown in the interactive diff header
- `sessionReadCache` and `patchFailureStreak` fields added to `ToolContext` to track per-session read state and failure streaks
- 9 new unit tests covering all six trust features (40 total) ## [0.5.23] - 2026-06-19 ### Added
- **Fuzzy whitespace & indentation patching** — if `old_string` fails an exact match, `patch` performs a secondary whitespace-normalized search; if exactly one candidate block matches, the patch is applied automatically; multiple matches are safely rejected
- **Syntax validation guardrails** — after every `write_file` or `patch`, the affected file is syntax-checked (`.json` via `JSON.parse`, `.ts/.tsx` via `tsc --noEmit`, `.js/.mjs/.cjs` via `node --check`); if a syntax error is introduced the file is automatically reverted and the compiler error is returned to the model for self-correction
- **Context-aware patch hints** — when both exact and fuzzy matching fail, a Levenshtein sliding-window search (up to 300 lines) finds the closest matching block and returns it with the error message so the model can correct its patch immediately
- `normalizeWhitespace`, `fuzzyWhitespacePatch`, `levenshtein`, `findClosestBlock`, and `syntaxCheck` helpers in `src/tools/builtin/files.ts`
- 8 new unit tests covering fuzzy matching, hint generation, syntax validation, and JSON revert behaviour ## [0.5.22] - 2026-06-19 ### Added
- Automated placeholder detection guardrails in file manipulation tools (`write_file` and `patch`) to prevent local models from writing lazy ellipsis comments (like `// ...`) or abbreviated code placeholders into source files
- Promoted guidelines in agent system prompts warning against using code placeholders ## [0.5.21] - 2026-06-19 ### Added
- Integrated terminal-safe inline markdown renderer to print clean formatted bullet points, headers, bold, italics, and code blocks directly in CLI streaming outputs ## [0.5.20] - 2026-06-19 ### Added
- XML-style text-based tool call parsing (`<longcat_tool_call>` / `<tool_call>`) to support local models that output tool tags in their text response instead of native OpenAI function calling payloads
- Response model tracking to display the active model name and resolved ID in the turn metadata footer ### Changed
- Softened model call and fallback errors to yellow warning blocks suggesting `/doctor` rather than showing aggressive red stack traces ## [0.5.19] - 2026-06-19 ### Added
- Multi-Model Ensemble Drafting (Sprint 6): added `/ensemble <goal>` command to run a draft-review revision loop where a fast local model drafts changes and a smart model critiques them before writing to disk
- Support for target model routing in LocalRouter by matching request.model against configured names or model IDs in the chain ## [0.5.18] - 2026-06-19 ### Added
- Interactive hunk-level diff review and staging: choose `[c]hunks` at the apply diff prompt to accept (`y`), reject (`n`), stage all remaining (`a`), or quit (`q`) at the individual change hunk level ## [0.5.17] - 2026-06-19 ### Added
- Interactive TUI project file finder and fuzzy explorer: running `/add` without a filepath opens an interactive list view to search, navigate, and toggle files in and out of the active context with real-time fuzzy matching and scoring
- Flicker-free terminal re-rendering and raw keyboard state restoration ## [0.5.16] - 2026-06-19 ### Added
- `/debug <command>` command to run autonomous debugging loops: executes the command, captures errors/logs, invokes the model to patch relevant files, and re-runs the command (retrying up to 5 times)
- Tab autocompletion and help menu quickref support for `/debug` ## [0.5.15] - 2026-06-19 ### Added
- `/branch [name]` command to view the current active branch or create/switch branches directly in the REPL
- `/pr [base-branch]` command to automatically generate a detailed markdown Pull Request description comparing the current branch to a base branch (e.g. `main` or `master`) and save it to `pr-desc.md`
- Tab autocompletion and help menu quickref support for `/branch` and `/pr` ## [0.5.14] - 2026-06-19 ### Added
- Context budget and token usage meter directly visible in the REPL prompt (`[<files> · <tokens>] ›`)
- `/prune` command to view a detailed breakdown of context usage (system, files, history) and manually prune conversation turns
- Auto-pruning engine that runs before model calls to automatically truncate massive tool outputs or prune oldest turns if context exceeds configured thresholds
- Co-located unit tests for token calculation and pruning algorithm under `src/session/tokens.test.ts` ## [0.5.13] - 2026-06-19 ### Changed
- Refactored user prompt box to render as a compact, shrink-to-fit card/bubble instead of spanning the entire terminal width
- Removed borders and padding from the assistant blocks to match a clean, unboxed modern chat UI style ### Fixed
- Corrected off-by-one border alignment math in user prompt box rendering ## [0.5.12] - 2026-06-19 ### Fixed
- Fixed off-by-one border misalignment in the user prompt box
- Fixed misaligned static border widths in the interactive diff approval UI to dynamically scale with file paths ## [0.5.11] - 2026-06-19 ### Added
- Cached Windows shell detection in `/terminal` tool to eliminate process spawn lag
- Concurrent MCP server initialization (parallel `Promise.all` connections) ### Fixed
- Asynchronous boot health checks: initial health checks now run in the background to prevent boot blocking
- Included Authorization header with API key in health check fetches to prevent auth failures on remote endpoints ## [0.5.10] - 2026-06-19 ### Fixed
- Restored missing SIGINT handler registration in main function to fix syntax error
- Refined terminal outputs: replaced emojis with standardized text labels (`[OK]`, `[WARN]`, `[ERROR]`) to align with style guide - Indexer yields after every file instead of every 10 — eliminates keyboard lag during background indexing (v0.5.9) ### Added - **Auto-fact extraction** — after each turn with learning signals (file edits, commits), Daedalus silently extracts key-value facts and saves them to project memory. The CLI that grows with you. - `/extract` command — manually trigger fact extraction from the current session
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
- Personality: dry humor injected into system prompts, tool descriptions, agent roles, banner, and diff UI ### Fixed - stdin leak in approval gate — switched from raw mode keypresses to readline.question() to prevent character bleed into the next prompt ### Fixed - CRITICAL: Path traversal in resolvePath — now enforces project directory boundary
- CRITICAL: Sub-agent auto-approval in diff UI — removed isSubAgent bypass
- HIGH: Environment variables leaked to child processes — sanitized env in terminal and MCP stdio
- HIGH: Shell injection in search_files — replaced shell command construction with direct spawn
- HIGH: Config file world-readable permissions — chmod 0600 on non-Windows
- HIGH: openEditor shell:true — changed to shell:false
- HIGH: MCP stdio command injection — validates command for shell metacharacters
- HIGH: Clipboard script security — added random suffix to temp files, size limit on text paste ## [0.4.2] - 2026-06-18 ### Changed - Word-wrap box content to terminal width for better readability
- User top border alignment fix
- All message boxes share consistent border width ### Added - Image paste support via `/paste` command
- Dynamic version read from package.json ## [0.4.1] - 2026-06-18 ### Changed - Made `indexCodebase` fully async so auto-index doesn't block startup
- Updated README and package metadata
- Renamed npm package to `daedalus-cli` (name conflict resolution) ## [0.3.0] - 2026-06-18 ### Added - Initial release
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
