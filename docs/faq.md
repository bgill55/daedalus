#  Daedalus Local-First Discord FAQ

This FAQ answers the most common setup questions, architectural concepts, and troubleshooting issues for developers onboarding to the Daedalus ecosystem.

---

###  Hardware & Local Execution

#### Q: How do I try Daedalus without installing anything?
Open the [Daedalus-Lite Live Demo ](https://bgill55.github.io/daedalus-lite/live-demo.html) — a browser-based interactive REPL sandbox (no install, a few free queries included). To run the full CLI locally, install via `npm install -g daedalus-cli` (Node.js 20+) and point it at a local model (Ollama/LM Studio) or your own API key.

#### Q: What are the hardware requirements for running Daedalus 100% locally?
To run Daedalus locally and offline with near-instant generation times, your machine should ideally meet the following hardware profile:
* **GPU:** 8GB VRAM minimum.
* **System memory:** 32GB RAM.
* **Node.js version:** Version 20 or higher is required.

#### Q: My local LLM is running incredibly slow (minutes per turn) or hanging. How do I fix this?
This is a common issue known as **CPU/RAM Spillover**. By default, local models (like Qwen2.5-Coder or Llama 3) initialize with a 32k context length. Attempting to process a 32k context window on an 8GB VRAM GPU forces the model state to spill out of your GPU memory and into system RAM, triggering slow CPU fallback processing.
* **The Solution:** In your LM Studio or Ollama hardware configuration, manually set the **Context Length** limit to **8192 (8k)**. Keeping the context window capped at 8k ensures the active model runs entirely within your VRAM for instant local generation times and stable connections.

#### Q: Which local models are officially recommended?
For local execution, the system is tuned and verified against these specific GGUF quantizations:
1. **`Qwen2.5-Coder-7B-Instruct` (Quantized to `Q4_K_M` or `Q5_K_M`):** Recommended for highly accurate, multilingual code generation and inline patching (TypeScript, Python, Go, Rust).
2. **`Llama-3-8B-Instruct` (Quantized to `Q4_K_M` or `Q5_K_M`):** Highly recommended for high-level general chat, sub-agent planning, and orchestrator loops.

---

###  Model Routing, Tiers, & Presets

#### Q: How does the embedded model router handle complex vs. simple tasks?
Daedalus utilizes **Dynamic Complexity-Based Routing**. When you submit a prompt, the system classifies its complexity into a specific tier:
* **Fast tier:** Simple edits (typos, single commas).
* **Standard tier:** Average, slightly ambiguous tasks.
* **Intelligence tier:** Complex operations like heavy refactors, multi-file changes, or commands targeting 3+ files.

The router also **re-routes on the fly**. If a standard model hits 3+ tool failures or the tool chain exceeds 20 calls, the router escalates the task to the intelligence tier. If the task goes quiet (3 consecutive turns with no failures or file writes), it gracefully downgrades to a faster tier.

#### Q: What happens if my primary LLM provider rate-limits or crashes?
Daedalus features an automatic **Multi-Model Fallback Chain**. If an active provider returns a rate limit (429), a timeout, or a 5xx server error, the failing model is temporarily excluded, and the router immediately failover to the next healthy candidate in your priority chain without throwing errors or breaking your active REPL session.

#### Q: What are the ready-to-use presets and how do I apply them?
Instead of editing configuration files, you can execute `/preset` in the REPL to apply four pre-configured model router chains:
* **`local-free`:** LM Studio / Ollama local defaults for zero token fees.
* **`cloud-power`:** High-intelligence BYOK setup for OpenAI, Anthropic, or OpenRouter.
* **`hybrid`:** Fast local models for quick edits and standard tasks + cloud models for complex orchestration.
* **`privacy-strict`:** 100% offline local execution with web tools disabled.

---

###  SpecFirst Architecture & Verification Gates

#### Q: What is "SpecFirst" and how does it prevent agent coding pitfalls?
Traditional multi-agent systems often suffer from **Contract Drift** (mismatched parameter types across files), **Untested Assertions** (syntactically correct code that fails runtime logic), and **Goal Drift** (losing sight of constraints over long loops).

The **SpecFirst Architecture** solves this by inserting a mandatory specification and verification gate before and after code synthesis. When you run `/spec <goal>`, the system interactively gathers requirements, resolves ambiguities, and writes both a human-readable `.daedalus/spec.md` and a machine-readable `.daedalus/spec.json` contract.

#### Q: How does the SpecFirst Verification Engine enforce code safety?
During the verification stage of an orchestrator run, the engine executes `verifySpecAssertions()` alongside standard build/compiler checks. It verifies that all target contract files exist, that required type/function signatures are properly exported, and that the code aligns 100% with the JSON contract. If a spec assertion fails, the orchestrator feeds the failure logs back into the auto-repair loop to fix the code.

---

###  Σ-Mem (Sigma-Memory) Engine

#### Q: What is the "Context Pollution" problem and how does Σ-Mem solve it?
Traditional agent frameworks treat chat transcripts as flat history. They store every failed attempt, compilation warning, and hallucinated API right alongside valid code. Over long tasks, this noise pollates the context window, degrading the AI's cognitive performance.

The **Σ-Mem Engine** dynamically scores and prunes memories based on actual **verification feedback** (compilation, linting, tests, and spec contracts).

#### Q: What is the math behind Σ-Mem scoring and pruning?
Every memory snippet in your local session SQLite database starts with a baseline reliability score of **0.70**.
1. **Reward (+0.10):** When a sub-agent produces a code patch that successfully passes build verification, its memory Σ-score is boosted: Σ_new = min(1.0, Σ_old + 0.10).
2. **Penalty (30% Decay):** When build checks fail or a patch is rolled back, the associated memory decays: Σ_new = Σ_old × 0.70.
3. **Auto-Pruning (<0.20):** If a memory's reliability score falls below the **0.20** threshold, it is permanently purged from the local SQLite database to clear hallucinations.
Only memories with a score of Σ ≥ 0.60 are selectively injected into sub-agent prompts.

---

###  Guardrails, Circuit Breakers, & Resilience

#### Q: The CLI says `[CIRCUIT BREAKER]`. Why did my command execution halt?
Daedalus features an embedded **Command Circuit Breaker** to prevent runaway loops. It tracks **normalized command prefixes** (e.g. collapsing `npm install foo` to `npm install`).
* **If a command fails repeatedly:** Daedalus stops running it and prompts you to change your approach instead of burning your failure budget.
* **The Companion Repeat Breaker:** If the exact same command is executed 3 consecutive times with zero progress, the repeat breaker trips to halt execution. This prevents weak models from spinning up non-blocking, infinite loops.

#### Q: What is a "Batch Short-Circuit" and why are some of my tool calls skipped?
When an agent turn emits multiple tools at once (e.g., `[patch(src/app.ts), terminal("npm test")]`) and a file-mutating tool like `patch` or `write_file` fails, Daedalus automatically **skips all subsequent mutating or build/test calls** in that batch. This prevents executing compilations or tests against a corrupt/incomplete directory. Crucially, **read-only tools** (such as `read_file`, `git_status`, or `git_diff`) are never skipped, allowing the agent to inspect the failure and recover.

---

###  Windows Setup & Troubleshooting

#### Q: I am on Windows and my terminal tool crashes repeatedly with Exit Code `3221225794` / `0xC0000142`. How do I resolve this?
This was a critical environmental bug resolved in **v3.13.3**.
* **The Cause:** When running piped or non-interactive tasks, the terminal tool spawned child processes with default stdio (which inherited the parent's stdin pipe) and no detached process group. On Windows, when the parent pipe closed or received console signals, the child tree (bash -> npm -> tsc) was instantly terminated with `0xC0000142`.
* **The Fix:** Ensure you have updated to **v3.13.3 or higher**. The terminal tool now ignores stdin (`stdio: ['ignore', 'pipe', 'pipe']`) and detaches the process group on Windows to completely isolate the child build tree from parent console signals.

#### Q: A valid patch I applied on Windows was immediately reverted as a "syntax error" even though my code is correct. What happened?
This issue was fixed in **v3.13.1**. Originally, `syntaxCheck` flagged any compiler error on a touched line, even if that error was already pre-existing in your codebase before the patch was applied.
* **The Fix:** In **v3.13.1+**, the syntax checker compiles a temporary pre-edit baseline and diffs post-edit diagnostics against it. This successfully isolates pre-existing compiler errors, ensuring your completely valid edits stick.

---

###  Sandboxing & Isolation

#### Q: How do I isolate Daedalus execution environments?
By default, Daedalus executes commands on your host machine. To isolate your builds, you can configure Docker or WSL sandboxing in `~/.daedalus/config.json` under the `tools` configuration:
1. **Docker Sandbox (`"sandbox": "docker"`):** Automatically spins up a container using your configured image (defaults to `node:20` or user-defined images like `python:3.11`). It mounts your project root directory to `/workspace` inside the container. Any changes are instantly reflected on your host filesystem, but commands run in total isolation.
2. **WSL Sandbox (`"sandbox": "wsl"`):** For Windows developers, this routes commands directly through WSL. It automatically translates absolute Windows paths (e.g. `D:\project\src`) into their WSL Linux equivalents (e.g. `/mnt/d/project/src`) so execution occurs natively in Linux.

---

###  Skills (Playbook Ingestion)

#### Q: What are "Skills" in Daedalus? Are they executable code?
No, skills are **instructions, not code**. They are packaged Markdown playbooks (yaml frontmatter + step-by-step instructions) that define how an agent should handle a specific problem. When your REPL prompt matches a skill's trigger phrase (such as "fix the build" triggering the `fix-typescript-build` skill), Daedalus automatically injects the playbook into the active system prompt.

#### Q: Can an untrusted codebase hijack my agent by shipping a malicious `SKILL.md`?
No. For safety, skills are discovered from **two trusted locations only**: the built-in shipped directory, or your private user directory at `~/.daedalus/skills/`. Skills are **never** loaded from the workspace directory you are editing.

#### Q: How does the agent propose and learn new skills?
When Daedalus resolves a complex, non-obvious problem, sub-agents can call the `propose_skill` tool. This captures the playbook as an inactive draft in `~/.daedalus/skills/.drafts/`. You can use the `/skills` command in the REPL to review the draft, and execute `/skills accept <name>` to promote it into a trusted active skill.

---

###  Model Context Protocol (MCP)

#### Q: Does Daedalus support MCP? How do I install external tools?
Yes! Daedalus supports MCP over both **stdio** (local process spawning) and **HTTP/SSE** (remote endpoints) transports. You can manage external tools directly from the REPL:
*   `/mcp explore` – Browse curated community MCP servers.
*   `/mcp search <query>` – Search the official MCP registry with no API keys required.
*   `/mcp install <name>` – Fetches metadata, converts it into a Daedalus-compatible configuration, and writes the entry to your `~/.daedalus/config.json`.
On startup, Daedalus connects to all enabled servers in parallel, registers their tools as native agent tools, and filters sub-agent tasks to models configured with tool capabilities. MCP tools are also protected by the native user-consent safety gate!
