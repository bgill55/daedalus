# The B.R.A.G. Autonomous Framework & The Marathon Engine
## A Paradigm for Long-Horizon Multi-Agent Software Engineering

---

## Abstract

Traditional multi-agent software systems and autonomous AI coding assistants hit a rigid ceiling during long-horizon software development tasks, typically collapsing after 15 to 30 minutes of continuous execution. This systemic breakdown is caused by three key vectors: **context rot** (transcripts polluted with past errors), the **regression trap** (unproductive, circular repair loops), and **biased self-testing** (coder agents writing tautological assertions to falsely validate their own broken output). 

To overcome these barriers, we introduce the **B.R.A.G. (Build, Retrieve, Audit, Generate) Autonomous Framework** and the **Daedalus Marathon Engine**. By coupling **Directed Acyclic Graph (DAG) task scheduling** with **Retrieval-Augmented Generation (RAG) memory retrieval**, this architecture guarantees that multi-agent development cycles remain linear, structured, and immune to infinite loops or repetitive errors. 

We demonstrate the efficacy of this paradigm through an end-to-end multi-day autonomous marathon run that successfully scaffolds, implements, verifies, and packages a complete, responsive **Companion Web UI with real-time Server-Sent Events (SSE) telemetry** and CLI command integrations—resulting in a fully validated, production-ready GitHub **Stacked Pull Request**.

---

## Executive Summary

### 1. The B.R.A.G. Lifecycle
The B.R.A.G. framework reorganizes the multi-agent software engineering lifecycle into four highly coordinated, error-resilient phases:

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

- **B — BUILD (Metis Milestone DAG Task Decomposition):** High-level user objectives are deconstructed into an ordered, non-linear milestone dependency graph, preventing out-of-order execution.
- **R — RETRIEVE ($\Sigma$-Mem & FTS5 Semantic Codebase RAG):** Agents query long-term memory and indexed codebase symbols to inject hyper-targeted local context and recall past lessons.
- **A — AUDIT (Apollo Air-Gapped Verification & Zero-Byte Gates):** Strict pre-LLM filters catch hollow code submissions, and independent out-of-band audits evaluate ground-truth outputs against behavioral contracts.
- **G — GENERATE (Hephaestus Production Code Delivery & Stacked PRs):** Verified commits are compiled, tested, pushed, and systematically organized into stacked pull requests ready for final human review.

### 2. The Marathon Engine (Harness-of-Harness Architecture)
Operating above individual agent roles, the **Marathon Engine** governs multi-day, long-horizon software projects through **Four Architectural Pillars**:

1. **Metis Macro-Planner (Milestone DAG Decomposition):** Dynamically parses ambitious goals into 3 to 12 atomic milestones, documenting and updating progress in a human-readable `MARATHON_ROADMAP.md` file in the repository root.
2. **Air-Gapped Independent Evaluator (Apollo Out-of-Band):** Combats "transcript bias" by evaluating code in a completely isolated LLM context with zero conversation history. It utilizes a **Deterministic Pre-LLM Missing-File Gate** (instantly failing 0-byte stubs with a Score of 0) and isolated git diff and test logs to evaluate genuine criteria fulfillment.
3. **Hard Git Checkpoint & Rollback Arbitrator:** Commits passing milestone audits are sealed with permanent git tags (`daedalus-checkpoint/m-<id>`). If an agent enters an infinite repair loop, the arbitrator executes a hard rollback (`git reset --hard` and `git clean -fd`) to return the workspace to the last healthy state, instantly curing context rot.
4. **Continuous Negative Learning with $\Sigma$-Mem:** Failed attempts and compiler errors are logged to `sigma_anti_patterns` in the project's SQLite database. Future agent attempts automatically receive explicit `[PITFALL]` warning blocks to prevent repeating identical structural or syntax mistakes.

```text
================================================================================
                    DAEDALUS MARATHON EXECUTION FLOW
================================================================================

 [1. MACRO PLANNING]
      │
      ▼ Metis decomposes goal into milestone DAG & writes MARATHON_ROADMAP.md
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ M-1: Directory Scaffolding & Entry Point (src/webui/index.ts)               │
 │ M-2: HTTP Server & Port 3888 Binding (src/webui/server.ts)                  │
 │ M-3: Server-Sent Events Telemetry Stream (src/webui/server.ts)              │
 │ M-4: Dark Cyber Telemetry Dashboard UI (src/webui/public/)                  │
 │ M-5: CLI Slash Command Integration (src/commands/webui.ts)                  │
 │ M-6: Unit & Integration Test Suite (src/webui/server.test.ts)               │
 └─────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
 [2. AUTONOMOUS SPRINT EXECUTION]
      │
      ├──> Hephaestus implements targeted deliverable files
      └──> Asclepius fixes diagnostics & syntax errors in-flight
      │
      ▼
 [3. AIR-GAPPED APOLLO AUDIT]
      │
      ├──> Strict pre-LLM gates: Rejects 0-byte stubs & empty diffs (Score 0)
      ├──> Fresh out-of-band LLM context: Reads isolated git diff & test outputs
      └──> Evaluates criteria fulfillment & flags subtle regressions
      │
      ├───[ FAIL / Score < 70 ]───> Hard Rollback to previous tag & record Anti-Pattern
      │
      └───[ PASS / Score >= 70 ]──> Tag Git Checkpoint (daedalus-checkpoint/m-*)
      │
      ▼
 [4. STACKED PR PACKAGING]
      │
      ▼ Auto-pushes marathon branch & creates interactive Stacked PR on GitHub
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ Pull Request #178: feat(webui): add a companion web UI to Daedalus          │
 │ - Milestone progress checklist & checkpoint tag links                       │
 │ - Apollo audit scorecards & delivery breakdown                              │
 │ - Ready for one-click human merge review                                    │
 └─────────────────────────────────────────────────────────────────────────────┘
```

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

### 3. The B.R.A.G. Autonomous Framework & The Marathon Engine

The core methodology of the Daedalus project is the **B.R.A.G. framework**. It pairs Directed Acyclic Graph (DAG) task scheduling with semantic codebase Retrieval-Augmented Generation (RAG) to ensure structured, non-linear progress and total state-awareness.

The synergy between DAG scheduling and RAG memory is the framework's primary defense against failure. The DAG serves as a **strict dependency graph**, ensuring agents never execute tasks out of order or fall into the infinite loops common in chat-based interfaces. While B.R.A.G. defines the methodology, the **Marathon Engine** serves as the high-performance implementation designed for long-duration autonomy.

---

### 4. Case Study: Autonomous Construction of the Companion Web UI

To validate the B.R.A.G. framework, the Marathon Engine was tasked with constructing a full-featured Companion Web UI with real-time SSE telemetry. The engine successfully executed a six-milestone stack:

1. **M-1: Scaffolding** (`src/webui/index.ts`): Established directory structure. **Score: 100/100.**
2. **M-2: HTTP Server** (`src/webui/server.ts`): Bound native Node server to Port 3888. **Score: 85/100.**
3. **M-3: SSE Telemetry Stream** (`src/webui/server.ts`): Implemented `text/event-stream` with 1s intervals. **Score: 85/100.**
4. **M-4: Dark Cyber Dashboard UI** (`src/webui/public/`): Created responsive CSS/JS with live gauges. **Score: 100/100.**
5. **M-5: CLI Slash Command Integration** (`src/commands/webui.ts`): Implemented start/stop/status controls. **Score: 95/100.**
6. **M-6: Vitest Unit & Integration Suites** (`src/webui/server.test.ts`): Generated 11 tests covering all routes. **Score: 100/100.**

The Marathon Engine considers a **Score $\ge$ 70 a PASS**, allowing for minor stylistic variations while enforcing rigorous functional integrity. The engine moved the project from a macro-goal to a verified, ready-to-merge state—handling everything from low-level port binding to high-level UI styling—without human intervention.

---

### 5. Handoff: Stacked PR Packaging and Technical Integrity

The final artifact of a Marathon run is the **Stacked Pull Request** (e.g., PR #178). This is a verifiable package of engineering work that transforms the human role from a micro-manager to a high-level strategic reviewer.

A Daedalus Stacked PR contains:

- **Milestone Progress Checklists:** A verified record of completed requirements.
- **Checkpoint Links:** Direct access to permanent git tags for every milestone.
- **Apollo Scorecards:** Objective, independent audit results for every code change.
- **CI Validation:** A verified pass across the CI matrix for Linux, macOS, and Windows.

This approach ensures that technical integrity is a structural guarantee rather than an afterthought. We are moving beyond the era of fragile "AI assistance" and into the era of **Autonomous Systems**—verifiable, self-correcting, and architecturally sound engineering frameworks that scale to the complexity of the modern enterprise.
