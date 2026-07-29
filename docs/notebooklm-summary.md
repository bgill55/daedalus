# Daedalus: Local-First AI Coding CLI & Agent Orchestrator

Daedalus (published on npm as `daedalus-cli`) is a local-first AI coding companion and multi-agent developer workbench. It runs locally on your machine, leveraging local or cloud-based Large Language Models (LLMs) to plan, execute, debug, and verify software engineering tasks while keeping your code and intellectual property completely private.

<p align="center">
  <img src="images/notebooklm_infographic.jpg" alt="Daedalus: The Architect of Autonomous Coding Infographic" width="100%"/>
</p>

---

## Core Philosophy & Design

* **Local-First & Private**: Integrates with local LLM providers (LM Studio, Ollama, llama.cpp, vLLM) so that your source code does not leave your local network. It can also route to cloud providers (OpenAI, Anthropic, Gemini, Groq) if configured.
* **Multi-Agent Orchestration**: Instead of a single LLM trying to solve complex tasks in one go, Daedalus delegates work to specialized autonomous sub-agents collaborating under a planner.
* **Loop Engineering & Verifiability**: Unlike models that edit code and hope it works, Daedalus runs stack-aware verification checks (compiling, linting, unit testing) after every edit and automatically repairs syntax errors or rolls back files on failure.
* **Premium UX**: Runs as a simple terminal command line or a rich terminal user interface (TUI) featuring real-time CPU/RAM gauges and dynamic file-tree context selectors.

---

## 1. System Architecture & Agent Roles

Daedalus coordinates five specialized sub-agents to divide and conquer coding goals:

* **Planner**: Explores requirements, creates step-by-step task lists, and determines acceptance criteria for verification.
* **Coder**: Writes new files, makes surgical edits using a patch tool, and executes shell scripts.
* **Researcher**: Explores the local workspace, reads documentation, and searches the web.
* **Debugger**: Runs test suites, analyzes error logs, and corrects syntax/logic failures.
* **Reviewer**: Reviews pull requests, runs security checks, and validates styles/formatting.

### Loop Engineering Lifecycle

```mermaid
graph TD
    Goal[User Goal] --> Plan[Planner: Create Tasks]
    Plan --> Execute[Coder: Draft Patches]
    Execute --> Verify[Verify: Compile & Test]
    Verify -- Success --> Commit[Git: Commit Changes]
    Verify -- Fail --> Repair[Debugger: Read Error & Repair]
    Repair --> Verify
    Repair -- Max Retries Exhausted --> Rollback[Rollback: Revert Files to Clean State]
```

---

## 2. Key Features

### 1. Embedded Model Router, Tier Selection & Multi-Model Fallback Chain
Daedalus features an embedded model router that handles failover, round-robin, priority, or fastest-response load balancing across local and remote LLMs.
* **Model Tiers**: Configurations divide models into tiers (`intelligence`, `standard`, `fast`). High-effort tasks (planning, code reviews) route to intelligence models (e.g., GPT-4o, Claude 3.5 Sonnet), while simple edits route to standard/fast local models.
* **Multi-Model Fallback Chain**: If a provider returns a rate-limit (429), timeout, or 5xx server error, the router automatically fails over to the next candidate model in the chain without interrupting active user sessions or agent execution loops.

### 2. Auto-Discovery Tech Stack Scanner
On startup, Daedalus scans your project files (such as `package.json`, `tsconfig.json`, `Cargo.toml`, `go.mod`, `requirements.txt`) to determine the exact frameworks, scripts, and compilers. This prevents the LLM from hallucinating wrong syntax, libraries, or build flags.

### 3. Cursor & Claude Code Rules Compatibility
Daedalus automatically detects and inherits instructions from `CLAUDE.md`, `.cursorrules`, `.daedalusrules`, and `DAEDALUS.md` files located in your project's root. This lets you import existing senior-developer guidelines directly into your local Daedalus turns without any manual conversion.

### 4. Background Live File-Watcher (`/watch`)
Runs a background file watcher using SQLite FTS5. As you edit and save files in your editor, Daedalus updates codebase symbol definitions and call-graph references in real-time without requiring manual re-indexing.

### 5. Git-Aware Smart Testing (`/test -g`)
Inspects `git status` to identify modified source files, maps them to their corresponding `*.test.ts` unit test suites, and runs only affected test files—reducing test feedback loops from seconds to less than 200ms.

### 6. MCP Marketplace & Explorer (`/mcp explore`)
Full native Model Context Protocol (MCP) server support over `stdio` and `http` (SSE). Includes an interactive marketplace (`/mcp explore`) to search and install community MCP servers (GitHub, SQLite, Postgres, Puppeteer, Memory, Google Drive) with one-click setup.

### 7. Persistent Memory & User Profiles
* **Project Memory**: Auto-detects and persists project facts and custom coding conventions across sessions.
* **User Profile**: Customizes agent tone, experience level, preferred terminal shell, and coding style.

### 8. Autonomous Finn Loop
Exposes a fully autonomous developer workflow (Spec → Build → Review → PR → Discord Notify):
* `/spec` command: Interactively gathers requirements, generates a markdown spec, and opens a GitHub Issue labeled `daedalus-todo`.
* `daedalus --loop` daemon: Polls GitHub for open issues, runs autonomous orchestration to solve them, executes verifications, commits changes, opens a Pull Request, and alerts team channels via Discord Webhooks.

### 9. OS & System Diagnostics Awareness
Daedalus detects the user's operating system, hardware, and shell environment at startup and injects structured system diagnostics into the system prompt. The `system_info` tool exposes platform, architecture, CPU count, memory, and shell type to the LLM for context-aware terminal command generation.

### 10. Autonomous Feature Branching (`/autopilot`)
End-to-end autonomous feature development from a single command:
* `/autopilot <feature>`: Creates a git branch, runs the multi-agent orchestrator to implement the feature, verifies with build/lint/tests, commits, pushes, and opens a GitHub Pull Request. On failure, automatically rolls back to main.

### 11. Live Preview (`/preview`)
Renders local HTML files or URLs in headless Chromium and captures a PNG screenshot:
* `/preview <filepath-or-url>`: Converts local file paths to `file://` URLs, launches headless Chrome via Puppeteer, screenshots the page, and saves the image to `~/.daedalus/screenshots/`.

### 11. AST-Aware Call Graph & Refactoring Blast-Radius Engine (`/callgraph`, `/impact`)
Performs bidirectional call-graph traversal (inbound callers and outbound callees) and blast-radius risk scoring (`LOW`, `MEDIUM`, `HIGH`) from SQLite FTS5 symbol indexes to predict affected files and callers before refactoring. Exposes `get_call_graph` tool to LLM sub-agents for structural dependency analysis.

### 12. Headless CI/CD PR Reviewer & Automated Fix Bot (`daedalus --ci`, `/ci`)
Runs Daedalus in headless non-interactive mode (`daedalus --ci`) inside GitHub Actions workflows or local developer sessions (`/ci`). Executes type-checking (`npx tsc`), linter checks (`npm run lint`), and git diff security audits, posting automated Markdown review reports directly to GitHub Pull Requests and executing automated linter repairs (`/ci fix`).

### 13. Chat-History Branching System ("What-if" Sessions)
Enables non-linear exploration of coding tasks by snapshotting and branching sessions:
* `/session branch <name>`: Takes an immutable snapshot of conversation turns and active context up to step $N$, saved as JSONL.
* `/session checkout <name>`: Switches active REPL context to an existing branch.
* `/session branches`: Displays a hierarchical tree visualization of session parent-child branches.
* `/session merge <name>`: Extracts unified `code_diff` patches from step $N+1$ onwards, applies them via `git apply`, appends trajectory turns to parent history, and marks status as `merged`. JSONL parse errors during merge are collected and reported instead of silently ignored.

---

## 3. Real-World Benchmarks & Practical Case Studies

### Test Suite Growth
Daedalus maintains a test suite of **468 tests across 56 files** (Vitest), covering the model router, session branching, tool execution, config validation, codebase indexing, MCP transport, CLI commands, the git-based merge system, and system diagnostics.

### Case Study A: Autonomous Feature Engineering (`/health` Command)
* **Objective**: Implement a new `/health` command in Daedalus CLI to display model router provider latency, health status, and API key statuses.
* **Workflow**: Generated spec via `/spec`, created GitHub Issue #6, spawned coder agent to build `src/commands/health.ts`, verified with `npx tsc --noEmit` and Vitest unit tests, opened PR #7, ran automated code review with reviewer rules, and merged clean code.

### Case Study B: Social Media Manager Automation
* **Objective**: Build a full-stack social media scheduling dashboard and AI content generator.
* **Workflow**: Daedalus scanned project stack, orchestrated sub-agents to generate React/Vite UI components, configured SQLite storage, added unit test coverage, verified builds, and deployed with zero manual syntax errors.

### Case Study C: Multi-Model Failover Under Rate Limits
* **Scenario**: Primary local model endpoint hits a 429 rate limit mid-orchestration turn.
* **Behavior**: Model router marked endpoint unhealthy, seamlessly failed over to secondary model in priority chain, completed tool calls, and returned complete response with zero session failure.

---

## 4. CLI Commands Reference

| Command | Category | Description |
|---|---|---|
| `/autopilot <feature>` | Multi-Agent | Autonomous feature dev: branch, implement, verify, commit, and PR |
| `/orchestrate <goal>` | Multi-Agent | Launch multi-agent planning and execution loop |
| `/spawn [--bg] <role> <task>` | Multi-Agent | Delegate a background task to a sub-agent |
| `/task <id>` | Multi-Agent | Manage or inspect background tasks |
| `/tasks` | Multi-Agent | List active background tasks |
| `/ensemble <goal>` | Multi-Agent | Run multi-model ensemble drafting pipeline |
| `/spec <idea>` | Workflow | Interactively flesh out a feature spec and open GitHub Issue |
| `/debug <command>` | Workflow | Run a command and autonomously debug failures |
| `/undo [count\|list]` | Workflow | Revert the last N file patches or list recent patches |
| `/watch [start\|stop\|status]` | Codebase | Background file watcher for automatic symbol re-indexing |
| `/index` | Codebase | Manually index codebase symbols into SQLite FTS5 |
| `/find <query>` | Codebase | Search indexed symbols in project |
| `/refs <symbol>` | Codebase | Find symbol caller references |
| `/def <symbol>` | Codebase | Jump to symbol definition |
| `/callgraph <symbol> [depth]` | Codebase | Display bidirectional function call graph and blast radius |
| `/impact <symbol>` | Codebase | Analyze refactoring impact & blast radius for a symbol |
| `/test [n] [-g]` | Dev Tools | Run test loop and repair failures (`-g` for git-aware smart testing) |
| `/commit [msg]` | Dev Tools | Stage and commit git changes |
| `/branch [name]` | Dev Tools | Git branch operations |
| `/pr [base]` | Dev Tools | Generate PR description compared to base branch |
| `/ci [review\|fix]` | Dev Tools | Run headless CI/CD PR review or auto-fix simulation locally |
| `/mcp <explore\|search\|install\|list>` | MCP | Manage MCP servers (explore marketplace, search, install) |
| `/image <prompt>` | Image Gen | Generate UI assets using Stable Diffusion WebUI or Pollinations AI |
| `/preview <filepath-or-url>` | Utilities | Screenshot a local HTML file or URL and save the image |
| `/stats` | Utilities | Display session analytics, token usage, index count, router status |
| `/history [n]` | Utilities | Show recent N turns with tool calls from the session log |
| `/lite` | Utilities | Show Daedalus Lite documentation |
| `/help [command]` | Utilities | Show available commands or detailed help for a specific command |
| `/exit` | Utilities | Save session and exit |
| `/onboard` | Setup | First-time setup: discover local models, configure, test |
| `/tui` | UI | Toggle the Terminal User Interface (TUI) dashboard |
| `/add <file>` | Context | Add file to active prompt context |
| `/remove <file>` | Context | Remove file from active prompt context |
| `/context` | Context | Show active file context |
| `/paste` | Context | Paste clipboard text or image into prompt |
| `/clear` | Context | Clear conversation history |
| `/summarize` | Context | Summarize the current conversation |
| `/tokens` | Context | Display estimated token count for current session |
| `/system` | Context | Print the current active system prompt |
| `/health` | Diagnostics | Display router provider latency, health status, and API key statuses |
| `/doctor` | Diagnostics | Run full system diagnostics and health checks |
| `/models` | Diagnostics | List all configured models and tiers |
| `/changelog` | Diagnostics | View the latest CLI changes |
| `/config [set <key>=<val>]` | Config | View or modify global configuration settings |
| `/project [set <key>=<val>]` | Config | View or set project-level config settings (`.daedalusrc`) |
| `/profile` | Config | View or edit user profile (tone, experience, shell) |
| `/style` | Config | View or set coding style preferences |
| `/memory` | Memory | View stored project facts and conventions |
| `/fact <text>` | Memory | Add a fact to project memory |
| `/convention <text>` | Memory | Add a coding convention to project memory |
| `/extract` | Memory | Manually trigger fact extraction from current session |
| `/session [subcommand]` | Session | Manage, save, load, branch, merge, or export chat sessions |
| `/prune [budget]` | Session | Prune old messages to stay within token budget |

---

## 5. Configuration Reference (`~/.daedalus/config.json`)

The global configuration governs model priority chains, UI preferences, and safety guidelines:

```json
{
  "version": 1,
  "router": {
    "strategy": "priority",
    "chain": [
      {
        "name": "local-llm",
        "endpoint": "http://localhost:1234/v1",
        "model": "auto",
        "priority": 1,
        "enabled": true,
        "supportsTools": true,
        "tier": "intelligence"
      },
      {
        "name": "ollama-fallback",
        "endpoint": "http://localhost:11434/v1",
        "model": "qwen2.5-coder",
        "priority": 2,
        "enabled": true,
        "supportsTools": true,
        "tier": "standard"
      }
    ]
  },
  "agents": {
    "default": "coder",
    "autoOrchestrate": true
  },
  "ui": {
    "streaming": true,
    "showTokens": true,
    "theme": "dark",
    "tui": false,
    "collapseCommentary": true,
    "compactMode": true
  },
  "safety": {
    "protectGit": true,
    "autoApprove": false
  }
}
```

### Key Environment Variables
* `GITHUB_TOKEN` / `GH_TOKEN`: GitHub authentication token for PR creation and issue tracking.
* `DISCORD_WEBHOOK_URL`: Webhook URL for Discord status alerts and release announcements.
* `DAEDALUS_AUTO_APPROVE`: When set to `true`, enables non-interactive auto-approval for terminal commands.
