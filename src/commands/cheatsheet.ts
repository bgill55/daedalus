import pc from 'picocolors';
import type { Command, CommandContext } from './types.js';

export const cheatsheetText = `\n${pc.bold(pc.cyan('Daedalus Local-First Onboarding Cheat Sheet'))}\n\n${pc.bold(pc.yellow('1. CRITICAL SLASH COMMANDS'))}\n${pc.bold('Model & Connection Management')}
  ${pc.bold('/onboard')}                          Rerun the interactive setup wizard (scan ports & remote providers)
  ${pc.bold('/preset <local-free|cloud-power|hybrid|privacy-strict>')}  Apply curated provider chains
      local-free     Direct local default setups (Ollama / LM Studio), zero token fees
      cloud-power    High-intelligence BYOK setup (Anthropic, OpenAI, OpenRouter)
      hybrid         Fast local model for minor edits + cloud models for complex tasks
      privacy-strict 100% offline local execution, web tools disabled
  ${pc.bold('/model [list|add|remove|enable|disable|sync]')}  Dynamic model roster management (no manual JSON edits)
      /model sync    Resolve router/model mismatches and refresh the live model list
  ${pc.bold('/health')}                         Check provider connections, latency & API key status

${pc.bold('Codebase Code-Tracing & Refactoring')}
  ${pc.bold('/find <symbol>')}                  Search exact FTS5 symbol definitions across indexed files
  ${pc.bold('/refs <symbol>')}                  Trace caller references (imports/usages)
  ${pc.bold('/callgraph <symbol> [depth]')}     Visual call graph & refactoring blast-radius prediction
  ${pc.bold('/impact <symbol>')}                Calculate LOW/MEDIUM/HIGH blast-radius risk score

${pc.bold('Trajectory Branching & Memory')}
  ${pc.bold('/session branch <name>')}          Immutable snapshot of turns + active context up to now
  ${pc.bold('/session checkout <name>')}        Switch REPL to an alternate branch to explore other paths
  ${pc.bold('/session branches')}               Tree view of active & archived session branches
  ${pc.bold('/session merge <name>')}           Extract code diffs from a branch, apply via git, append history to parent
  ${pc.bold('/sigma')} or ${pc.bold('/memory')}               View active SQLite-backed session memories & decay counts

${pc.bold('Playbooks & Task Delegation')}
  ${pc.bold('/skills')}                         List trusted skills & review proposed drafts (~/.daedalus/skills/.drafts/)
  ${pc.bold('/shortcut <alias> = <command>')}   Create custom command aliases (e.g. /shortcut qt = /test 1 -g)

${pc.bold(pc.yellow('2. ESSENTIAL ENVIRONMENT VARIABLES'))}
  ${pc.bold('DAEDALUS_ALLOW_INSTALL=true')}     Auto-approve package installs (npm/pip) in autopilot
  ${pc.bold('DAEDALUS_AUTO_APPROVE=true')}     Non-interactive auto-approval for shell commands & refactors
  ${pc.bold('DISCORD_WEBHOOK_URL=<url>')}       Rich color-coded status embeds (spec queue, work start, PR ready)
  ${pc.bold('DAEDALUS_DEBUG=true')}            Log routing telemetry & complexity tier shifts
  ${pc.bold('GITHUB_TOKEN=<token>')} / ${pc.bold('GH_TOKEN')}  GitHub issue polling, branch creation & automated PRs

${pc.bold(pc.yellow('3. HARDWARE OPTIMIZATION (8GB VRAM / 32GB RAM)'))}
  1. Restrict Context Length to ${pc.bold('8192 (8k)')} in LM Studio / Ollama to prevent CPU RAM spills.
  2. Recommended Local Models (GGUF Q4_K_M or Q5_K_M):
     • ${pc.bold('Qwen2.5-Coder-7B-Instruct')} – High accuracy multilingual code generation.
     • ${pc.bold('Llama-3-8B-Instruct')} – Efficient general task planning & orchestration.

${pc.bold(pc.yellow('4. EMBEDDED GUARDRAILS & RESILIENCE'))}
  • ${pc.bold('Command Circuit Breaker')} – Tracks normalized command prefixes (cd, npm install). If the exact same
    command runs 3 consecutive times with no progress or fails repeatedly, execution halts and prompts for a new approach.
  • ${pc.bold('Batch Short-Circuit')} – If a single turn requests multiple actions and a file-modifying tool fails,
    Daedalus aborts all dependent calls to avoid building against corrupt code. Read-only tools (read_file, git_diff) keep running.
  • ${pc.bold('Pre-Flight Codebase Auditing (Task 0)')} – Before new tasks, Daedalus runs \`npx tsc --noEmit\`. If pre-existing
    TS/build errors are found, it prepends Task 0 and assigns the Debugger agent to fix them first.
`;

export const cheatsheetCommand: Command = {
  name: '/cheatsheet',
  aliases: ['cheat', 'guide'],
  description: 'Display the Daedalus local-first onboarding cheat sheet',
  usage: '/cheatsheet',
  helpText: 'Displays a formatted reference cheat sheet for critical slash commands, environment variables, hardware optimization tips, and safety guardrails.',
  execute: async (_args: string, _ctx: CommandContext): Promise<void> => {
    console.log(cheatsheetText);
  },
};
