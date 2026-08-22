#  Daedalus Local-First Onboarding Cheat Sheet 

Welcome to **Daedalus**, a standalone local-first AI coding assistant and multi-agent developer workbench. This reference guide compiles the most critical commands, environment variables, safety rules, and hardware optimizations you need to run Daedalus efficiently and privately on your machine.

---

###  1. Critical Slash Commands
Run these commands inside the active Daedalus REPL shell to configure models, trace codebases, and manage active agent sessions.

####  Model & Connection Management
* **`/onboard`** – Reruns the interactive setup wizard to scan local ports and configure remote API connections.
* **`/preset`** – Views and applies curated, ready-to-use provider chains:
  * `local-free`: Direct local default setups (Ollama / LM Studio) with zero token fees.
  * `cloud-power`: High-intelligence BYOK setup (Anthropic, OpenAI, or OpenRouter).
  * `hybrid`: Dual-tier setup utilizing a fast local model for minor edits + cloud models for complex tasks.
  * `privacy-strict`: 100% offline local execution with web tools disabled.
* **`/model`** – Lists, adds, removes, enables, or disables configured models dynamically without manually modifying JSON configuration files.
* **`/health`** – Displays active provider connection status, latency metrics, and API key configurations.

####  Codebase Code-Tracing & Refactoring
* **`/find <symbol>`** – Searches exact FTS5 symbol definitions across indexed project files.
* **`/refs <symbol>`** – Trace caller references to see where a specific function or class is imported/used.
* **`/callgraph <symbol> [depth]`** – Displays a bidirectional visual function call graph and predicts refactoring blast radius.
* **`/impact <symbol>`** – Automatically calculates a `LOW`, `MEDIUM`, or `HIGH` blast-radius risk score for code changes to that symbol.

####  Trajectory Branching & Memory
* **`/session branch <name>`** – Creates an immutable snapshot of conversation turns and active context up to the current step.
* **`/session checkout <name>`** – Switches the active REPL session to an alternative branch to explore different implementation paths.
* **`/session branches`** – Renders a hierarchical tree visualization of your active and archived chat session branches.
* **`/session merge <name>`** – Automatically extracts code diffs from step \(K+1\) of an experimental branch, applies them to the workspace via git, and appends the chat history back to the parent session.
* **`/sigma` / `/memory`** – View active SQLite-backed session memories, usefulness scores, and decay counts in real-time.

####  Playbooks & Task Delegation
* **`/skills`** – Lists active trusted skills and lets you review, accept, or discard agent-proposed playbook drafts stored in `~/.daedalus/skills/.drafts/`.
* **`/shortcut <alias> = <command>`** – Create custom aliases for frequently executed workflows (e.g. `/shortcut qt = /test 1 -g`).

---

###  2. Essential Environment Variables
Configure these flags in your terminal profile or local `.env` file to customize agent runtime behavior and enable integrations.

| Variable | Recommended Value | Impact |
| :--- | :--- | :--- |
| **`DAEDALUS_ALLOW_INSTALL`** | `true` | Allows non-blocking autopilot runs by auto-approving package installs (`npm install`, `pip install`, etc.). |
| **`DAEDALUS_AUTO_APPROVE`** | `true` | Enables non-interactive auto-approval for shell commands and automated refactoring passes. |
| **`DISCORD_WEBHOOK_URL`** | `https://discord.com/api/...` | Enables rich color-coded status embeds on Discord for spec queuing, work starts, self-review alerts, and PR readiness. |
| **`DAEDALUS_DEBUG`** | `true` | Logs detailed routing telemetry, showing initial classifications and end-of-turn complexity tier shifts. |
| **`GITHUB_TOKEN`** / **`GH_TOKEN`** | `your_token` | Authenticates with GitHub to automatically poll labeled issues, create branches, and submit PRs. |

---

###  3. Hardware Optimization (For 8GB VRAM / 32GB RAM GPUs)
Running local LLMs on standard consumer hardware can lead to massive bottleneck hangs if the context spills over into CPU system RAM. Use these parameters to keep your local stack blazing fast:

1. **Restrict Context Length to `8192` (8k)**: Modern local models default to 32k context lengths. Restricting the context ceiling to 8k in LM Studio or Ollama hardware settings guarantees that the active model fits entirely inside VRAM, avoiding CPU fallback slowness.
2. **Use Optimized GGUF Quantizations**: The officially recommended model stack for local development includes:
   * **`Qwen2.5-Coder-7B-Instruct`** (Quantized to `Q4_K_M` or `Q5_K_M`) – Highly accurate, multilingual code generation and editing.
   * **`Llama-3-8B-Instruct`** (Quantized to `Q4_K_M` or `Q5_K_M`) – Perfect for general task planning and multi-agent orchestration.

---

###  4. Embedded Guardrails & Resilience Mechanisms
Daedalus utilizes intentional safety loops designed to preserve your token budgets and protect codebases from recursive errors:

* **Command Circuit Breaker**: Tracks **normalized command prefixes** (`cd`, `npm install`). If the exact same command is executed 3 consecutive times with no progress or fails repeatedly, the circuit breaker halts execution and prompts for a change in approach.
* **Batch Short-Circuit**: If a single agent turn requests multiple actions (e.g. `[patch(src/app.ts), terminal("npm test")]`) and a file-modifying tool fails, Daedalus **aborts all subsequent dependent calls** to prevent executing builds against corrupt code. Read-only tools (like `read_file` or `git_diff`) continue running to allow inspection.
* **Pre-Flight Codebase Auditing (Task 0)**: Before executing new tasks, Daedalus runs `npx tsc --noEmit`. If pre-existing TypeScript compilation or build errors are found, the system automatically prepends **Task 0** to your plan, assigning the Asclepius (debugger) agent to fix existing issues first.
