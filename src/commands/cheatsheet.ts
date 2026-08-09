import pc from 'picocolors';
import type { Command, CommandContext } from './types.js';

export const cheatsheetText = `
${pc.bold(pc.cyan('🛠️  Daedalus Local-First Onboarding Cheat Sheet 🚀'))}

${pc.bold(pc.yellow('💻 1. CRITICAL SLASH COMMANDS'))}
  ${pc.bold('/onboard')}                          Run setup wizard (scan ports & remote providers)
  ${pc.bold('/preset <local-free|cloud|hybrid>')} Apply curated provider chains
  ${pc.bold('/model [list|add|remove|enable]')} Dynamic model roster management
  ${pc.bold('/health')}                         Check provider connections, latency & API keys
  ${pc.bold('/find <symbol>')}                  Search exact FTS5 symbol definitions
  ${pc.bold('/refs <symbol>')}                  Trace caller references across codebase
  ${pc.bold('/callgraph <symbol>')}             Visual call graph & blast radius prediction
  ${pc.bold('/impact <symbol>')}                Calculate LOW/MED/HIGH refactoring risk score
  ${pc.bold('/session branch|checkout|merge')}   Trajectory branching & history merging
  ${pc.bold('/sigma')} or ${pc.bold('/memory')}               View active SQLite-backed session memories
  ${pc.bold('/skills')}                         List active skills & review proposed drafts
  ${pc.bold('/shortcut <alias> = <cmd>')}       Create custom command aliases

${pc.bold(pc.yellow('⚙️  2. ESSENTIAL ENVIRONMENT VARIABLES'))}
  ${pc.bold('DAEDALUS_ALLOW_INSTALL=true')}     Auto-approve package installs (npm/pip) in autopilot
  ${pc.bold('DAEDALUS_AUTO_APPROVE=true')}     Non-interactive auto-approval for shell commands
  ${pc.bold('DISCORD_WEBHOOK_URL=<url>')}       Send rich status embeds to Discord
  ${pc.bold('DAEDALUS_DEBUG=true')}            Log routing telemetry & complexity tier shifts
  ${pc.bold('GITHUB_TOKEN=<token>')}           GitHub issue polling & automated PR creation

${pc.bold(pc.yellow('🖥️  3. HARDWARE OPTIMIZATION (8GB VRAM / 32GB RAM)'))}
  1. Restrict Context Length to ${pc.bold('8192 (8k)')} in LM Studio / Ollama to prevent CPU RAM spills.
  2. Recommended Local Models (GGUF Q4_K_M or Q5_K_M):
     • ${pc.bold('Qwen2.5-Coder-7B-Instruct')} – High accuracy multilingual code generation.
     • ${pc.bold('Llama-3-8B-Instruct')} – Efficient general task planning & orchestration.

${pc.bold(pc.yellow('🛡️  4. EMBEDDED GUARDRAILS & RESILIENCE'))}
  • ${pc.bold('Command Circuit Breaker')} – Halts repeated command failures after 3 identical attempts.
  • ${pc.bold('Batch Short-Circuit')}     – Aborts dependent tool calls if a prior file patch fails.
  • ${pc.bold('Pre-Flight Auditing')}      – Runs \`npx tsc --noEmit\` before tasks (prepends Task 0 if broken).
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
