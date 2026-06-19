# Daedalus

<img width="1024" height="1024" alt="daedalus_emblem_1781855172596" src="https://github.com/user-attachments/assets/a5d4b394-3c2c-427e-b877-6e49f77467fc" />


**Local-first coding CLI with an embedded model router, multi-agent orchestration, and codebase indexing.**

Daedalus is a standalone terminal-based AI coding assistant that runs entirely on your machine. It connects to local LLM servers (LM Studio, Ollama, llama.cpp, vLLM) or remote providers (OpenAI, Groq, OpenRouter, Anthropic), routes requests intelligently, and gives your AI agent access to your file system, terminal, git, web search, and codebase indexing — all from your command line.

```text
  ╭─ ⬡ You ───────────────────────────────────────────────╮
  │ refactor the auth middleware to use async/await         │
  ╰────────────────────────────────────────────────────────╯

  ╭─ ◇ Daedalus ───────────────────────────────────────────╮
  │ Let me look at the current auth middleware...            │
  │ I'll refactor it to use async/await pattern.             │
  ╰────────────────────────────────────────────────────────╯  ~132t · 3.2s
```

---

## Features

- **Local-first** — Works with local LLMs (LM Studio, Ollama, llama.cpp, vLLM) or remote APIs
- **Embedded model router** — Priority, round-robin, or fastest-response routing across multiple models
- **Multi-agent orchestration** — Spawns sub-agents (planner, coder, reviewer, debugger, researcher) for complex tasks
- **Codebase indexing** — FTS5-powered symbol search, definitions, and call-graph references (TS/JS, Python, Go, Rust)
- **File system tools** — Read, write, patch with interactive diff UI, search (ripgrep + native fallback)
- **Terminal access** — Cross-platform shell execution (bash/cmd) with timeout and abort
- **Git integration** — Status, diff, stage-all-and-commit, undo last patch
- **Session management** — SQLite-backed conversation history with save/load/export
- **Persistent memory** — Facts and conventions auto-inject into every turn. User profile (`/profile`) and coding style (`/style`) persist across sessions. Auto-fact extraction learns from your edits and commits.
- **MCP support** — Connect Model Context Protocol servers (stdio and HTTP/SSE)
- **Web tools** — DuckDuckGo search and URL fetching (no API key needed)
- **Visual chat UI** — Bordered message blocks, tab completion, syntax-highlighted code blocks
- **Configurable** — Per-project settings (test commands, auto-run), full daedalus config
- **Windows + Unix** — Full cross-platform support

---

## Quick Start

### Prerequisites

- Node.js 20+
- A local LLM server (recommended) or a remote API key

### Install

```bash
npm install -g daedalus-cli
```

Or run directly from source:

```bash
git clone https://github.com/bgill55/daedalus.git
cd daedalus
npm install
npm run build
```

### Launch

```bash
daedalus
```

On first run, Daedalus will scan for local LLM servers and guide you through setup. If none are found, it prompts you to configure a remote provider (OpenAI, Groq, OpenRouter, Anthropic, or custom).

---

## Usage

Once inside the REPL, type `?` or `help` for the full command reference.

### Commands

| Command | Description |
|---------|-------------|
| `/add <file>` | Add file to active context |
| `/remove <file>` | Remove file from context |
| `/context` | Show active file context |
| `/clear` | Clear conversation history |
| `/commit [message]` | Stage all and commit changes |
| `/undo` | Revert last file patch |
| `/test [iterations]` | Run tests and auto-fix failures |
| `/memory` | View saved project facts and conventions |
| `/fact <key> = <value>` | Save a project fact |
| `/convention <key> = <value>` | Save a coding convention |
| `/extract` | Manually extract facts from current session |
| `/profile view\|name\|bio` | View or set your user profile |
| `/style <preferences>` | Set persistent coding style preferences |
| `/index` | Index codebase for symbol search |
| `/find <query>` | Fuzzy-search indexed symbols |
| `/refs <symbol>` | Find symbol references (callers) |
| `/def <symbol>` | Get symbol definition |
| `/project` | View or set project config |
| `/session list\|load\|new\|delete` | Manage chat sessions |
| `/models` | List available models |
| `/tools` | List all tools |
| `/doctor` | Diagnose local server connections |
| `/onboard` | Re-run setup wizard |
| `/spawn <role> <task>` | Spawn a sub-agent |
| `/orchestrate <goal>` | Run multi-agent orchestration |
| `?` / `help` | Show command reference |
| `exit` / `quit` | Save and quit |

### Tab Completion

Start typing a command and press Tab — Daedalus auto-completes it:

```
  ⬡ › /fi[TAB]
  ⬡ › /find
```

---

## Configuration

Daedalus stores its configuration at `~/.daedalus/config.json`. Key sections:

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
        "maxTokens": 8192
      }
    ]
  },
  "indexing": {
    "enabled": true,
    "exclude": ["node_modules", "dist", ".git"]
  },
  "ui": {
    "showTokens": true
  }
}
```

### Router Strategies

- **`priority`** (default) — Picks the healthy model with lowest priority number
- **`round-robin`** — Cycles through healthy models evenly
- **`fastest`** — Picks the model with the lowest cached response time

### Per-Project Config

Each project can have its own settings at `~/.daedalus/config/<project-hash>.json`:

```json
{
  "testCommand": "npm test",
  "buildCommand": "npm run build",
  "lintCommand": "npm run lint",
  "devCommand": "npm run dev"
}
```

Configured via `/project set <key> <value>`.

---

## Architecture

```text
src/
├── index.ts                # CLI entry point, REPL, command dispatch
├── types.ts                # Shared type definitions
├── highlight.ts            # Syntax highlighting for code blocks
├── profile.ts              # User profile (name, bio, style) persistence
├── extraction.ts           # Auto-fact extraction engine
├── config/                 # Configuration loading, schema, discovery
│   └── index.ts
├── router/                 # Model routing engine
│   ├── index.ts            # LocalRouter: routing, streaming, completion
│   ├── types.ts            # Router types
│   ├── health.ts           # Model health checks
│   └── rate-limiter.ts     # Token-bucket rate limiter
├── session/                # Session persistence
│   ├── manager.ts          # Session orchestration
│   ├── sqlite.ts           # SQLite CRUD
│   ├── memory.ts           # Project facts & conventions
│   └── jsonl.ts            # JSONL import/export
├── agents/                 # Multi-agent system
│   ├── agent.ts            # Agent interface
│   ├── roles.ts            # Role definitions (coder, reviewer, etc.)
│   └── orchestrator.ts     # Orchestration engine
├── tools/                  # Tool system
│   ├── definitions.ts      # 16 built-in tool definitions
│   ├── executor.ts         # Tool execution engine
│   ├── daedalus-spinner.ts # Terminal spinner
│   ├── builtin/            # Built-in tool implementations
│   │   ├── files.ts        # File read/write/patch/search
│   │   ├── terminal.ts     # Shell execution
│   │   ├── git.ts          # Git diff/status
│   │   ├── web.ts          # Web search/fetch
│   │   ├── todo.ts         # Task management
│   │   ├── delegation.ts   # Sub-agent delegation
│   │   ├── indexing.ts     # Codebase indexing tools
│   │   ├── diff-ui.ts      # Interactive diff viewer
│   │   └── project-config.ts
│   └── mcp/                # MCP transport
│       ├── registry.ts     # MCP server manager
│       ├── stdio.ts        # stdio transport
│       ├── http.ts         # HTTP/SSE transport
│       └── tool-executor.ts
├── indexing/               # Codebase indexing
│   ├── fts.ts              # FTS5 database layer
│   └── indexer.ts          # File crawler & language parsers
└── onboarding/             # Setup wizard
    └── wizard.ts
```

---

## Development

```bash
# Run in dev mode (hot reload)
npm run dev

# Run directly
npm start

# Build
npm run build

# Type check
npx tsc --noEmit

# Test
npm test

# Lint
npm run lint
```

---

## Why Daedalus?

Daedalus is built for developers who want AI assistance without:
- Sending their code to third-party servers
- Paying per-token for every interaction
- Being locked into a single provider
- Losing their conversation history between sessions
- Having limited tool access

It's for local-first, private, customizable AI coding — with memory that grows with you.

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for our contribution guidelines, coding standards, and pull request process.

This project is governed by a [Code of Conduct](CODE_OF_CONDUCT.md). Please report any unacceptable behavior.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the project history.

## Security

Report security vulnerabilities privately to bgill55_art@outlook.com — see [SECURITY.md](SECURITY.md) for details.

## License

MIT
