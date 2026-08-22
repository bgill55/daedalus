import pc from 'picocolors';
import type { Command, CommandContext } from './types.js';

export const faqText = `\n${pc.bold(pc.cyan('Daedalus Local-First FAQ'))}\n\n${pc.bold(pc.yellow('HARDWARE & LOCAL EXECUTION'))}
${pc.bold('Q: How do I try Daedalus without installing anything?')}
  Open the Daedalus-Lite Live Demo (https://bgill55.github.io/daedalus-lite/live-demo.html) — a
  browser-based interactive REPL sandbox (no install, a few free queries included). For the full
  CLI: npm install -g daedalus-cli (Node.js 20+) pointed at Ollama/LM Studio or your own API key.

${pc.bold('Q: What are the hardware requirements for running Daedalus 100% locally?')}
  GPU: 8GB VRAM minimum. System memory: 32GB RAM. Node.js: version 20 or higher.

${pc.bold('Q: My local LLM is running incredibly slow (minutes per turn) or hanging. How do I fix this?')}
  This is CPU/RAM Spillover. Local models default to a 32k context window, which spills out of
  8GB VRAM into system RAM and triggers slow CPU fallback.
  Fix: in LM Studio / Ollama, set the Context Length limit to ${pc.bold('8192 (8k)')} so the model runs fully in VRAM.

${pc.bold('Q: Which local models are officially recommended?')}
  • ${pc.bold('Qwen2.5-Coder-7B-Instruct')} (Q4_K_M / Q5_K_M) – accurate multilingual code generation & inline patching.
  • ${pc.bold('Llama-3-8B-Instruct')} (Q4_K_M / Q5_K_M) – general chat, sub-agent planning, orchestrator loops.

${pc.bold(pc.yellow('MODEL ROUTING, TIERS & PRESETS'))}
${pc.bold('Q: How does the embedded model router handle complex vs. simple tasks?')}
  Dynamic Complexity-Based Routing classifies each prompt:
  • Fast tier – simple edits (typos, single commas).
  • Standard tier – average, slightly ambiguous tasks.
  • Intelligence tier – heavy refactors, multi-file changes, 3+ file commands.
  Re-routes on the fly: 3+ tool failures or >20 tool calls escalates to intelligence; 3 quiet turns
  (no failures / file writes) downgrades to a faster tier.

${pc.bold('Q: What happens if my primary LLM provider rate-limits or crashes?')}
  Automatic Multi-Model Fallback Chain: on 429 / timeout / 5xx, the failing model is temporarily
  excluded and the router failover to the next healthy candidate in your priority chain — no errors,
  no broken REPL session.

${pc.bold('Q: What are the ready-to-use presets and how do I apply them?')}
  Run ${pc.bold('/preset')} to apply four chains:
  • ${pc.bold('local-free')} – LM Studio / Ollama local defaults, zero token fees.
  • ${pc.bold('cloud-power')} – high-intelligence BYOK (OpenAI, Anthropic, OpenRouter).
  • ${pc.bold('hybrid')} – fast local for quick edits + cloud for complex orchestration.
  • ${pc.bold('privacy-strict')} – 100% offline local execution, web tools disabled.

${pc.bold(pc.yellow('SPECFIRST ARCHITECTURE & VERIFICATION GATES'))}
${pc.bold('Q: What is "SpecFirst" and how does it prevent agent coding pitfalls?')}
  It inserts a mandatory spec + verification gate before/after code synthesis, preventing Contract
  Drift, Untested Assertions, and Goal Drift. Run ${pc.bold('/spec <goal>')} to gather requirements and
  write both .daedalus/spec.md (human) and .daedalus/spec.json (machine contract).

${pc.bold('Q: How does the SpecFirst Verification Engine enforce code safety?')}
  It runs verifySpecAssertions() alongside build/compiler checks: confirms target files exist, required
  type/function signatures are exported, and code aligns 100% with the JSON contract. On failure it feeds
  logs into the auto-repair loop.

${pc.bold(pc.yellow('Σ-Mem (SIGMA-MEMORY) ENGINE'))}
${pc.bold('Q: What is the "Context Pollution" problem and how does Σ-Mem solve it?')}
  Flat chat history stores failed attempts and hallucinations alongside valid code, polluting context.
  Σ-Mem scores and prunes memories from real verification feedback (compile, lint, test, spec contracts).

${pc.bold('Q: What is the math behind Σ-Mem scoring and pruning?')}
  Baseline reliability starts at ${pc.bold('0.70')}.
  • Reward (+0.10): a patch that passes build → Σ_new = min(1.0, Σ_old + 0.10).
  • Penalty (×0.70 decay): build fails or patch rolled back.
  • Auto-Prune (<0.20): purged from SQLite to clear hallucinations.
  Only memories with Σ ≥ 0.60 are injected into sub-agent prompts.

${pc.bold(pc.yellow('GUARDRAILS, CIRCUIT BREAKERS & RESILIENCE'))}
${pc.bold('Q: The CLI says [CIRCUIT BREAKER]. Why did my command execution halt?')}
  The Command Circuit Breaker tracks normalized command prefixes (e.g. 'npm install foo' → 'npm install').
  On repeated failure it stops and asks you to change approach. The companion Repeat Breaker trips if the
  exact same command runs 3 consecutive times with zero progress (stops weak-model infinite loops).

${pc.bold('Q: What is a "Batch Short-Circuit" and why are some tool calls skipped?')}
  If a turn emits multiple tools and a file-mutating tool (patch/write_file) fails, Daedalus skips all
  subsequent mutating/build/test calls to avoid compiling against corrupt code. Read-only tools
  (read_file, git_status, git_diff) are never skipped, so the agent can inspect and recover.

${pc.bold(pc.yellow('WINDOWS SETUP & TROUBLESHOOTING'))}
${pc.bold('Q: Terminal tool crashes with Exit Code 3221225794 / 0xC0000142 on Windows. How do I resolve this?')}
  Fixed in ${pc.bold('v3.13.3')}. Cause: child processes inherited the parent stdin pipe and were killed when it
  closed. Fix: the terminal tool now uses stdio: ['ignore','pipe','pipe'] and detaches the process group.

${pc.bold('Q: A valid Windows patch was reverted as a "syntax error" even though my code is correct.')}
  Fixed in ${pc.bold('v3.13.1')}. Cause: syntaxCheck flagged any error on a touched line, even pre-existing ones.
  Fix: it compiles a pre-edit baseline and diffs post-edit diagnostics, so valid edits stick.

${pc.bold(pc.yellow('SANDBOXING & ISOLATION'))}
${pc.bold('Q: How do I isolate Daedalus execution environments?')}
  In ~/.daedalus/config.json under 'tools':
  • ${pc.bold('"sandbox": "docker"')} – spins up a container (default node:20), mounts project root to /workspace.
  • ${pc.bold('"sandbox": "wsl"')} – routes through WSL, translating Windows paths (D:\\project) to /mnt/d/project.

${pc.bold(pc.yellow('SKILLS (PLAYBOOK INGESTION)'))}
${pc.bold('Q: What are "Skills"? Are they executable code?')}
  No — instructions, not code. Markdown playbooks (yaml frontmatter + steps). A matching trigger phrase
  injects the playbook into the system prompt.

${pc.bold('Q: Can an untrusted codebase hijack my agent via a malicious SKILL.md?')}
  No. Skills load from two trusted locations only: the built-in shipped dir or ~/.daedalus/skills/.
  Never from the workspace you are editing.

${pc.bold('Q: How does the agent propose and learn new skills?')}
  Sub-agents call propose_skill → draft saved to ~/.daedalus/skills/.drafts/. Use ${pc.bold('/skills')} to review,
  then ${pc.bold('/skills accept <name>')} to promote it to a trusted active skill.

${pc.bold(pc.yellow('MODEL CONTEXT PROTOCOL (MCP)'))}
${pc.bold('Q: Does Daedalus support MCP? How do I install external tools?')}
  Yes — stdio and HTTP/SSE transports. From the REPL:
  • ${pc.bold('/mcp explore')} – browse curated community MCP servers.
  • ${pc.bold('/mcp search <query>')} – search the registry (no API key).
  • ${pc.bold('/mcp install <name>')} – writes the config to ~/.daedalus/config.json.
  Enabled servers connect in parallel on startup; their tools register as native agent tools (user-consent gated).
`;

export const faqCommand: Command = {
  name: '/faq',
  aliases: ['questions', 'faqs'],
  description: 'Display the Daedalus local-first FAQ (setup, architecture, troubleshooting)',
  usage: '/faq',
  helpText: 'Displays a formatted FAQ covering hardware, model routing, SpecFirst, Sigma-Memory, guardrails, Windows troubleshooting, sandboxing, skills, and MCP.',
  execute: async (_args: string, _ctx: CommandContext): Promise<void> => {
    console.log(faqText);
  },
};
