# The B.R.A.G. Autonomous Framework & The Marathon Engine
## A Paradigm for Long-Horizon Multi-Agent Software Engineering

---

## Abstract

Traditional multi-agent software systems and autonomous AI coding assistants hit a rigid ceiling during long-horizon software development tasks, typically collapsing after 15 to 30 minutes of continuous execution. This systemic breakdown is caused by three key vectors: **context rot** (transcripts polluted with past errors), the **regression trap** (unproductive, circular repair loops), and **biased self-testing** (coder agents writing tautological assertions to falsely validate their own broken output). 

To overcome these barriers, we introduce the **B.R.A.G. (Build, Retrieve, Audit, Generate) Autonomous Framework** and the **Daedalus Marathon Engine**. By coupling **Directed Acyclic Graph (DAG) task scheduling** with **Retrieval-Augmented Generation (RAG) memory retrieval** and **$\Sigma$-Mem continuous reliability scoring**, this architecture guarantees that multi-agent development cycles remain linear, structured, and immune to infinite loops or repetitive errors. 

We demonstrate the efficacy of this paradigm through an end-to-end multi-day autonomous marathon run that successfully scaffolds, implements, verifies, and packages a complete, responsive **Sovereign PWA Companion & Web UI** with real-time Server-Sent Events (SSE) telemetry, WebSocket milestone push events, gold SVG vector iconography, and mobile QR pairing—resulting in a fully validated, production-ready GitHub **Stacked Pull Request**.

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

---

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
 │ MARATHON_ROADMAP.md (Persistent DAG state in git root)                      │
 │   ├─ M-1: Service Worker Caching & Manifest Schema           [✓ PASS]       │
 │   ├─ M-2: Mobile-First Responsive HUD (375px–900px)          [✓ PASS]       │
 │   ├─ M-3: Touch-Optimized UI & 48px Tap Targets              [✓ PASS]       │
 │   ├─ M-4: WebSocket Milestone Push Notifications             [✓ PASS]       │
 │   ├─ M-5: Themed Gold QR Code LAN Pairing Portal             [✓ PASS]       │
 │   └─ M-6: Vitest Multi-OS Integration & PWA Verification     [✓ PASS]       │
 └─────────────────────────────────────────────────────────────────────────────┘
      │
      ▼ For each pending milestone in topological order:
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ 2. HEPHAESTUS (Coder)                                                       │
 │    - Injects Σ-Mem domain lessons & active project anti-patterns            │
 │    - Applies surgical patches / module code within max-turn budget          │
 └─────────────────────────────────────────────────────────────────────────────┘
      │
      ▼ Out-of-Band Hand-off (Air-Gapped — Zero Coder Transcript History)
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ 3. APOLLO (Air-Gapped Evaluator)                                            │
 │    - Pre-LLM Filter: Zero-byte file gate & empty-diff detection             │
 │    - Runs milestone verification commands (npm test, tsc, lint)             │
 │    - Issues Scorecard (0–100) & PASS / NEEDS_FIX / STOP verdict             │
 └─────────────────────────────────────────────────────────────────────────────┘
      │
      ├───────────────────────┬────────────────────────┐
      │ PASS (Score >= 70)    │ FAIL (Turns remaining) │ EXHAUSTED (0 Turns)
      ▼                       ▼                        ▼
 ┌───────────────┐       ┌────────────────┐       ┌────────────────────────┐
 │ Create Git    │       │ Asclepius      │       │ Rollback Arbitrator    │
 │ Checkpoint Tag│       │ In-Flight Fix  │       │ git reset --hard m-N-1 │
 │ m-<id>        │       │ (Self-Healing) │       │ Log Σ-Mem Anti-Pattern │
 └───────────────┘       └────────────────┘       └────────────────────────┘
```

---

## 1. The Crisis of Long-Horizon Autonomy: Beyond the 30-Minute Collapse

The current state of AI-driven development is plagued by "sprint-based" myopia—a reliance on tools that excel in narrow 15-to-30-minute context windows but succumb to **stochastic degradation** in high-entropy, long-context environments. To achieve "marathon-capable" autonomous systems, we must engineer past the systemic failures of traditional multi-agent swarms:

1. **Context Rot**: The accumulation of high-token-weight noise, irrelevant terminal logs, and circular reasoning that dilutes the model's attention.
2. **Circular Regression Trap**: Endless repair loops where fixing bug A introduces bug B, and fixing bug B re-introduces bug A.
3. **Transcript Bias & Tautological Testing**: In standard swarms, agents often write and mock their own tests, creating an illusory success state where the system validates its own flawed logic. The agent believes it is progressing because it passes tests it hallucinated to fit its own broken implementation.

The Daedalus ecosystem counteracts these pitfalls by providing a local-first foundation built on state-machine determinism, air-gapped evaluation, and formal verification.

---

## 2. System Architecture: The Divine Machine Pantheon

Establishing robust autonomy requires a strategic pivot toward local-first foundations and **SpecFirst** contract verification. To manage cognitive load and prevent "generalist fatigue", we utilize the **Divine Machine Pantheon**:

* **@daedalus / @orchestrator**: Executes high-level planning, user delegation, and global loop coordination.
* **@themis / @spec**: Generates formal specification contracts that serve as the immutable ground truth for success.
* **@metis / @planner**: Performs sequential task decomposition into atomic milestone DAGs.
* **@hephaestus / @coder**: Handles production logic drafting, atomic workspace patching, and module creation.
* **@apollo / @reviewer**: An air-gapped auditor that inspects git diffs and delivers independent **PASS / NEEDS_FIX / STOP** scorecards.
* **@asclepius / @debugger**: Conducts targeted in-flight diagnostic isolation and self-healing.
* **@mnemosyne / @researcher**: Retrieves external documentation, codebase symbols, and project lore.

This specialized role separation ensures that the agent responsible for coding is never the one responsible for the audit, mathematically eliminating tautological error propagation.

---

## 3. Case Study: Constructing the Sovereign PWA Companion

To validate the B.R.A.G. framework and Marathon Engine, the system was tasked with transforming the Daedalus WebUI into a production-grade **Sovereign PWA Companion & Telemetry Dashboard** across a 6-milestone stack:

* **M-1 & M-2 (Core Infrastructure & Offline Shell)**: Scaffolding `src/webui/`, establishing service worker caching (`public/sw.js`), and implementing the PWA manifest (`public/manifest.json`).
* **M-3 (Fluid Responsive HUD)**: Engineering `public/styles.css` with mobile breakpoints (`600px` and `900px`), horizontal card compaction, and centered brand alignment.
* **M-4 (Touch-Optimized Controls & Action Bar)**: Implementing 48px tactile touch targets, dual `pointerdown` listeners, and multi-line auto-scaling prompt inputs.
* **M-5 (WebSocket Milestone Telemetry & Push Alerts)**: Creating a dedicated WebSocket server (`src/webui/ws.ts`) that broadcasts milestone completions and triggers native mobile push notifications.
* **M-6 (Sovereign LAN Pairing & Gold QR Portal)**: Implementing real-time LAN IPv4 auto-detection (`src/webui/qr.ts`) and generating high-contrast gold-on-obsidian QR codes for instant mobile device pairing.

### Sovereign Link & HTTPS Security
The companion server binds to **port 3888** locally. To support mobile Chrome’s PWA installation requirements over local Wi-Fi without third-party cloud relays, the architecture integrates seamlessly with **Tailscale** private subnets and **Cloudflare Tunnels**, keeping all tokens, files, and conversation history bound strictly to local user hardware.

---

## 4. Git Stacked PR Packaging: The Human-in-the-Loop Interface

The final delivery artifact of a marathon run is the **Stacked Pull Request** (e.g., PR #178 and PR #181). This methodology bridges autonomous execution with human oversight by structuring multi-day progress into a series of logically ordered, verified increments:

* **Functional Diffs**: Clean, atomic git diffs relative to the preceding milestone checkpoint.
* **Apollo Scorecards**: Objective criteria verification with explicit numerical scores (0–100).
* **Milestone Progress Tracking**: Living status synchronization in `MARATHON_ROADMAP.md`.
* **Multi-Platform CI Matrices**: Automated validation across Ubuntu, Windows, and macOS test runners.

---

## 5. Appendix: $\Sigma$-Mem Dynamic Hardening & Reliability Scoring

The $\Sigma$-Mem engine, backed by SQLite, tracks the reliability, usage frequency, and verification history of all tools, patterns, and modules. Low reliability scores trigger **Negative Learning** mechanisms to prevent repeat failures.

### Live $\Sigma$-Mem Production Knowledge Table

| Asset / Knowledge Pattern | Σ-Score | Usage Count | Verifications | Status |
|:---|:---:|:---:|:---:|:---|
| `tool: daedalus-cli` | **100%** | 1,076 | 20✓ / 0✗ | Verified Core |
| `architecture: Harness-of-Harness (HoH)` | **100%** | 773 | 20✓ / 0✗ | Verified Core |
| `agent personas: Pantheon Delegation` | **100%** | 772 | 20✓ / 0✗ | Verified Core |
| `Milestone M-1: Setup Web UI Directory` | **100%** | 525 | 11✓ / 0✗ | Verified Milestone |
| `PWA Manifest & Icon Schemas` | **70%** | 1 | 1✓ / 0✗ | Active Memory |
| `Touch-Optimized UI & 48px Tap Targets` | **73%** | 4 | 1✓ / 0✗ | Active Memory |
| `Themed QR Code LAN Pairing Portal` | **72%** | 3 | 1✓ / 0✗ | Active Memory |
| `Full-File Overwrite on Large Stylesheets` | **51%** | 4 | 0✓ / 1✗ | **PITFALL / AVOID** |
| `Unbounded Rewrite on Large Client Scripts` | **50%** | 3 | 0✓ / 1✗ | **PITFALL / AVOID** |

### Continuous Hardening via Anti-Patterns
When patterns like *Full-File Overwrites on Large Stylesheets* drop to **51%** due to turn exhaustion, $\Sigma$-Mem automatically records them into `sigma_anti_patterns`. On subsequent turns, the engine dynamically injects explicit `[PITFALL]` warning blocks:

```text
[PITFALL DETECTED — Σ-Score: 51%]
Previous attempt to rewrite large stylesheet via write_file caused turn exhaustion.
RULE: Use surgical patch operations or modular sub-files instead of whole-file overwrites.
```

This ensures the system continuously learns from every execution, immunizing the agent against known failure modes and making each marathon sprint faster and more reliable than the last.
