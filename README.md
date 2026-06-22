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

<!-- START_COMMANDS_TABLE -->
| Command | Description |
|---------|-------------|
| `/add` | Add file to context |
| `/remove` | Remove file from context |
| `/context` | Show active file context |
| `/paste` | Paste clipboard text/image as message |
| `/clear` | Clear conversation history |
| `/spawn [--bg] <role> <task>` / `/delegate` | Spawn sub-agent: /spawn [--bg] <role> <task> |
| `/tasks` | List background agent tasks |
| `/task <id>` | Manage background task: /task <id> | /task kill <id> |
| `/orchestrate <goal>` / `/orc` / `/run` / `/o` | Orchestrate agents for a goal |
| `/memory` | View project memory (facts & conventions) |
| `/fact [text]` | Add a project fact to memory |
| `/convention [text]` | Add a project convention to memory |
| `/extract` | Manually extract facts from session |
| `/profile` | View or set user profile info |
| `/style` | Set your coding style preferences |
| `/undo` | Undo last file patch |
| `/branch [name]` | Git branch operations |
| `/pr [base]` | Generate PR description Compared to base branch |
| `/debug <command>` | Run command and autonomously debug failures |
| `/ensemble <goal>` | Ensemble model drafting pipeline |
| `/commit [msg]` | Stage and commit changes |
| `/project [set <key> = <val>]` | View or set project config settings |
| `/session [name]` | Manage chat sessions |
| `/test [n]` | Run test loop and fix failures |
| `/index` | Index codebase for symbol search |
| `/find <query>` | Search indexed symbols |
| `/refs <symbol>` | Find symbol references (callers) |
| `/def <symbol>` | Get symbol definition |
| `/changelog` | View the latest CLI changes |
| `/models` | List available and healthy models |
| `/config [set <key> = <val>]` | Show current configuration |
| `/doctor` | Diagnose connection and discovery |
| `/help` / `?` / `help` | Show available commands |
| `/mcp` | Manage MCP servers: explore, search, install, list, remove, info |
| `exit` / `quit` | Save session and exit |
<!-- END_COMMANDS_TABLE -->

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

Per-project config is stored at `~/.daedalus/config/<project-hash>.json` and can be set via `/project set <key> <value>`.

---

## Detailed Documentation Guides

For in-depth explanations, configuration options, and hardware optimization tips, see the modular guides below:

*   [Model Routing & Tuning Guide](docs/routing-and-tuning.md) — Endpoints, failover chains, routing strategy configs, and GPU/LM Studio tuning recommendations.
*   [Multi-Agent Orchestration](docs/orchestration.md) — Overview of the planning, coding, and review loops, recovery checkpoints, and background task runners.
*   [Execution Sandboxing](docs/sandboxing.md) — Running commands inside isolated Docker containers or WSL distributions.
*   [Model Context Protocol (MCP) Integration](docs/mcp.md) — Configuring stdio and HTTP/SSE servers to expand your agent's capabilities.
*   [Configuration Reference Guide](docs/configuration-reference.md) — Reference list of all global configuration keys (`router.*`, `agents.*`, `tools.*`, `ui.*`, etc.).

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
