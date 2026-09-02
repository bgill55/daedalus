# Case Study: Multi-Day Autonomy in Action — The Marathon Engine Walkthrough

<p align="center">
  <img src="images/Daedalus_Marathon_Engine_Architecture_Overview.png" alt="Daedalus Marathon Engine: Harness-of-Harness Architecture" width="100%"/>
</p>

This case study documents an authentic, end-to-end execution of the **Daedalus Marathon Engine** (`/marathon`), demonstrating how the **Harness-of-Harness (HoH)** meta-loop decomposes complex projects, conducts air-gapped evaluations, and executes hard git rollbacks when code changes fail verification.

---

## The Challenge: Long-Horizon Software Development

Standard coding assistants and sprint tools excel at 15-to-30-minute tasks. However, long-horizon software engineering across dozens of iterations typically suffers from three fatal bottlenecks:
1. **Context Rot**: Massive conversation transcripts accumulate obsolete intermediate code and confusing logs, causing the LLM to hallucinate or lose focus.
2. **The Regression Trap**: When a bug appears, the agent often enters endless "repair-the-repair" cycles, breaking previously working components.
3. **Biased Self-Testing**: The agent that wrote the code evaluates its own work, often hallucinating that tests passed or mocking away critical functionality.

The **Daedalus Marathon Engine** solves this by separating **macro-planning**, **sprint execution**, **air-gapped evaluation**, and **git rollback arbitration**.

---

## Live Walkthrough: Building a Markdown Parsing Engine

### Stage 1: Macro-Planning with Metis

The user provides a high-level vision without needing to specify low-level file structures:

```bash
/marathon "Build a markdown parser that converts # headings and **bold** text to HTML, with node:test unit tests"
```

**Metis** (the architectural macro-planner) inspects the workspace tech stack and decomposes the vision into an ordered sequence of 7 atomic, verifiable milestones:

```text
[METIS] Synthesizing milestone roadmap...
[OK] Generated 7 verifiable milestone(s):

  1. [m-1] Project scaffolding: Initialize Node.js project with TypeScript support, add .gitignore, and configure test script.
     Criteria: package.json has test script; tsconfig.json present; .gitignore present
  2. [m-2] Basic testing harness: Create initial test file using node:test.
     Criteria: test/setup.test.ts created; npm test exits 0
  3. [m-3] Markdown parser stub: Create parser module exporting parseMarkdown.
     Criteria: src/parser.ts exports parseMarkdown function
  4. [m-4] Heading conversion: Convert '# ' lines to '<h1>...</h1>'.
     Criteria: '# Title' -> '<h1>Title</h1>'; other lines unchanged; unit tests pass
  5. [m-5] Bold text conversion: Convert '**text**' to '<strong>text</strong>'.
     Criteria: '**bold**' -> '<strong>bold</strong>'; nested bold handled; tests pass
  6. [m-6] Combined feature integration: Handle both headings and bold in same string.
     Criteria: '# **Title**' -> '<h1><strong>Title</strong></h1>'; no regressions
  7. [m-7] Documentation & final verification: Add README usage guide and run full test suite.
     Criteria: README.md has examples; npm test reports 0 failures; build passes
```

Metis immediately renders and commits `MARATHON_ROADMAP.md` to the repository root.

---

### Stage 2: Live Status & Roadmap Inspection (`/marathon status`)

Running `/marathon status` renders the visual ASCII roadmap, tracking progress across all milestones:

```text
════════════════════════════════════════════════════════════════
 [MARATHON ROADMAP STATUS]
════════════════════════════════════════════════════════════════

# Marathon Roadmap: Build a markdown parser that converts # headings and **bold** text to HTML...

- **Status**: running
- **Active Milestone**: 1 of 7
- **Base Branch**: main
- **Marathon Branch**: marathon/build-a-markdown-parser-that-converts-headings-and-bold-text-to-html

## Milestones

### [ ] M-1: Project scaffolding
- **Target Files**: package.json, tsconfig.json, .gitignore
- **Attempts**: 0/3
- **Acceptance Criteria**:
  - [ ] package.json includes test script
  - [ ] tsconfig.json exists
  - [ ] .gitignore exists
```

---

### Stage 3: Autonomous Implementation Sprint (Hephaestus)

The Marathon Engine initiates Milestone 1 on an isolated integration branch (`marathon/m-1`). **Hephaestus** begins drafting the files:

```text
════════════════════════════════════════════════════════════════
 [MARATHON] Executing Milestone M-1: Project scaffolding
 Initialize the Node.js project with TypeScript support, add a .gitignore, and configure the test script.
 Attempt 1 of 3
════════════════════════════════════════════════════════════════

[AUTOPILOT] Active: [Hephaestus] updating package.json with test script...
[OK] Updated package.json
```

During this live run, Hephaestus updated `package.json`, but missed creating `tsconfig.json` and `.gitignore` before concluding the turn. In a conventional agent system, this partial failure would go unnoticed or corrupt the next sprint.

---

### Stage 4: Air-Gapped Apollo Audit (Zero-Bias Judge)

The Marathon Engine invokes **Apollo** in an **air-gapped LLM context** with zero conversation history from Hephaestus. Apollo receives *only*:
1. The milestone acceptance criteria
2. The actual git diff (`git diff HEAD~1..HEAD`)
3. The raw test command output

Apollo reviews the actual changes and delivers an unbiased verdict:

```text
[APOLLO] Running air-gapped independent evaluation...

[APOLLO AUDIT REPORT]
  Verdict:    FAILED
  Score:      33/100
  Summary:    The package.json was correctly updated to meet the requirements,
              but the mandatory tsconfig.json and .gitignore files are missing
              from the provided diff.
```

Apollo caught the exact missing files in the diff with pure mathematical detachment.

---

### Stage 5: Hard Rollback Arbitrator & $\Sigma$-Mem Ledger

Because Apollo rejected the milestone:
1. **Checkpointing is Blocked**: The Arbitrator refuses to create `daedalus-checkpoint/m-1`.
2. **Negative Learning Recorded**: The failure signature (`Missing tsconfig.json and .gitignore`) is recorded into `sigma_anti_patterns` in `project-mem.sqlite`.
3. **Hard Git Rollback**: The workspace is wiped and cleanly reset to the last verified commit:

```text
[FAIL] Milestone M-1 failed evaluation.
[REPAIR] Retrying milestone with targeted healing recommendations...

--- Testing /marathon rollback ---
[OK] Rolled back to clean base integration branch for milestone m-1.
```

The working tree is completely cleansed (`git reset --hard` + `git clean -fd`), banishing context rot and preventing the agent from getting trapped in an endless patch cycle.

---

## Key Benefits Demonstrated

| Feature | Standard Coding Agents | Daedalus Marathon Engine (HoH) |
| :--- | :--- | :--- |
| **Scope Horizon** | 1 file or 1 single feature | Multi-milestone systems across days |
| **Context Management** | Single growing transcript (rots after 10+ turns) | Isolated sprints reset per milestone |
| **Code Review** | Self-reviewing (confirms own errors) | Air-gapped Apollo judge (out-of-band) |
| **Failure Recovery** | Patches on top of broken patches | Hard git tag rollback (`daedalus-checkpoint/m-*`) |
| **Cross-Session Memory** | None (starts from scratch) | $\Sigma$-Mem anti-pattern avoidance ledger |