# Contributing to Daedalus

Thanks for your interest in contributing! Daedalus is a local-first AI coding CLI, and we welcome contributions of all kinds — bug fixes, features, documentation, and more.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

This project is governed by the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold its terms.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<your-username>/daedalus.git`
3. Create a feature branch: `git checkout -b feat/your-feature-name`

## Development Setup

```bash
# Install dependencies
npm install

# Run in dev mode (hot reload)
npm run dev

# Build
npm run build

# Type check
npx tsc --noEmit
```

### Prerequisites

- Node.js 20+
- A local LLM server (LM Studio, Ollama, llama.cpp, vLLM) or a remote API key

## Project Structure

```
src/
├── index.ts                # CLI entry point, REPL, command dispatch
├── types.ts                # Shared type definitions
├── highlight.ts            # Syntax highlighting
├── config/                 # Configuration loading, schema, discovery
├── router/                 # Model routing engine
├── session/                # Session persistence (SQLite, JSONL)
├── agents/                 # Multi-agent system
├── tools/                  # Tool system (16 built-in tools + MCP)
│   ├── builtin/            # File, terminal, git, web, todo, etc.
│   └── mcp/                # MCP transport (stdio, HTTP/SSE)
├── indexing/               # FTS5 codebase indexing
└── onboarding/             # Setup wizard
```

## Coding Standards

### Language & Runtime

- **TypeScript** with strict mode
- **ESM** only (`"type": "module"`) — always use `.js` extension in local imports
- **Node.js 20+** target

### Style

- **No comments** in source code unless the logic is non-obvious
- **No default exports** — use named exports everywhere
- **No emoji** in code or documentation
- **Descriptive names** — prefer clarity over brevity

### Imports

```typescript
// Local imports must include .js extension
import { RouterConfig } from '../router/types.js';

// npm imports need no extension
import { z } from 'zod';
```

### Error Handling

- Throw typed errors with descriptive messages
- Tools return `{ success: boolean, content: string, error?: string }`

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
```

### Types

| Type     | Usage                        |
|----------|------------------------------|
| feat     | New feature                  |
| fix      | Bug fix                      |
| docs     | Documentation only           |
| style    | Formatting, missing semicolons |
| refactor | Code change that fixes neither bug nor adds feature |
| perf     | Performance improvement      |
| test     | Adding or updating tests     |
| chore    | Build process, tooling, CI   |

### Examples

```
feat(router): add temperature-per-model support
fix(indexing): handle symlinked directories
docs: add contributing guide
test(session): add SQLite CRUD tests
```

## Pull Request Process

1. **Small PRs are better** — keep each PR focused on one concern
2. **Update the CHANGELOG** — add your change under the `[Unreleased]` section
3. **Include tests** — new features should include tests; bug fixes should add a regression test
4. **Pass CI** — ensure all checks pass (type check, lint, tests)
5. **Request review** — tag a maintainer or mention `@bgill55`

### PR Title Format

Same as commit messages: `type(scope): description`

## Testing

```bash
# Run all tests
npm test

# Watch mode
npx vitest

# With coverage
npx vitest --coverage
```

Tests are written with [vitest](https://vitest.dev/) and co-located with source files as `*.test.ts`.

## Reporting Issues

- **Bug reports** — use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md)
- **Feature requests** — use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md)
- **Security issues** — see [SECURITY.md](SECURITY.md)

Before filing, please search [existing issues](https://github.com/bgill55/daedalus/issues) to avoid duplicates.

## Questions?

Open a [Discussion](https://github.com/bgill55/daedalus/discussions) or reach out to the maintainer.
