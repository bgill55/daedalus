# The B.R.A.G. Autonomous Framework & The Marathon Engine
## A Paradigm for Long-Horizon Multi-Agent Software Engineering

---

### 1. The Long-Horizon Crisis: Context Rot and the Regression Trap

The current landscape of AI-assisted development is defined by a sharp performance cliff. While standard coding assistants excel at solving isolated, 15-to-30-minute tasks, they consistently fail when confronted with multi-day, complex software engineering projects. This "long-horizon crisis" occurs because short-term success—generating a single function or fixing a minor bug—does not scale to enterprise-grade systems. As a project grows, the volume of code and the weight of previous decisions overwhelm the agent, leading to a terminal state where the AI begins to fight its own previous output rather than building upon it.

Traditional agentic loops are plagued by three primary pathologies:

- **Context Rot:** As a session progresses, the model’s context window becomes saturated with irrelevant history, stale rationalizations, and failed attempts. This "noise" eventually obscures the original project requirements, leading to architectural drift.
- **The Regression Trap:** Without a structured memory of past failures, agents enter endless repair cycles. Fixing one bug inadvertently introduces two more, creating a loop of unproductive churn where the agent lacks the state-awareness to recognize it is regressing.
- **Tautological Testing:** In standard "chat-and-code" setups, the model instance that writes the code is the same instance tasked with verifying it. This leads to "mocked-out tests" and "skipped edge cases" designed—often subconsciously—to pass the model's own logic rather than stress the actual implementation.

These pathologies culminate in **Transcript Bias**, a hard architectural boundary violation. The agent begins to prioritize internal conversation history and its own stated rationalizations over the external reality of the filesystem. It believes its own history even when the disk state is broken, resulting in hallucinated passes. Solving this requires a fundamental shift from simple "chat-and-code" interfaces to a structured, autonomous framework: the Daedalus Foundation.

---

### 2. The Daedalus Foundation: Philosophical and Systemic Constraints

The Daedalus Foundation is built upon a "local-first" philosophy, prioritizing deterministic control, modular separation of concerns, and environment-specific execution. This architecture is governed by the **Machine Pantheon**, a collective of specialized agents serving as modular components of a unified engineering system:

- **Metis (The Macro-Planner):** Responsible for high-level decomposition and roadmap generation.
- **Hephaestus (The Builder):** The primary agent tasked with production-grade code delivery.
- **Apollo (The Auditor):** An air-gapped evaluator providing independent, out-of-band verification.
- **Asclepius (The Diagnostic):** A specialized utility for fixing diagnostics and syntax errors in-flight during the execution loop.

This system is grounded by **SpecFirst Contracts**. Before a single line of code is generated, the system establishes a formal contract including **explicit target files**, **behavioral acceptance criteria**, and **verification commands**. This structured approach prevents the "cognitive overload" typical of monolithic LLM agents by ensuring each component of the Pantheon operates within a deterministic, pre-defined scope.

---

### 3. The B.R.A.G. Autonomous Framework

The core methodology of the Daedalus project is the **B.R.A.G. framework**. It pairs Directed Acyclic Graph (DAG) task scheduling with semantic codebase Retrieval-Augmented Generation (RAG) to ensure structured, non-linear progress and total state-awareness.

| Pillar | Component | Technical Implementation |
|:---|:---|:---|
| **B** | **BUILD** | Metis Milestone DAG Task Decomposition & `MARATHON_ROADMAP.md` generation. |
| **R** | **RETRIEVE** | $\Sigma$-Mem Anti-Pattern storage & FTS5 Semantic Codebase RAG via SQLite. |
| **A** | **AUDIT** | Apollo Air-Gapped Verification with Zero-Byte & Empty-Diff Gates. |
| **G** | **GENERATE** | Hephaestus Production Code Delivery & Automated Stacked PRs. |

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                      THE B.R.A.G. AUTONOMOUS FRAMEWORK                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  B — BUILD    : Metis Milestone DAG Task Decomposition                      │
│  R — RETRIEVE : Σ-Mem & FTS5 Semantic Codebase RAG                          │
│  A — AUDIT    : Apollo Air-Gapped Verification & Zero-Byte Gates            │
│  G — GENERATE : Hephaestus Production Code Delivery & Stacked PRs           │
└─────────────────────────────────────────────────────────────────────────────┘
```

The synergy between DAG scheduling and RAG memory is the framework's primary defense against failure. The DAG serves as a **strict dependency graph**, ensuring agents never execute tasks out of order or fall into the infinite loops common in chat-based interfaces. While B.R.A.G. defines the methodology, the **Marathon Engine** serves as the high-performance implementation designed for long-duration autonomy.

---

### 4. The Marathon Engine: Harness-of-Harness (HoH) Architecture

The Marathon Engine is a meta-orchestration framework designed for multi-day autonomy. It manages the project lifecycle through a "Harness-of-Harness" (HoH) architecture, establishing internal "check-and-balance" systems that eliminate the need for human micromanagement.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                      DAEDALUS MARATHON META-HARNESS                         │
│  - Roadmap DAG & State Machine (.daedalus/marathon.json + SQLite)           │
│  - Checkpoint & Rollback Arbitrator (Git Tags: daedalus-checkpoint/m-*)      │
│  - Σ-Mem Anti-Pattern & Capability Ledger                                    │
│  - Automated Stacked PR Generator (/marathon pr)                             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌──────────────────────────────────────┐  ┌───────────────────────────────────┐
│        WORKER SPRINT HARNESS         │  │   AIR-GAPPED EVALUATION HARNESS   │
│  - Metis (Milestone Decomposition)   │  │  - Apollo (Isolated Context)      │
│  - Hephaestus (Coder / Builder)      │  │  - Deterministic Pre-LLM Gates    │
│  - Asclepius (Targeted Healer)       │  │  - Independent Test & Lint Probes │
│  - Σ-Mem Pitfall Injection           │  │  - Acceptance Criteria Scoring    │
│  - Ground-Truth Codebase RAG         │  │  - Regression & Debt Detection    │
└──────────────────────────────────────┘  └───────────────────────────────────┘
```

- **Pillar I: Metis Macro-Planner:** Metis deconstructs a project vision into a DAG of 3 to 12 atomic, verifiable milestones. This results in the `MARATHON_ROADMAP.md`, a live-updated document in the repository root that declares explicit delivery targets.
- **Pillar II: Air-Gapped Apollo Evaluator:** To eliminate Transcript Bias, Apollo operates in an isolated LLM context with **zero conversation history** from the coder agent. It evaluates only the ground-truth git diff and real terminal test outputs. It utilizes **Deterministic Pre-LLM Gates** to immediately reject milestones if claimed files are missing or are 0-byte stubs (Score 0).
- **Pillar III: Hard Git Checkpoint & Rollback Arbitrator:** Marathon establishes permanent git tags (`daedalus-checkpoint/m-*`) for every passed milestone. If an iteration enters a regression loop, the engine executes a **Hard Rollback** (`git reset --hard` and `git clean -fd`), purging all untracked artifacts and resetting the workspace to a known clean state.
- **Pillar IV: Continuous Negative Learning ($\Sigma$-Mem):** When a milestone fails, the error signature is recorded as **`sigma_anti_patterns`** in a `project-mem.sqlite` database. These are injected into subsequent attempts as `[PITFALL]` blocks, preventing the agent from repeating the same compilation or logic errors.

---

### 5. Case Study: Autonomous Construction of the Companion Web UI

To validate the B.R.A.G. framework, the Marathon Engine was tasked with constructing a full-featured Companion Web UI with real-time SSE telemetry. The engine successfully executed a six-milestone stack:

1. **M-1: Scaffolding** (`src/webui/index.ts`): Established directory structure. **Score: 100/100.**
2. **M-2: HTTP Server** (`src/webui/server.ts`): Bound native Node server to Port 3888. **Score: 85/100.**
3. **M-3: SSE Telemetry Stream** (`src/webui/server.ts`): Implemented `text/event-stream` with 1s intervals. **Score: 85/100.**
4. **M-4: Dark Cyber Dashboard UI** (`src/webui/public/`): Created responsive CSS/JS with live gauges. **Score: 100/100.**
5. **M-5: CLI Slash Command Integration** (`src/commands/webui.ts`): Implemented start/stop/status controls. **Score: 95/100.**
6. **M-6: Vitest Unit & Integration Suites** (`src/webui/server.test.ts`): Generated 11 tests covering all routes. **Score: 100/100.**

The Marathon Engine considers a **Score $\ge$ 70 a PASS**, allowing for minor stylistic variations while enforcing rigorous functional integrity. The engine moved the project from a macro-goal to a verified, ready-to-merge state—handling everything from low-level port binding to high-level UI styling—without human intervention.

---

### 6. Handoff: Stacked PR Packaging and Technical Integrity

The final artifact of a Marathon run is the **Stacked Pull Request** (e.g., PR #178). This is a verifiable package of engineering work that transforms the human role from a micro-manager to a high-level strategic reviewer.

A Daedalus Stacked PR contains:

- **Milestone Progress Checklists:** A verified record of completed requirements.
- **Checkpoint Links:** Direct access to permanent git tags for every milestone.
- **Apollo Scorecards:** Objective, independent audit results for every code change.
- **CI Validation:** A verified pass across the CI matrix for Linux, macOS, and Windows.

This approach ensures that technical integrity is a structural guarantee rather than an afterthought. We are moving beyond the era of fragile "AI assistance" and into the era of **Autonomous Systems**—verifiable, self-correcting, and architecturally sound engineering frameworks that scale to the complexity of the modern enterprise.
