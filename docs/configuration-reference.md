# Configuration Reference Guide

This guide describes all configuration options available in Daedalus. You can view them using the `/config` command and update them using the `/config set <key> = <value>` command. All settings updated via the command line are validated and applied instantly in real-time without requiring a CLI restart.

---

## Router Settings

*   **`router.strategy`**: The model routing strategy (`"priority"`, `"round-robin"`, or `"fastest"`).
*   **`router.chain`**: The array of configured model endpoints in the routing chain.
*   **`router.healthCheckInterval`**: Interval in milliseconds between background health checks (default: `30000`).
*   **`router.requestTimeout`**: Timeout in milliseconds for model API requests (default: `120000`).
*   **`router.defaultRateLimit`**: Default rate limiter settings (RPM and TPM) for endpoints.

---

## Agent Settings

*   **`agents.default`**: The default agent role to spawn when none is specified (default: `"coder"`).
*   **`agents.available`**: Array of available agent roles inside the REPL session.
*   **`agents.autoOrchestrate`**: Enable/disable automatic multi-agent orchestration for complex prompts (default: `true`).
*   **`agents.ensemble`**: Settings for multi-model ensemble drafting (e.g., candidate count, max loops).

---

## Tool Settings

*   **`tools.builtin`**: The list of built-in CLI tools enabled for agent use.
*   **`tools.mcpServers`**: Configured Model Context Protocol (MCP) servers (stdio/HTTP SSE transport) to extend the agent's tool registry.
*   **`tools.shell`**: The preferred shell command executable or path (e.g., `"powershell"`, `"bash"`, `"cmd"`).
*   **`tools.sandbox`**: Isolated execution environment sandbox (`"none"`, `"docker"`, or `"wsl"`).
*   **`tools.sandboxImage`**: Docker image name to run commands inside when using Docker sandboxing (default: `"node:20"`).
*   **`tools.wslDistribution`**: Linux distribution name to run commands inside when using WSL sandboxing.

---

## Image Generation Settings

*   **`imageGen.enabled`**: Enable/disable local image generation tool and commands (default: true).
*   **`imageGen.endpoint`**: Local Stable Diffusion WebUI API endpoint URL (default: "http://127.0.0.1:7860").
*   **`imageGen.defaultWidth`**: Default image width in pixels (default: 512).
*   **`imageGen.defaultHeight`**: Default image height in pixels (default: 512).
*   **`imageGen.defaultSteps`**: Default sampling steps for image generation (default: 20).
*   **`imageGen.outputDir`**: Default directory to save generated PNG images (default: "./assets/images").

---

## Context Settings

*   **`context.maxTokens`**: Maximum context window limit allowed for model prompts (default: `128000`).
*   **`context.summarizeAt`**: Percentage threshold of context window consumption at which to summarize history (default: `0.8`). When exceeded, Daedalus first attempts an LLM-based summarization of older turns into a compressed system message, preserving key decisions and files changed. If still over budget after summarization, hard pruning removes the oldest cycles and truncates oversized tool outputs.
*   **`context.includeGitDiff`**: Include/exclude the current active git diff in model context prompts (default: `true`).
*   **`context.includeIndex`**: Include/exclude codebase search index context in prompts (default: `true`).

---

## Codebase Indexing Settings

*   **`indexing.enabled`**: Enable/disable codebase file indexing on CLI start (default: `true`).
*   **`indexing.watch`**: Enable/disable incremental index updates via file watching (default: `true`).
*   **`indexing.languages`**: Array of programming languages to parse and index (default: `["typescript", "python", "go", "rust"]`).
*   **`indexing.exclude`**: Array of directory paths to ignore during indexing (default: `["node_modules", "dist", ".git"]`).

---

## Session Settings

*   **`session.autoSave`**: Auto-save chat transcripts and active files on REPL exit (default: `true`).
*   **`session.exportJsonl`**: Export chat history to JSONL format alongside the SQLite db (default: `true`).
*   **`session.maxHistoryTurns`**: Maximum number of recent conversation turns to retain in session state (default: `200`).

---

## UI Settings

*   **`ui.streaming`**: Stream tokens in real-time as the model generates them (default: `true`).
*   **`ui.showTokens`**: Output token usage statistics after model turns (default: `true`).
*   **`ui.showCost`**: Output cost estimation stats after model turns (default: `true`).
*   **`ui.diffStyle`**: Visual diff style to display for code patches (`"unified"` or `"side-by-side"`).
*   **`ui.theme`**: CLI theme colors (`"dark"`, `"light"`, or `"auto"`).
*   **`ui.tui`**: Enable/disable launching the terminal dashboard TUI layout by default (default: `false`).

---

## Safety Settings

*   **`safety.protectGit`**: Protect `.git/` directory and tracked git files from accidental deletion via file and terminal tools (default: `true`). Set to `false` in `~/.daedalus/config.json` to disable.
*   **`safety.autoApprove`**: Auto-approve all model turn gates and execution steps without prompting the user for approval. Enabling this allows unattended/auto-pilot execution (default: `false`).

---

## Update Settings

*   **`updateCheck`**: Check the npm registry for new versions of `daedalus-cli` on startup (default: `true`).
