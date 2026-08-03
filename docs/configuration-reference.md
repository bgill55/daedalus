# Configuration Reference Guide

This guide describes all configuration options available in Daedalus. You can view them using the `/config` command and update them using the `/config set <key> = <value>` command. All settings updated via the command line are validated and applied instantly in real-time without requiring a CLI restart.

---

## General Settings

*   **`version`**: Config file schema version. Do not edit manually. Default: 1.
*   **`modelOverride`**: Pin a specific model for the current session, bypassing routing, complexity classification, and auto-escalation. Set via /config, /model, or a project .daedalusrc override.
*   **`updateCheck`**: When true, checks for new Daedalus CLI versions on startup and notifies you. Default: true.

---

## Router Settings

*   **`router.strategy`**: Routing strategy: "priority" (try models in order), "round-robin" (cycle evenly), or "fastest" (lowest latency). Default: "priority".
*   **`router.chain`**: Ordered list of model endpoint configurations. Each entry defines name, endpoint URL, model, priority, tier, and capability flags.
*   **`router.healthCheckInterval`**: Interval in milliseconds between background health checks on configured endpoints. Default: 30000.
*   **`router.requestTimeout`**: Maximum wait in milliseconds for a model response before considering it failed. Default: 120000.
*   **`router.defaultRateLimit`**: Default rate limit settings (rpm and tpm) applied when an endpoint does not advertise its own limits.
*   **`router.autoEscalate`**: When true, automatically switches to the next chain model after repeated tool failures. Default: true.
*   **`router.complexityRouting`**: When true, routes each task by complexity tier: simple tasks use the fast tier, complex tasks use the intelligence tier, with on-the-fly reclassification mid-task. Default: true.

---

## Agent Settings

*   **`agents.default`**: Default agent role used when no specific role is requested. Default: "coder".
*   **`agents.available`**: List of available agent roles for orchestration (orchestrator, planner, coder, reviewer, debugger, researcher).
*   **`agents.autoOrchestrate`**: When true, automatically invoke the orchestrator for complex multi-step tasks instead of single-agent mode. Default: true.
*   **`agents.ensemble`**: Ensemble drafting pipeline config: enables multi-model collaboration with draft and critic models for improved output quality.

---

## Tool Settings

*   **`tools.builtin`**: List of built-in tool identifiers available to agents (read_file, write_file, patch, terminal, web_search, etc.).
*   **`tools.mcpServers`**: Map of MCP server configurations. Each entry defines transport (stdio/http), command, args, URL, headers, and enabled flag.
*   **`tools.shell`**: Preferred shell executable for terminal commands (e.g. "powershell", "bash", "/bin/zsh"). Falls back to SHELL env or OS default.
*   **`tools.sandbox`**: Execution sandbox mode: "none" (host direct), "docker", or "wsl" (Windows). Default: "none".
*   **`tools.sandboxImage`**: Docker image used when sandbox is set to "docker". Default: "node:20".
*   **`tools.wslDistribution`**: WSL distribution name used when sandbox is set to "wsl" (e.g. "Ubuntu", "Debian").

---

## Image Generation Settings

*   **`imageGen.enabled`**: Enable/disable local image generation tool and commands (default: true).
*   **`imageGen.provider`**: Image generation engine ("auto", "sd-webui", or "pollinations"). Defaults to "auto" (attempts local SD WebUI first, falling back to free Pollinations AI).
*   **`imageGen.endpoint`**: Local Stable Diffusion WebUI API endpoint URL (default: "http://127.0.0.1:7860").
*   **`imageGen.defaultWidth`**: Default image width in pixels (default: 512).
*   **`imageGen.defaultHeight`**: Default image height in pixels (default: 512).
*   **`imageGen.defaultSteps`**: Default sampling steps for image generation (default: 20).
*   **`imageGen.outputDir`**: Default directory to save generated PNG images (default: "./assets/images").

---

## Context Settings

*   **`context.maxTokens`**: Maximum token budget for the active conversation context window. Default: 128000.
*   **`context.summarizeAt`**: Threshold (0.0-1.0) of token budget usage that triggers automatic summarization. Default: 0.8.
*   **`context.includeGitDiff`**: When true, automatically includes git diff output in the system prompt for context awareness. Default: true.
*   **`context.includeIndex`**: When true, includes codebase index search results in the system prompt. Default: true.

---

## Codebase Indexing Settings

*   **`indexing.enabled`**: Enable/disable automatic FTS5 codebase indexing on startup. Default: true.
*   **`indexing.watch`**: Enable/disable the background file watcher for real-time symbol re-indexing. Default: true.
*   **`indexing.languages`**: List of file extensions/languages to index (e.g. typescript, python, go, rust).
*   **`indexing.exclude`**: List of directory patterns to exclude from codebase indexing.

---

## Session Settings

*   **`session.autoSave`**: When true, automatically saves session state after each conversation turn. Default: true.
*   **`session.exportJsonl`**: When true, exports session history as JSONL for external analysis. Default: true.
*   **`session.maxHistoryTurns`**: Maximum number of conversation turns retained in session history. Default: 200.

---

## UI Settings

*   **`ui.streaming`**: When true, streams model responses token-by-token in real-time. Default: true.
*   **`ui.showTokens`**: When true, displays estimated token counts alongside responses. Default: true.
*   **`ui.showCost`**: When true, displays estimated cost per response for cloud models. Default: true.
*   **`ui.diffStyle`**: Diff display style: "unified" or "side-by-side". Default: "unified".
*   **`ui.theme`**: UI theme: "dark", "light", or "auto" (follow system). Default: "dark".
*   **`ui.tui`**: When true, launches the terminal user interface (TUI) dashboard on start. Default: false.
*   **`ui.compactMode`**: When true, compresses non-essential CLI output for a cleaner terminal display. Default: true.
*   **`ui.collapseCommentary`**: When true, collapses verbose model commentary into a single line instead of printing full paragraphs. Default: true.

---

## Safety Settings

*   **`safety.protectGit`**: When true, requires explicit user confirmation before running git operations. Default: true.
*   **`safety.autoApprove`**: When true, automatically approves terminal command execution without user prompt. Default: false.

---

## Update Settings

*   **`updateCheck`**: When true, checks for new Daedalus CLI versions on startup and notifies you. Default: true.
