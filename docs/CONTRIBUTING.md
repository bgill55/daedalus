# Contributing to Daedalus

Thanks for your interest in contributing! Daedalus is a local-first AI coding CLI, and we welcome contributions of all kinds — bug fixes, features, documentation, and architecture enhancements.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing & Linting](#testing--linting)
- [Reporting Issues](#reporting-issues)

## Code of Conduct
This project is governed by the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold its terms.

## Getting Started
1. Fork the repository on GitHub.
2. Clone your fork:
   ```bash
   git clone https://github.com/<your-username>/daedalus.git
   cd daedalus
   ```
3. Create a feature branch:
   ```bash
   git checkout -b feat/your-feature-name
   ```

## Development Setup
```bash
# Install dependencies
npm install

# Run in dev mode (TSX live reloading)
npm run dev

# Build ESM distribution
npm run build

# Run linting
npm run lint

# Run type check
npx tsc --noEmit
```

### Prerequisites
- **Node.js**: >= 20.0.0
- **npm**: >= 9.0.0
- **Model Router Backend**: A local model server (Ollama, LM Studio, llama.cpp, vLLM) or FreeLLMAPI / OpenAI-compatible endpoint configured in `~/.daedalus/config.json`.

## Project Structure
```
src/
├── index.ts        # CLI entry point, REPL loop, and command dispatch
├── types.ts        # Shared interfaces and type definitions
├── config/         # Zod-schema validated config (~/.daedalus/config.json)
├── router/         # Model router (priority, round-robin, token bucket rate limiter)
├── session/        # SQLite session persistence, project memory, JSONL export
├── agents/         # Multi-agent system (planner, coder, reviewer, debugger, researcher, autopilot)
├── tools/          # Built-in tool registry + MCP transport (stdio & HTTP/SSE)
├── indexing/       # FTS5 codebase & AST callgraph indexing across languages
└── onboarding/     # Setup wizard & interactive configuration
```

## Coding Standards

### Language & Runtime
- **TypeScript** with strict mode (`"strict": true`)
- **ESM Only** (`"type": "module"`) — all local relative imports MUST explicitly include the `.js` file extension (e.g., `import { config } from './config.js';`).
- Target Node.js >= 20.

### Code Style
- **No default exports** — use named exports only.
- **No emoji** in source code or documentation unless requested.
- **No comments** in source code unless necessary for non-obvious logic.
- Prefer interfaces in `src/types.ts` and Zod schemas in `src/config/`.

### Error Handling
- Throw typed errors with actionable error messages.
- For tool returns, prefer result pattern object return types: `{ success: boolean, content: string, error?: string }`.

## Commit Guidelines
We enforce [Conventional Commits](https://www.conventionalcommits.org/) for automated release notes and semantic version bumps.

```
<type>(<scope>): <description>
```

### Types
| Type | Usage |
|------|-------|
| feat | New feature (minor version bump) |
| fix | Bug fix (patch version bump) |
| docs | Documentation updates |
| style | Formatting, code layout |
| refactor | Code change that neither fixes a bug nor adds a feature |
| perf | Performance improvements |
| test | Adding or updating tests |
| chore | Maintenance, dependencies, build or CI updates |

### Examples
```bash
feat(router): add FreeLLMAPI failover routing
fix(indexing): handle symlinked AST callgraph paths
docs: update contributing guide architecture details
test(session): add SQLite CRUD integration tests
```

## Pull Request Process
1. Keep PRs focused on a single concern.
2. Ensure unit tests are added or updated for code changes.
3. Verify that `npm test` and `npm run lint` pass cleanly locally.
4. **CI Validation**: GitHub Actions runs linting (Ubuntu) and vitest unit tests across Windows, Ubuntu, and macOS.
5. **Automated Releases**: Merging a PR into `main` triggers `semantic-release` to publish a new package version to npm and create GitHub release tags.

## Testing & Linting
```bash
# Run all vitest unit tests
npm test

# Run tests in watch mode
npx vitest

# Run tests with coverage report
npx vitest --coverage

# Run ESLint (v10 flat config)
npm run lint
```

## Reporting Issues
- **Bug reports** — open an issue using the bug report template.
- **Feature requests** — open an issue detailing user benefit and architectural approach.
- **Security vulnerabilities** — see [SECURITY.md](SECURITY.md).

## Questions & Community
Have questions or ideas? Start a [GitHub Discussion](https://github.com/bgill55/daedalus/discussions) or join our community on Discord.
