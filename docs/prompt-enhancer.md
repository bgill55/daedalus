# 🪄 Auto-Prompt Expansion & Codebase Auditing (`/enhance` & `/prompt`)

This guide documents how **Daedalus** uses the `/enhance` (and `/prompt`) command alongside core system prompt guardrails to turn casual, 1-liner requests into high-yield architectural audits without token drift or repetition loops.

---

## 🛑 The Problem: Open-Ended Prompt Drift

When users ask open-ended questions like *"look at this project and tell me what you think"*, open-weights LLMs can fall into two common failure modes:
1. **API Enumeration Spirals**: Outputting long, repetitive lists of standard library methods (such as listing `console.*` or `process.*` methods) until hitting repetition bounds.
2. **Template Re-printing**: Replying with blank template fill-ins (like `| Aspect | | |` or `[dependency]`) instead of performing tool calls and writing the actual report.

---

## ⚡ The Solution: `/enhance` + Review Guardrails

Daedalus solves this using two complementary systems:

1. **`CONCISE REVIEWS` System Guardrail ([`src/system-prompt.ts`](file:///d:/Daedalus/src/system-prompt.ts))**: Directs the agent to provide high-level summaries under 10 bullet points and explicitly prohibits listing standard library APIs.
2. **Auto-Prompt Expander ([`src/commands/enhance.ts`](file:///d:/Daedalus/src/commands/enhance.ts))**: Takes any casual 1-liner and expands it into an imperative command ordering Daedalus to:
   - Use inspection tools (`list_files`, `read_file`, `git_status`).
   - Deliver fully populated Markdown comparison tables and risk analyses.
   - Prohibit blank template placeholders so the agent fills in actual code findings.

---

## 📊 Real-World Case Study: PromptVault Audit

### 1. Casual User Input
```text
⬡ › /prompt can you look at this project and tell me what you think.
```

### 2. Auto-Expanded Engineering Prompt
```markdown
Conduct a comprehensive codebase audit of this project. Begin by using list_files to understand the project structure, then read package.json, tsconfig.json, and configuration files to identify the tech stack, dependencies, and build setup. Examine the main source files in src/ to understand the architecture, coding patterns, and key functionality. After gathering this information, produce a complete Markdown report with the following sections fully populated with your actual findings:

## Project Overview
- Purpose, Tech Stack, and Project Structure

## Architecture Analysis
- Entry Points, Key Modules, Data Flow, and Database/Storage

## Code Quality Assessment
| Aspect | Finding | Impact |

## Dependencies & Configuration
- Production & Dev Dependencies and Config Notes

## Top 5 Improvement Recommendations
1. Specific recommendations with rationale

## Potential Risks & Technical Debt
- Identified risks, security gaps, and deprecated patterns

Ensure every section contains substantive analysis derived from your actual code inspection, not generic placeholders.
```

---

### 3. Daedalus Real-World Output

```text
  🪽 Daedalus─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  Now I have a good understanding of the project. Let me create a comprehensive audit report based on my analysis.

  Project Overview
  • Purpose: PromptVault is a web application for managing and generating AI prompt templates. It allows users to store, search, refine,
  and organize prompt templates with variable substitution capabilities.
  • Tech Stack: Express.js, TypeScript, SQLite (better-sqlite3), FTS5 Full-Text Search, Vitest, Freellmapi.
  • Project Structure: Clean separation across src/server.ts, src/db.ts, src/types.ts, src/validation.ts, src/logger.ts, and public/ static assets.

  Architecture Analysis
  • Entry Points: src/server.ts exporting createApp() function.
  • Key Modules: Express API routes, SQLite FTS5 database layer, custom validation middleware, custom error hierarchy.
  • Data Flow: HTTP Request → Middleware (JSON, Helmet, CORS, Rate Limit) → Input Validation → Database SQL Execution → Response JSON.
  • Database/Storage: SQLite (data/prompts.db) with FTS5 virtual table (prompts_fts) synced via triggers.

  Code Quality Assessment
  | Aspect | Finding | Impact |
  |--------|---------|--------|
  | TypeScript Usage | Strong typing throughout with interfaces and strict mode (exactOptionalPropertyTypes: true). | High |
  | Error Handling | Custom AppError hierarchy with HTTP status codes and centralized Express error handler. | High |
  | Input Validation | Robust validation middleware checking types, required fields, and template variables. | High |
  | Security | Uses Helmet, CORS, rate limiting, and HTML sanitization. Dev config weakens Helmet headers. | Medium |
  | Code Organization | Clear separation of concerns between routes, validation, DB, and types. | High |
  | Testing | 41 passing Vitest unit tests for validation and DB functions. | Medium-High |
  | Logging | Structured logging with configurable log levels and request logging. | High |
  | Performance | FTS5 full-text index with triggers and parameterized queries. | High |

  Top 5 Improvement Recommendations
  1. Environment-Specific Helmet Security: Maintain core security headers in development instead of disabling CSP.
  2. Database Connection Pooling / WAL Mode: Enable SQLite WAL mode to improve reader/writer concurrency.
  3. Response Compression & Caching: Add gzip/deflate compression and ETag headers for read-only GET endpoints.
  4. OpenAPI / Swagger Documentation: Add schema contracts for API endpoints.
  5. Integration & E2E Tests: Add API route integration tests to complement DB unit tests.

  Potential Risks & Technical Debt
  • Missing API Authentication: Endpoints are open; add JWT/session auth before public deployment.
  • External AI Fallback: Add timeout/retry guards for external prompt generation services.
  • Input Size Limits: Set express.json({ limit: '100kb' }) to prevent large payload Denial of Service.
  intelligence · freellmapi-deepseek-v4 (deepseek-ai/deepseek-v4-pro) · 16 tool(s) · 2.4k out · 53.8s · 45.2 tok/s────────────────────────
  ┊ ✔ Executed tools: list_files, read_file
```

---

## 🚀 Key Takeaways

1. **Zero Repetition Loops**: Prevents AI agents from drifting into infinite API method lists.
2. **100% Tool Grounded**: Orders the agent to run `list_files` and `read_file` before writing the report.
3. **Structured Markdown Tables**: Delivers clean, executive-ready audits in seconds.
