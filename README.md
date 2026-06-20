# Daedalus

<p align="center">
  <img width="256" alt="daedalus_emblem" src="https://github.com/user-attachments/assets/a5d4b394-3c2c-427e-b877-6e49f77467fc" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/daedalus-cli"><img src="https://img.shields.io/npm/v/daedalus-cli?color=blue" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/daedalus-cli"><img src="https://img.shields.io/npm/dm/daedalus-cli?color=blue" alt="npm downloads" /></a>
  <a href="https://github.com/bgill55/daedalus/stargazers"><img src="https://img.shields.io/github/stars/bgill55/daedalus?color=blue" alt="GitHub stars" /></a>
  <a href="https://github.com/bgill55/daedalus/actions/workflows/ci.yml"><img src="https://github.com/bgill55/daedalus/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/bgill55/daedalus?color=blue" alt="License" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node" /></a>
</p>

**Local-first terminal-based AI coding assistant.**

Daedalus connects to local LLM servers (LM Studio, Ollama, llama.cpp, vLLM) or remote providers (OpenAI, Groq, OpenRouter, Anthropic), routes requests across models, and gives your AI agent access to your file system, terminal, git, web search, and codebase indexing.

```text
╔═══════════════════════════════════════════════════════════════════╗
║  ██████╗  █████╗ ███████╗██████╗  █████╗ ██╗     ██╗   ██╗███████╗║
║  ██╔══██╗██╔══██╗██╔════╝██╔══██╗██╔══██╗██║     ██║   ██║██╔════╝║
║  ██║  ██║███████║█████╗  ██║  ██║███████║██║     ██║   ██║███████╗║
║  ██║  ██║██╔══██║██╔══╝  ██║  ██║██╔══██║██║     ██║   ██║╚════██║║
║  ██████╔╝██║  ██║███████╗██████╔╝██║  ██║███████╗╚██████╔╝███████║║
║  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═════╝ ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚══════╝║
║                                                                   ║
║  o  local-first · embedded router · multi-agent · not sentient o  ║
╚═══════════════════════════════════════════════════════════════════╝

DAEDALUS  v1.6.0 · bgill55_dev

┌─ router ──────────────────────────────────────────────────────────┐
│ strategy  priority    models  2    config  ~/.daedalus/config.json│
└───────────────────────────────────────────────────────────────────┘

Type ? for commands  ·  Tab completes  ·  Be nice to your AI

[OK] Router started. Health checks running every 30s.
o › 
```

---

## Quick Start

```bash
npm install -g daedalus-cli
daedalus
```

On first run, Daedalus scans for local LLM servers and guides you through setup. If none are found, it prompts for a remote provider.

From source: `git clone https://github.com/bgill55/daedalus.git && cd daedalus && npm install && npm run build`

---

## Why Daedalus?

AI assistance without:
- Sending your code to third-party servers
- Per-token pricing for every interaction
- Being locked into a single provider
- Losing conversation history between sessions

---

## Features

### Core
- **Local-first** — works entirely on your machine with local LLMs
- **Embedded model router** — priority, round-robin, or fastest-response routing across multiple models
- **Multi-agent orchestration** — spawns planner, coder, reviewer, debugger, and researcher sub-agents
- **Codebase indexing** — FTS5-powered symbol search, definitions, and call-graph references (TS/JS, Python, Go, Rust)
- **Session management** — SQLite-backed history with save, load, JSONL export
- **Persistent memory** — facts and coding conventions auto-inject every turn; `/profile` and `/style` persist across sessions
- **MCP support** — Model Context Protocol servers via stdio and HTTP/SSE
- **Windows + Unix** — full cross-platform support

### Tools
- **File tools** — read, write, patch with interactive diff UI; fuzzy whitespace matching, syntax validation with auto-revert
- **Trust layer** — write-without-read guardrail, circuit breaker, import/export validation, auto-test loop, large-rewrite annotation
- **Terminal** — cross-platform shell execution (bash/cmd/powershell) with custom preference support, timeout, and abort
- **Git** — status, diff, stage-all-and-commit, undo
- **Web** — DuckDuckGo search and URL fetching (no API key needed)
- **Codebase** — index, find, definitions, references

### Commands

| Command | Description |
|---------|-------------|
| `/orchestrate <goal>` | Run multi-agent orchestration |
| `/spawn [--bg] <role> <task>` | Spawn a sub-agent (foreground or background) |
| `/tasks` | List background agent tasks |
| `/task <id>` | Show detailed task results or cancel with `kill` |
| `/ensemble <goal>` | Multi-model ensemble drafting |
| `/debug <command>` | Run and autonomously fix errors |
| `/find <query>` | Fuzzy-search indexed symbols |
| `/refs <symbol>` | Find symbol references |
| `/def <symbol>` | Get symbol definition |
| `/add` / `/remove` / `/context` | Manage file context |
| `/commit [msg]` | Stage all and commit |
| `/undo` | Revert last file patch |
| `/test [n]` | Run tests and auto-fix failures |
| `/profile` / `/style` | Set user profile and coding preferences |
| `/memory` / `/fact` / `/convention` | Manage project memory |
| `/branch [name]` | View or switch branches |
| `/pr [base]` | Generate PR description |
| `/session` | Manage chat sessions |
| `/project [set <key> = <val>]` | View or set project-level config settings |
| `/config [set <key> = <val>]` | View or set global configuration settings |
| `/prune [budget]` | View and prune message history |
| `/doctor` | Diagnose server connections |
| `/index` | Index codebase |
| `/onboard` | Re-run setup wizard |
| `/models` / `/tools` | List models and tools |
| `?` / `help` | Show command reference |
| `exit` / `quit` | Save and quit |

Tab completion works on all commands.

---

## Configuration

Daedalus stores config at `~/.daedalus/config.json`. Key sections:

```json
{
  "router": {
    "strategy": "priority",
    "chain": [
      { 
        "name": "local", 
        "endpoint": "http://localhost:1234/v1", 
        "model": "auto", 
        "enabled": true, 
        "priority": 1,
        "supportsTools": true,
        "tier": "intelligence"
      }
    ]
  },
  "indexing": { "enabled": true, "watch": true, "exclude": ["node_modules", "dist", ".git"] },
  "tools": { "sandbox": "none", "sandboxImage": "node:20" }
}
```

Router strategies: `priority` (default), `round-robin`, `fastest`.

### Proactive Model Routing & Tiers
You can configure a `tier` (`"fast"`, `"intelligence"`, or `"standard"`) and tool support (`"supportsTools": true`) for each model in your configuration chain. 
* **Automatic Tier Detection**: Simple questions or quick requests route to healthy `"fast"` tier models. Large coding contexts (estimated tokens > 8k) or agent subtasks automatically target `"intelligence"` tier models.
* **Tool capability filtering**: Sub-agents needing tools will automatically filter and route to models with `"supportsTools": true` enabled.

### Concurrent Background Execution
Run sub-agents concurrently in the background by adding the `--bg` flag to `/spawn` or `/delegate` (e.g. `/spawn --bg coder "Implement helper"`).
* **Notification Queueing**: Agent task completions are queued and printed synchronously in a prompt-safe manner right before your next REPL prompt redraw to keep your terminal output clean.
* **Management**: View running jobs via `/tasks`, cancel running jobs via `/task kill <id>`, and read results of completed tasks using `/task <id>`.

### Updating Configuration via CLI
You can view and modify global configuration options directly within the CLI without manually editing files. The values are automatically validated before saving to prevent corrupting your settings:
* **View Config**: Run `/config` to display your current active configuration.
* **Set Global Config**: Run `/config set <key> = <value>` (e.g., `/config set router.strategy = round-robin`).
* **Set Model Config**: Run `/config set model.<name>.<property> = <value>` (e.g., `/config set model.local.tier = intelligence`).

To modify project-specific overrides for the current workspace, use:
* **View Project Config**: Run `/project`.
* **Set Project Config**: Run `/project set <key> = <value>` (e.g., `/project set testCommand = npm run test`).

### Shell Preference
The shell used by the terminal tool can be configured:
1. Environment variable: `DAEDALUS_SHELL` or `SHELL`.
2. Configuration file setting: `"tools": { "shell": "powershell" }` (supports `powershell`, `pwsh`, `cmd`, `bash`, or absolute executable paths).

### Codebase File Watching
By default, indexing happens sequentially on startup. To enable real-time incremental indexing as files are created, modified, or deleted:
- Set `"watch": true` under `"indexing"` in the configuration.

### Execution Sandboxing
By default, the terminal tool runs commands directly on the host machine. You can configure isolated execution using Docker or WSL:

1. **Docker Sandbox**: Run all commands inside a Docker container. Mounts the project root automatically to `/workspace` so edits map directly back to the host:
   ```json
   "tools": {
     "sandbox": "docker",
     "sandboxImage": "node:20"
   }
   ```
2. **WSL Sandbox (Windows only)**: Run all commands inside Windows Subsystem for Linux, automatically converting Windows directory paths to WSL paths:
   ```json
   "tools": {
     "sandbox": "wsl",
     "wslDistribution": "Ubuntu"
   }
   ```

Per-project config at `~/.daedalus/config/<project-hash>.json` — set via `/project set <key> <value>`.

---

## Development

```bash
npm run dev       # hot-reload
npm run build     # compile TypeScript
npm test          # vitest (270+ tests)
npm run lint      # eslint (flat config)
npx tsc --noEmit  # type check
```

### Architecture

```
src/
├── index.ts           CLI entry, REPL, command dispatch
├── config/            Zod-schema validated config
├── router/            Model routing, health checks, rate limiter
├── session/           SQLite sessions, project memory, JSONL export
├── agents/            Multi-agent orchestration (planner, coder, et al.)
├── tools/             16 built-in tools + MCP transport
├── indexing/          FTS5 codebase indexing
└── onboarding/        Setup wizard
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, coding standards, and the PR process. Governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

[CHANGELOG.md](CHANGELOG.md) | [SECURITY.md](SECURITY.md) | MIT License
