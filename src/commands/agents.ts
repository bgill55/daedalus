// Agent orchestration, MCP, setup & utility commands
import fs from 'fs';
import path from 'path';
import pc from 'picocolors';

import { executeToolCalls } from '../tools/executor.js';
import { spawnBackgroundAgent } from '../agents/background.js';
import { handleSpecCommand, getGitRepoInfo } from '../agents/loop.js';
import { generateSpecContract, loadSpecContract, formatSpecForPrompt } from '../agents/spec.js';
import { turnSeparator } from '../formatting.js';
import { execSync } from 'child_process';
import type { ModelEntry } from '../router/types.js';
import type { AgentResult, DelegationTask } from '../agents/orchestrator-types.js';
import type { RegistryServerEntry } from '../tools/mcp/manager.js';

import { errMessage } from '../utils/errors.js';

import { discoverLocalServers, saveConfig } from '../config/index.js';
import type { ToolCall, ChatMessage } from '../types.js';
import { messageText } from '../types.js';
import type { Command } from './types.js';

// Secret / credential filename patterns that must never be committed by an
// autonomous run, even if a sub-agent stages them.
const SECRET_FILE_PATTERN = /(\.env(\..*)?|.*\.key|.*\.pem|.*\.pfx|credentials.*|secrets?.*|.*id_rsa.*)$/i;

function isGitIgnored(cwd: string, file: string): boolean {
  try {
    execSync(`git check-ignore --quiet ${JSON.stringify(file)}`, { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Stage all changes but always unstage secret-looking or gitignored files so an
// autonomous run can never commit a .env / credential / build artifact the repo
// intended to keep untracked.
function safeGitAdd(cwd: string): void {
  try {
    execSync('git add -A', { cwd, stdio: 'ignore' });
  } catch {
    return;
  }
  try {
    const out = execSync('git diff --cached --name-only', { cwd, encoding: 'utf8' });
    const staged = out.split('\n').map((s) => s.trim()).filter(Boolean);
    const exclude = staged.filter((f) => SECRET_FILE_PATTERN.test(f) || isGitIgnored(cwd, f));
    if (exclude.length > 0) {
      execSync(`git reset -q -- ${exclude.map((f) => JSON.stringify(f)).join(' ')}`, { cwd, stdio: 'ignore' });
      console.log(pc.yellow(`[CHECK] Excluded ${exclude.length} secret/ignored file(s) from commit (e.g. .env) — not staged.`));
    }
  } catch {
    // best-effort
  }
}

// Gate the autopilot commit on the target project's own build + test scripts.
// Using the project's scripts (not a hand-rolled tsc invocation) keeps
// tsconfig/module-resolution correct and catches broken or empty test files
// that a sub-agent may have left behind. If the project declares no
// build/test scripts (e.g. a bare repo), the gate is skipped — the
// orchestrator already verified during the run.
async function runAutopilotVerify(cwd: string): Promise<{ ok: boolean; detail: string }> {
  const pkgPath = path.join(cwd, 'package.json');
  let scripts: Record<string, string> = {};
  try {
    scripts = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts ?? {};
  } catch {
    // No package.json — nothing to verify against.
    return { ok: true, detail: '' };
  }
  for (const script of ['build', 'test']) {
    if (!scripts[script]) continue;
    try {
      execSync(`npm run ${script}`, { cwd, stdio: 'ignore' });
    } catch (e) {
      const msg = e instanceof Error ? errMessage(e) : String(e);
      return { ok: false, detail: `npm run ${script} failed: ${msg.split('\n')[0]}` };
    }
  }
  return { ok: true, detail: '' };
}

export const agentCommands: Command[] = [
  {
    name: '/spawn',
    aliases: ['/delegate'],
    description: 'Spawn sub-agent: /spawn [--bg] <role> <task>',
    usage: '/spawn [--bg] <role> <task>  OR  /delegate [--bg] <task> to <role>',
    helpText: 'Spawns a specialized agent to execute a coding or research task.\n\nRoles:\n  spec                  Generates formal SpecFirst interface contracts and test cases\n  coder                 Implements, patches, and refactors code files\n  reviewer              Critically reviews changes and runs tests\n  debugger              Tackles compilation errors, runtime failures, and logs\n  researcher            Scans repository structure and reads doc resources\n  planner               Outlines architecture plans and coordinates execution\n\nOptions:\n  --bg                  Runs the agent asynchronously in the background',
    execute: async (args, ctx) => {
      let role = '';
      let task = '';
      let isBackground = false;

      let cleanedArgs = args.trim();
      if (cleanedArgs.startsWith('--bg ')) {
        isBackground = true;
        cleanedArgs = cleanedArgs.substring(5).trim();
      } else if (cleanedArgs.endsWith(' --bg')) {
        isBackground = true;
        cleanedArgs = cleanedArgs.substring(0, cleanedArgs.length - 5).trim();
      }

      if (cleanedArgs.includes(' to ')) {
        const match = cleanedArgs.match(/^(.+)\s+to\s+(\w+)$/i);
        if (match) {
          task = match[1].trim();
          role = match[2].toLowerCase();
        }
      } else {
        const parts = cleanedArgs.split(/\s+/);
        if (parts.length >= 2) {
          role = parts[0].toLowerCase();
          task = cleanedArgs.substring(parts[0].length).trim();
        }
      }

      const validRoles = ['spec', 'coder', 'reviewer', 'debugger', 'researcher', 'planner'];
      if (!role || !task) {
        console.log(pc.red('[WARN] Usage: /spawn [--bg] <role> <task>  OR  /delegate [--bg] <task> to <role>'));
        console.log(pc.gray(`  Roles: ${validRoles.join(', ')}`));
        return;
      }

      if (!validRoles.includes(role)) {
        console.log(pc.red(`[WARN] Unknown role: ${role}. Valid: ${validRoles.join(', ')}`));
        return;
      }

      const context = `Active files: ${Array.from(ctx.activeFiles.values()).join(', ') || 'none'}`;

      if (isBackground) {
        console.log(pc.cyan(`\n[SPAWN] Spawning ${role} agent in background for: ${task.slice(0, 80)}...`));
        const id = spawnBackgroundAgent(role, task, context, ctx.toolContext);
        console.log(pc.green(`[OK] Spawned background task #${id} (${role}) successfully.`));
        console.log(pc.gray(`  Check status via /tasks, view logs/results via /task ${id}, or cancel via /task kill ${id}`));
        return;
      }

      console.log(pc.cyan(`\n[SPAWN] Spawning ${role} agent for: ${task.slice(0, 80)}...`));

      const fakeToolCall: ToolCall = {
        id: `call_${Date.now()}`,
        type: 'function',
        function: {
          name: 'delegate_task',
          arguments: JSON.stringify({ goal: task, context, role }),
        },
      };

      const results = await executeToolCalls([fakeToolCall], ctx.toolContext);
      for (const result of results) {
        const status = result.success ? pc.green('✔') : pc.red('✗');
        console.log(`\n${status} ${role} agent completed`);
        console.log(pc.white(result.content));
        if (!result.success && result.error) {
          console.log(pc.red(`Error: ${result.error}`));
        }
      }
    }
  },
  {
    name: '/tasks',
    description: 'List background agent tasks',
    usage: '/tasks',
    helpText: 'Display a list of all active, completed, failed, or cancelled background agent tasks.',
    execute: async (_args, _ctx) => {
      const { backgroundJobs } = await import('../agents/background.js');
      if (backgroundJobs.size === 0) {
        console.log(pc.gray('No background tasks found.'));
        return;
      }

      console.log(pc.cyan('\n--- Background Tasks ---'));
      for (const job of backgroundJobs.values()) {
        const duration = job.finishedAt
          ? `${Math.round((job.finishedAt - job.startedAt) / 1000)}s`
          : `${Math.round((Date.now() - job.startedAt) / 1000)}s elapsed`;

        let statusStr: string;
        if (job.status === 'running') {
          statusStr = pc.blue('RUNNING');
        } else if (job.status === 'completed') {
          statusStr = pc.green('COMPLETED');
        } else if (job.status === 'failed') {
          statusStr = pc.red('FAILED');
        } else {
          statusStr = pc.yellow('CANCELLED');
        }

        console.log(`[#${job.id}] ${pc.bold(job.role)} — ${statusStr} (${duration})`);
        console.log(pc.gray(`  Goal: ${job.goal.slice(0, 80)}`));
      }
    }
  },
  {
    name: '/task',
    description: 'Manage background task: /task <id> | /task kill <id>',
    usage: '/task <id>  OR  /task kill <id>',
    helpText: 'Inspect or terminate background agent tasks.\n\nArguments:\n  <id>                  Show detail info, logs, and output/result of a background task\n  kill <id>             Cancel and terminate a running background task',
    execute: async (args, _ctx) => {
      const { backgroundJobs, killBackgroundAgent } = await import('../agents/background.js');
      const trimmed = args.trim();

      if (!trimmed) {
        console.log(pc.red('[WARN] Usage: /task <id>  OR  /task kill <id>'));
        return;
      }

      if (trimmed.startsWith('kill ')) {
        const idStr = trimmed.substring(5).trim();
        const id = parseInt(idStr, 10);
        if (isNaN(id)) {
          console.log(pc.red(`[WARN] Invalid task ID: ${idStr}`));
          return;
        }
        const killed = killBackgroundAgent(id);
        if (killed) {
          console.log(pc.green(`[OK] Task #${id} cancelled.`));
        } else {
          console.log(pc.red(`[WARN] Task #${id} is not running or not found.`));
        }
        return;
      }

      const id = parseInt(trimmed, 10);
      if (isNaN(id)) {
        console.log(pc.red('[WARN] Usage: /task <id>  OR  /task kill <id>'));
        return;
      }

      const job = backgroundJobs.get(id);
      if (!job) {
        console.log(pc.red(`[WARN] Task #${id} not found.`));
        return;
      }

      console.log(pc.cyan(`\n--- Task #${job.id} (${job.role}) ---`));
      console.log(`Goal: ${job.goal}`);
      console.log(`Status: ${job.status.toUpperCase()}`);
      console.log(`Started: ${new Date(job.startedAt).toLocaleTimeString()}`);
      if (job.finishedAt) {
        console.log(`Finished: ${new Date(job.finishedAt).toLocaleTimeString()}`);
        console.log(`Duration: ${Math.round((job.finishedAt - job.startedAt) / 1000)}s`);
      }

      if (job.status === 'completed' && job.result) {
        console.log(pc.white('\n--- Result ---'));
        console.log(job.result);
      } else if (job.status === 'failed' && job.error) {
        console.log(pc.red(`\n--- Error ---`));
        console.log(job.error);
      } else if (job.status === 'running') {
        console.log(pc.gray('\nThis task is still running. Check again later.'));
      }
    }
  },
  {
    name: '/orchestrate',
    aliases: ['/orc', '/run', '/o'],
    description: 'Orchestrate agents for a goal',
    usage: '/orchestrate <goal>',
    helpText: 'Spawns the Orchestration system to plan, execute, and verify a high-level coding goal.\nOrchestrate generates a task.md checklist, coordinates specialized sub-agents, runs verification commands, and handles self-repair loops automatically.',
    execute: async (args, ctx) => {
      const pendingPlan = ctx.sessionManager.getState('orchestrate_plan') as DelegationTask[] | null;
      const pendingGoal = ctx.sessionManager.getState('orchestrate_goal') as string | null;

      if (pendingPlan && pendingGoal) {
        const goal = args.trim();
        const shouldResume = !goal || goal.toLowerCase() === pendingGoal.toLowerCase();

        let proceed = false;
        if (shouldResume && process.env.DAEDALUS_AUTO_APPROVE === 'true') {
          proceed = true;
        } else if (shouldResume) {
          console.log(pc.yellow(`\n[INFO] Found a pending orchestration plan for: "${pendingGoal}"`));
          const answer = await ctx.askLine(`Would you like to resume it? [y]es / [n]o: `);
          const char = answer.trim().toLowerCase().slice(0, 1);
          if (char === 'y' || answer.trim() === '') {
            proceed = true;
          }
        }

        if (proceed) {
          console.log(pc.cyan(`\n[ORCHESTRATE] Resuming orchestration for: ${pendingGoal}`));
          const { Orchestrator } = await import('../agents/orchestrator.js');
          const orchestrator = new Orchestrator(ctx.router, ctx.messages, ctx.toolContext, ctx.sessionManager, ctx.config?.modelOverride);
          const planText = (ctx.sessionManager.getState('orchestrate_plan_text') as string | null) || '';
          const taskIndex = (ctx.sessionManager.getState('orchestrate_task_index') as number | null) || 0;
          const prevResults = (ctx.sessionManager.getState('orchestrate_results') as AgentResult[] | null) || [];

          const result = await orchestrator.resume(pendingGoal, planText, pendingPlan, taskIndex, prevResults);
          console.log(pc.white(`\n${result}`));
          return;
        } else {
          ctx.sessionManager.saveState('orchestrate_plan', null);
          ctx.sessionManager.saveState('orchestrate_goal', null);
          ctx.sessionManager.saveState('orchestrate_task_index', null);
          ctx.sessionManager.saveState('orchestrate_results', null);
          ctx.sessionManager.saveState('orchestrate_plan_text', null);
        }
      }

      const goal = args.trim();
      if (!goal) {
        console.log(pc.red('[WARN] Usage: /orchestrate <goal>'));
        return;
      }
      console.log(pc.cyan(`\n[ORCHESTRATE] Starting orchestration for: ${goal}`));
      const { Orchestrator } = await import('../agents/orchestrator.js');
      const orchestrator = new Orchestrator(ctx.router, ctx.messages, ctx.toolContext, ctx.sessionManager, ctx.config?.modelOverride);
      const result = await orchestrator.run(goal);
      console.log(pc.white(`\n${result}`));
    }
  },
  {
    name: '/ensemble',
    description: 'Ensemble model drafting pipeline',
    execute: async (args, ctx) => {
      const ensembleGoal = args.trim();
      if (!ensembleGoal) {
        console.log(pc.red('  Error: Please specify a goal for the ensemble draft. Example: /ensemble Implement feature X'));
        return;
      }

      try {
        const { runEnsembleWorkflow } = await import('../agents/ensemble.js');
        await runEnsembleWorkflow(ensembleGoal, ctx.toolContext, ctx.config, ctx.router);
      } catch (err) {
        console.log(pc.red(`\n  Error in ensemble drafting: ${errMessage(err)}`));
      }
      turnSeparator();
    }
  },
  {
    name: '/spec',
    description: 'Generate or view a SpecFirst contract (.daedalus/spec.json & spec.md)',
    usage: '/spec [generate <goal> | view | <goal>]',
    helpText: 'Generate formal SpecFirst interface contracts, TypeScript schemas, and test assertions before coding.\n\nSubcommands:\n  /spec view               Display the active feature specification contract\n  /spec generate <goal>    Generate a new SpecFirst contract for a goal\n  /spec <goal>            Generate spec contract and create GitHub issue',
    execute: async (args, ctx) => {
      const trimmed = args.trim();
      const projectRoot = ctx.toolContext.projectRoot || process.cwd();

      if (trimmed.toLowerCase() === 'view') {
        const spec = loadSpecContract(projectRoot);
        if (!spec) {
          console.log(pc.yellow('\n[SpecFirst] No active spec contract found at .daedalus/spec.json'));
          console.log(pc.gray('  Use /spec generate <goal> to create a new contract.'));
          return;
        }
        console.log(pc.cyan(`\n${formatSpecForPrompt(spec)}`));
        return;
      }

      let goal = trimmed;
      if (trimmed.toLowerCase().startsWith('generate ')) {
        goal = trimmed.substring(9).trim();
      }

      if (!goal) {
        console.log(pc.yellow('\nUsage: /spec [generate <goal> | view | <goal>]'));
        return;
      }

      console.log(pc.cyan(`\n[SpecFirst] Generating specification contract for: "${goal}"...`));
      const spec = await generateSpecContract(goal, ctx.router, projectRoot);
      console.log(pc.green(`✔ [SpecFirst] Spec contract created successfully!`));
      console.log(pc.gray(`  Interfaces: ${spec.interfaces.length} | Functions: ${spec.functions.length} | Test Cases: ${spec.testCases.length}`));
      console.log(pc.gray(`  Saved to .daedalus/spec.md & .daedalus/spec.json`));

      if (!trimmed.toLowerCase().startsWith('generate ')) {
        // Also run GitHub issue creation if desired
        await handleSpecCommand(goal, ctx);
      }
    }
  },
  {
    name: '/mcp',
    description: 'Manage MCP servers: explore, search, install, list, remove, info',
    usage: '/mcp <subcommand> [args]',
    helpText: 'Configure and interact with Model Context Protocol (MCP) servers.\n\nSubcommands:\n  explore, ex           Browse curated featured community MCP servers\n  list, l               List all installed MCP servers and their active state\n  search, s <query>     Search the public MCP Registry for available servers\n  install, i <name>     Install an MCP server from the registry\n  remove, rm <name>     Uninstall an MCP server\n  info <name>           Display metadata and information for a registry server\n  enable <name>         Enable a configured server\n  disable <name>        Disable a configured server without removing it',
    execute: async (args, _ctx) => {
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase();
      const rest = parts.slice(1).join(' ').trim();

      const { searchRegistry, fetchServerByName, fetchAllServers, registryEntryToConfig, addServerToConfig, removeServerFromConfig, listInstalledServers, toggleServer } = await import('../tools/mcp/manager.js');
      const { mcpRegistry } = await import('../tools/mcp/registry.js');

      switch (sub) {
        case 'search':
        case 's': {
          if (!rest) {
            console.log(pc.yellow('  Usage: /mcp search <query>'));
            return;
          }
          console.log(pc.dim(`  Searching registry for "${rest}"...`));
          try {
            const results = await searchRegistry(rest, 15);
            if (results.length === 0) {
              console.log(pc.yellow('  No servers found. Try a broader search.'));
              return;
            }
            console.log(`\n  ${pc.bold(`Found ${results.length} server(s):`)}`);
            for (const s of results) {
              const label = s.title || s.name;
              const desc = s.description.length > 80 ? s.description.slice(0, 80) + '…' : s.description;
              const remote = s.remotes?.[0]?.url || '';
              const pkg = s.packages?.[0]?.identifier || '';
              const source = remote || pkg || '(no install info)';
              const installType = s.packages ? 'stdio' : s.remotes ? 'http' : '?';
              console.log(`  ${pc.cyan(label)}`);
              console.log(`    ${pc.dim(desc)}`);
              console.log(`    ${pc.gray('Install:')} ${pc.dim(source)} (${installType})`);
              console.log();
            }
          } catch (err) {
            console.log(pc.red(`  Search failed: ${errMessage(err)}`));
          }
          return;
        }

        case 'install':
        case 'i': {
          if (!rest) {
            console.log(pc.yellow('  Usage: /mcp install <server-name>'));
            console.log(pc.dim('  First search for a server with: /mcp search <query>'));
            return;
          }
          console.log(pc.dim(`  Fetching "${rest}" from registry...`));
          try {
            const entry = await fetchServerByName(rest);
            if (!entry) {
              console.log(pc.yellow(`  Server "${rest}" not found in registry. Try /mcp search first.`));
              return;
            }
            const config = registryEntryToConfig(entry);
            if (!config) {
              console.log(pc.yellow(`  Cannot install "${rest}": no stdio package or remote URL found.`));
              return;
            }
            const result = addServerToConfig(config);
            if (result.success) {
              console.log(pc.green(`  ${result.message}`));
              console.log(pc.dim('  Restart Daedalus or reconnect to load the new server.'));
            } else {
              console.log(pc.yellow(`  ${result.message}`));
            }
          } catch (err) {
            console.log(pc.red(`  Install failed: ${errMessage(err)}`));
          }
          return;
        }

        case 'explore':
        case 'ex': {
          console.log(pc.dim('  Browsing the MCP registry...\n'));
          try {
            const all = await fetchAllServers(100);
            const local = all.filter(s => s.packages && s.packages.length > 0);
            const remote = all.filter(s => s.remotes && s.remotes.length > 0);
            console.log(`  ${pc.bold(`Found ${all.length} servers in registry`)}`);

            const showSample = (list: RegistryServerEntry[], label: string, max = 5) => {
              if (list.length === 0) return;
              console.log(`\n  ${pc.underline(label)} (${list.length} available)`);
              for (const s of list.slice(0, max)) {
                const pkg = s.packages?.[0]?.identifier || '';
                const url = s.remotes?.[0]?.url || '';
                const source = pkg || url;
                const info = s.description.length > 55 ? s.description.slice(0, 53) + '…' : s.description;
                const showName = s.name.length > 28 ? s.name.slice(0, 26) + '…' : s.name;
                console.log(`  ${pc.cyan(showName.padEnd(30))} ${pc.dim(info)}`);
                console.log(`  ${' '.repeat(30)}  ${pc.gray('→')} ${pc.dim(source)}`);
              }
              if (list.length > max) {
                console.log(`  ${' '.repeat(30)} ${pc.dim(`… and ${list.length - max} more`)}`);
              }
            };

            showSample(local, 'Local (stdio — install & run)', 6);
            showSample(remote, 'Remote (HTTP — cloud API)', 6);
            console.log(`\n  ${pc.dim('Tip: /mcp search <query> to find specific servers')}`);
          } catch (err) {
            console.log(pc.red(`  Explore failed: ${errMessage(err)}`));
          }
          return;
        }

        case 'list':
        case 'ls':
        case 'l': {
          const servers = listInstalledServers();
          if (servers.length === 0) {
            console.log(pc.yellow('  No MCP servers installed.'));
            console.log(pc.dim('  Try /mcp explore to see what\'s available.'));
            return;
          }
          const connected = mcpRegistry.getConnectedServers();
          console.log(`\n  ${pc.bold('Installed MCP Servers:')}`);
          for (const s of servers) {
            const status = connected.includes(s.name) ? pc.green('●') : s.enabled ? pc.yellow('○') : pc.red('○');
            const state = connected.includes(s.name) ? pc.green('connected')
              : s.enabled ? pc.yellow('pending')
              : pc.red('disabled');
            console.log(`  ${status} ${pc.cyan(s.name.padEnd(20))} ${pc.dim(s.transport.padEnd(6))} ${state}`);
          }
          console.log();
          return;
        }

        case 'remove':
        case 'rm':
        case 'r': {
          if (!rest) {
            console.log(pc.yellow('  Usage: /mcp remove <server-name>'));
            return;
          }
          const result = removeServerFromConfig(rest);
          if (result.success) {
            console.log(pc.green(`  ${result.message}`));
          } else {
            console.log(pc.yellow(`  ${result.message}`));
          }
          return;
        }

        case 'info': {
          if (!rest) {
            console.log(pc.yellow('  Usage: /mcp info <server-name>'));
            return;
          }
          try {
            console.log(pc.dim(`  Fetching "${rest}" from registry...`));
            const entry = await fetchServerByName(rest);
            if (!entry) {
              console.log(pc.yellow(`  Server "${rest}" not found.`));
              return;
            }
            console.log(`\n  ${pc.bold(entry.title || entry.name)}`);
            console.log(`  ${pc.dim(entry.description)}`);
            console.log(`  ${pc.gray('Name:')}    ${entry.name}`);
            console.log(`  ${pc.gray('Version:')} ${entry.version}`);
            if (entry.websiteUrl) console.log(`  ${pc.gray('Website:')} ${entry.websiteUrl}`);
            if (entry.repository?.url) console.log(`  ${pc.gray('Source:')}  ${entry.repository.url}`);

            if (entry.remotes && entry.remotes.length > 0) {
              console.log(`\n  ${pc.bold('Remote endpoints:')}`);
              for (const r of entry.remotes) {
                console.log(`    ${pc.cyan(r.type)} ${pc.dim(r.url)}`);
                if (r.headers) {
                  for (const h of r.headers) {
                    const req = h.isRequired ? pc.yellow(' (required)') : '';
                    const secret = h.isSecret ? pc.dim(' [secret]') : '';
                    console.log(`      ${pc.gray('Header:')} ${h.name}${req}${secret}`);
                  }
                }
              }
            }

            if (entry.packages && entry.packages.length > 0) {
              console.log(`\n  ${pc.bold('Packages:')}`);
              for (const p of entry.packages) {
                const [cmd, ...args] = p.registryType === 'npm' ? ['npx', '-y', p.identifier]
                  : p.registryType === 'pypi' ? ['uvx', p.identifier]
                  : [p.identifier];
                console.log(`    ${pc.cyan(p.registryType)} ${pc.dim(`${cmd} ${args.join(' ')}`)}`);
                if (p.environmentVariables) {
                  for (const env of p.environmentVariables) {
                    const req = env.isRequired ? pc.yellow(' (required)') : '';
                    const secret = env.isSecret ? pc.dim(' [secret]') : '';
                    console.log(`      ${pc.gray('Env:')} ${env.name}${req}${secret}`);
                    if (env.description) console.log(`      ${pc.dim(env.description)}`);
                  }
                }
              }
            }
            console.log();
          } catch (err) {
            console.log(pc.red(`  Info fetch failed: ${errMessage(err)}`));
          }
          return;
        }

        case 'reconnect':
        case 'rc': {
          const { loadConfig } = await import('../config/index.js');
          const config = loadConfig();
          const mcpConfigs = Object.entries(config.tools.mcpServers)
            .filter(([_, s]) => s.enabled)
            .map(([name, s]) => ({
              name,
              transport: s.transport,
              command: s.command,
              args: s.args,
              url: s.url,
              headers: s.headers,
              enabled: s.enabled,
            }));

          const already = mcpRegistry.getConnectedServers();
          const newServers = mcpConfigs.filter(c => !already.includes(c.name));

          if (newServers.length === 0) {
            if (mcpConfigs.length === 0) {
              console.log(pc.yellow('  No enabled MCP servers configured. Install one with /mcp install'));
            } else {
              console.log(pc.dim('  All enabled MCP servers are already connected.'));
            }
            return;
          }

          mcpRegistry.setConfigs(mcpConfigs);
          const connected: string[] = [];
          const failed: string[] = [];

          for (const s of newServers) {
            try {
              await mcpRegistry.connectServer(s);
              connected.push(s.name);
            } catch (err) {
              failed.push(`${s.name} (${errMessage(err)})`);
            }
          }

          if (connected.length > 0) {
            const totalTools = mcpRegistry.getToolDefinitions().length;
            console.log(pc.green(`  Connected: ${connected.join(', ')} (${totalTools} MCP tools total)`));
          }
          if (failed.length > 0) {
            console.log(pc.yellow(`  Failed: ${failed.join(', ')}`));
          }
          return;
        }

        case 'enable':
        case 'e': {
          if (!rest) {
            console.log(pc.yellow('  Usage: /mcp enable <server-name>'));
            return;
          }
          const enableResult = toggleServer(rest, true);
          console.log(enableResult.success ? pc.green(`  ${enableResult.message}`) : pc.yellow(`  ${enableResult.message}`));
          return;
        }

        case 'disable':
        case 'd': {
          if (!rest) {
            console.log(pc.yellow('  Usage: /mcp disable <server-name>'));
            return;
          }
          const disableResult = toggleServer(rest, false);
          console.log(disableResult.success ? pc.green(`  ${disableResult.message}`) : pc.yellow(`  ${disableResult.message}`));
          return;
        }

        default:
          console.log(pc.bold('\n  MCP Server Manager'));
          console.log(`  ${pc.cyan('/mcp explore')}           ${pc.dim('Browse available servers in the registry')}`);
           console.log(`  ${pc.cyan('/mcp search <query>')}    ${pc.dim('Search MCP registry + Smithery')}`);
          console.log(`  ${pc.cyan('/mcp install <name>')}   ${pc.dim('Install a server from the registry')}`);
          console.log(`  ${pc.cyan('/mcp list')}             ${pc.dim('List installed servers')}`);
          console.log(`  ${pc.cyan('/mcp remove <name>')}    ${pc.dim('Remove an installed server')}`);
          console.log(`  ${pc.cyan('/mcp info <name>')}      ${pc.dim('Show server details')}`);
          console.log(`  ${pc.cyan('/mcp reconnect')}        ${pc.dim('Reconnect all enabled servers')}`);
          console.log(`  ${pc.cyan('/mcp enable <name>')}    ${pc.dim('Enable a disabled server')}`);
          console.log(`  ${pc.cyan('/mcp disable <name>')}   ${pc.dim('Disable a server without removing it')}`);
           console.log(`\n  ${pc.bold('Popular npm MCP servers (add to ~/.daedalus/config.json):')}`);
           console.log(`  ${pc.dim('  "server-name": { "transport": "stdio", "command": "npx", "args": ["-y", "@npm/package"], "enabled": true }')}`);
           console.log(`  ${pc.gray('→')} ${pc.cyan('filesystem')}       ${pc.dim('npx -y @modelcontextprotocol/server-filesystem <allowed-dir>')}`);
           console.log(`  ${pc.gray('→')} ${pc.cyan('puppeteer')}        ${pc.dim('npx -y @modelcontextprotocol/server-puppeteer')}`);
           console.log(`  ${pc.gray('→')} ${pc.cyan('memory')}           ${pc.dim('npx -y @modelcontextprotocol/server-memory')}`);
           console.log(`  ${pc.gray('→')} ${pc.cyan('fetch')}            ${pc.dim('npx -y @modelcontextprotocol/server-fetch')}`);
           console.log(`  ${pc.gray('→')} ${pc.cyan('sequential-thinking')} ${pc.dim('npx -y @modelcontextprotocol/server-sequential-thinking')}`);
           console.log(`  ${pc.gray('→')} ${pc.cyan('github')}           ${pc.dim('npx -y @github/github-mcp-server')}`);
           console.log(`  ${pc.gray('→')} ${pc.cyan('sqlite')}           ${pc.dim('npx -y @modelcontextprotocol/server-sqlite <db-path>')}`);
           console.log(`  ${pc.dim('  Then run /mcp reconnect to load them.')}`);
           console.log();
      }
    }
  },
  {
    name: '/onboard',
    description: 'First-time setup — discover local models, configure, and test',
    usage: '/onboard',
    helpText: 'Run the interactive setup wizard to scan your local network/environment for model servers, select a primary model tier, and test its output/diagnostics.',
    execute: async (_args, ctx) => {
      const config = ctx.config;

      console.log(pc.bold(pc.cyan('\n╔══════════════════════════════════════╗')));
      console.log(pc.bold(pc.cyan('║        Daedalus Onboarding          ║')));
      console.log(pc.bold(pc.cyan('╚══════════════════════════════════════╝')));
      console.log();
      console.log('Daedalus runs AI models locally on your machine.');
      console.log('First, I need to know which model server to use.');
      console.log();

      // Step 1: Discover local model servers
      console.log(pc.bold('🔍 Scanning for local model servers...'));
      const discovered = await discoverLocalServers();

      let chosenEndpoint = '';
      let chosenModel = '';

      if (discovered.length > 0) {
        console.log(pc.green(`\n  Found ${discovered.length} running server(s):\n`));
        for (let i = 0; i < discovered.length; i++) {
          const s = discovered[i];
          console.log(`  ${i + 1}. ${pc.cyan(s.name)} at ${s.endpoint}`);
          for (const m of s.models.slice(0, 3)) {
            console.log(`     - ${m}`);
          }
          if (s.models.length > 3) {
            console.log(pc.gray(`     ... and ${s.models.length - 3} more`));
          }
        }

        console.log();
        const serverChoice = await ctx.askLine(`Select a server (1-${discovered.length}) or press Enter to add manually: `);
        const idx = parseInt(serverChoice) - 1;
        if (idx >= 0 && idx < discovered.length) {
          const server = discovered[idx];
          chosenEndpoint = server.endpoint;
          if (server.models.length === 1) {
            chosenModel = server.models[0];
          } else {
            console.log(`\nModels on ${pc.cyan(server.name)}:`);
            for (let i = 0; i < server.models.length; i++) {
              console.log(`  ${i + 1}. ${server.models[i]}`);
            }
            const modelChoice = await ctx.askLine(`Select a model (1-${server.models.length}): `);
            const midx = parseInt(modelChoice) - 1;
            if (midx >= 0 && midx < server.models.length) {
              chosenModel = server.models[midx];
            }
          }
        }
      }

      if (!chosenEndpoint) {
        console.log(`\nEnter your model server details manually.`);
        chosenEndpoint = await ctx.askLine('API endpoint (e.g. http://localhost:1234/v1): ');
        if (!chosenEndpoint) chosenEndpoint = 'http://localhost:1234/v1';
        chosenModel = await ctx.askLine('Model name (e.g. qwen2.5-coder-7b-instruct): ');
        if (!chosenModel) chosenModel = 'auto';
      }

      if (!chosenModel) chosenModel = 'auto';

      // Step 2: Add to config
      const entry = {
        name: chosenModel,
        endpoint: chosenEndpoint,
        model: chosenModel,
        priority: 1,
        enabled: true,
      };

      // Replace any existing chain or add to it
      config.router.chain = [entry, ...config.router.chain.filter((e: ModelEntry) => e.endpoint !== chosenEndpoint)];
      saveConfig(config);

      console.log(pc.green(`\n✓ Added model "${pc.bold(chosenModel)}" at ${chosenEndpoint}`));

      // Step 3: Test the model
      const testPrompt = await ctx.askLine('\nRun a quick test? (Y/n): ');
      if (testPrompt.toLowerCase() !== 'n') {
        console.log(pc.dim('\nSending test request...'));
        try {
          const start = Date.now();
          const testMessages: ChatMessage[] = [
            { role: 'system', content: 'You are a helpful assistant. Respond in 1-2 sentences.' },
            { role: 'user', content: 'Say hello and confirm you are working.' },
          ];
          const testRouter = ctx.router;
          const completion = await testRouter.chat.completions.create({
            model: chosenModel,
            messages: testMessages,
            temperature: 0.1,
          });
          const elapsed = Date.now() - start;
          const text = messageText(completion.choices?.[0]?.message?.content ?? '') || '(no response)';
          console.log(pc.green(`\n✓ Response received in ${elapsed}ms:`));
          console.log(`  ${pc.white(text)}`);
        } catch (err) {
          console.log(pc.yellow(`\n⚠ Test failed: ${errMessage(err)}`));
          console.log('  The model is configured but may need troubleshooting.');
          console.log(`  Check ${pc.cyan(ctx.configDir + '/config.json')} and verify the endpoint.`);
        }
      }

      console.log(pc.green(`\n✓ Onboarding complete! Configuration saved to:`));
      console.log(`  ${pc.cyan(ctx.configDir + '/config.json')}`);
      console.log(`\nType ${pc.cyan('?')} to see all available commands, or just start typing.`);
    }
  },
  {
    name: '/tui',
    description: 'Toggle the Terminal User Interface (TUI) dashboard',
    usage: '/tui',
    helpText: 'Switch between standard REPL chat mode and the side-by-side Terminal dashboard mode (which includes resource charts, model settings, and context monitors).',
    execute: async (args, ctx) => {
      if (!ctx.rl) {
        throw new Error('SWITCH_MODE_CLI');
      } else {
        throw new Error('SWITCH_MODE_TUI');
      }
    }
  },
  {
    name: '/image',
    description: 'Generate an image using local Stable Diffusion WebUI or Pollinations AI',
    usage: '/image <prompt> [--output path] [--provider auto|sd-webui|pollinations] [--width 512] [--height 512] [--steps 20]',
    helpText: 'Generate an image using a local Stable Diffusion WebUI instance (http://127.0.0.1:7860) or free Pollinations AI.\n\nArguments:\n  <prompt>                      Detailed description of the image to generate\n  --provider <engine>           Engine: auto (local SD with Pollinations fallback), sd-webui, or pollinations\n  --output <path>              Filepath to save PNG (default: ./assets/images/img_<timestamp>.png)\n  --width <pixels>             Image width (default: 512)\n  --height <pixels>            Image height (default: 512)\n  --steps <count>              Sampling steps for local SD (default: 20)',
    execute: async (args, _ctx) => {
      const promptText = args.trim();
      if (!promptText) {
        console.log(pc.yellow('Usage: /image <prompt> [--provider auto|sd-webui|pollinations] [--output path] [--width 512] [--height 512] [--steps 20]'));
        return;
      }

      console.log(pc.cyan(`\n Generating image...`));
      const { generateImage } = await import('../tools/builtin/image.js');

      let width: number | undefined;
      let height: number | undefined;
      let steps: number | undefined;
      let provider: 'auto' | 'sd-webui' | 'pollinations' | undefined;
      let output_path: string | undefined;

      const cleanedPrompt = promptText
        .replace(/--provider\s+([^\s]+)/i, (_, pr) => {
          if (['auto', 'sd-webui', 'pollinations'].includes(pr.toLowerCase())) {
            provider = pr.toLowerCase() as 'auto' | 'sd-webui' | 'pollinations';
          }
          return '';
        })
        .replace(/--output\s+([^\s]+)/i, (_, p) => { output_path = p; return ''; })
        .replace(/--width\s+(\d+)/i, (_, w) => { width = parseInt(w, 10); return ''; })
        .replace(/--height\s+(\d+)/i, (_, h) => { height = parseInt(h, 10); return ''; })
        .replace(/--steps\s+(\d+)/i, (_, s) => { steps = parseInt(s, 10); return ''; })
        .trim();

      const res = await generateImage({
        prompt: cleanedPrompt || promptText,
        width,
        height,
        steps,
        provider,
        output_path,
      });

      if (res.success) {
        console.log(pc.green(`\n✔ ${res.content}`));
      } else {
        console.log(pc.red(`\n✗ Image generation failed: ${res.error}`));
      }
    }
  },
  {
    name: '/autopilot',
    description: 'Autonomously implement a feature: branch, code, test, commit, and PR',
    usage: '/autopilot <feature description>',
    helpText: 'End-to-end autonomous feature development. Creates a branch, plans and implements the feature, runs verification, commits, pushes, and opens a pull request.\n\nFlow:\n  1. Interactive Q&A to refine the feature spec\n  2. Creates a git branch (daedalus-autopilot-<slug>)\n  3. Runs the multi-agent orchestrator to implement it\n  4. Verifies with build/lint/tests\n  5. Commits and pushes to GitHub\n  6. Opens a Pull Request against main\n\nRequires a GitHub repository with a configured remote origin.',
    execute: async (args, ctx) => {
      const idea = args.trim();
      if (!idea) {
        console.log(pc.red('[WARN] Usage: /autopilot <feature description>'));
        return;
      }

      let isGitRepo = true;
      try {
        execSync('git rev-parse --is-inside-work-tree', { cwd: ctx.toolContext.projectRoot, stdio: 'ignore' });
      } catch {
        isGitRepo = false;
      }

      if (!isGitRepo) {
        console.log(pc.cyan('[INFO] Non-git directory detected. Auto-initializing Git repository for autonomous branch safety...'));
        try {
          const cwd = ctx.toolContext.projectRoot || process.cwd();
          execSync('git init', { cwd });
          const gitIgnorePath = path.join(cwd, '.gitignore');
          if (!fs.existsSync(gitIgnorePath)) {
            fs.writeFileSync(gitIgnorePath, "node_modules/\ndist/\n.daedalus/\n", 'utf8');
          }
          safeGitAdd(cwd);
          execSync('git commit -m "initial clean setup"', { cwd });
          isGitRepo = true;
          console.log(pc.green('[OK] Git repository initialized with tracking branch support.'));
        } catch {
          console.log(pc.yellow('[WARNING] Working directory is not a git repository. Autonomous changes will NOT be tracked in a git branch.'));
        }
      }

      const repoInfo = isGitRepo ? getGitRepoInfo(ctx.toolContext.projectRoot) : null;
      if (!repoInfo) {
        console.log(pc.yellow('[INFO] No GitHub remote found. Running in local-only mode (no PR will be created).'));
      }

      const slug = idea.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      const branchName = `daedalus-autopilot-${slug}`;

      if (isGitRepo) {
        try {
          execSync(`git checkout -B ${branchName}`, { cwd: ctx.toolContext.projectRoot });
          console.log(pc.green(`[OK] Created branch: ${branchName}`));
        } catch (err: unknown) {
          const msg = err instanceof Error ? errMessage(err) : String(err);
          console.log(pc.red(`[ERROR] Failed to create branch: ${msg}`));
          return;
        }
      }

      const goal = `Implement the following feature: ${idea}`;

      console.log(pc.cyan(`\n[AUTOPILOT] Starting autonomous implementation...`));
      process.env.DAEDALUS_AUTO_APPROVE = 'true';
      process.env.DAEDALUS_ALLOW_INSTALL = 'true';

      try {
        const { Orchestrator } = await import('../agents/orchestrator.js');
        const orchestrator = new Orchestrator(ctx.router, ctx.messages, ctx.toolContext, ctx.sessionManager, ctx.config?.modelOverride);
        const result = await orchestrator.run(goal);
        console.log(pc.white(`\n${result}`));

        const orchestrationFailed = result.startsWith('Orchestration failed') || result.includes('## Orchestration Hit Verification Failures');
        const wasAborted = result.includes('## Orchestration Paused');
        if (orchestrationFailed || wasAborted) {
          // Print Self-Evaluating Autopilot Post-Mortem Report before rolling back
          const cols = process.stdout.columns || 80;
          const lineLen = Math.max(20, Math.min(70, cols - 6));
          console.log(`\n  ${pc.bold(pc.red('─ Autopilot Post-Mortem ─'))} ${pc.dim('─'.repeat(Math.max(10, lineLen - 25)))}`);

          const failed = orchestrator.results?.filter((r: AgentResult) => !r.success) || [];
          if (failed.length > 0) {
            failed.forEach((f: AgentResult, idx: number) => {
              console.log(`  ${pc.bold(pc.red(`❌ Failed Step ${idx + 1}:`))} ${pc.bold(`[${f.role}]`)} ${f.goal}`);
              console.log(`     ${pc.yellow(`📌 Diagnostic:`)} ${f.summary.split('\n')[0]}`);
            });
          } else {
            console.log(`  ${pc.yellow('❌ Verification check failed — required files failed artifact or build checks.')}`);
          }

          console.log(`\n  ${pc.cyan('💡 Recommendations:')}`);
          console.log(`     - Target missing file: ${pc.bold(`/task create <file>`)}`);
          console.log(`     - Re-run autopilot:   ${pc.bold(`/autopilot ${idea}`)}`);
          console.log(`  ${pc.dim('─'.repeat(lineLen + 2))}\n`);

          throw new Error(orchestrationFailed ? 'Orchestration reported failure' : 'Orchestration was paused/aborted');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? errMessage(err) : String(err);
        console.log(pc.red(`\n[ERROR] Implementation failed: ${msg}`));
        if (isGitRepo) {
          console.log(pc.yellow('[ROLLBACK] Implementation did not pass verification.'));
          // In remote-backed repos, discard the failed branch to keep main clean.
          // In local-only mode (no remote), keep the branch so the user can
          // inspect and fix the work instead of losing it.
          if (repoInfo) {
            try {
              execSync('git reset --hard', { cwd: ctx.toolContext.projectRoot });
              execSync('git checkout main', { cwd: ctx.toolContext.projectRoot });
              execSync(`git branch -D ${branchName}`, { cwd: ctx.toolContext.projectRoot });
              console.log(pc.green('[OK] Rolled back to main. Branch deleted.'));
            } catch (rollbackErr: unknown) {
              const rbMsg = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
              console.log(pc.red(`[ERROR] Rollback failed: ${rbMsg}. Manual cleanup may be needed.`));
            }
          } else {
            console.log(pc.cyan(`[INFO] Local-only mode: keeping branch '${branchName}' with the implemented changes for inspection. Fix and commit manually.`));
          }
        }
        return;
      }

      if (isGitRepo) {
        console.log(pc.cyan('\n[AUTOPILOT] Verifying build & tests before commit...'));
        const verify = await runAutopilotVerify(ctx.toolContext.projectRoot);
        if (!verify.ok) {
          console.log(pc.red(`\n[ERROR] Verification failed — not committing. ${verify.detail}`));
          console.log(pc.cyan(`[INFO] Branch '${branchName}' is kept with the implemented changes for inspection.`));
          return;
        }
        console.log(pc.green('[OK] Build & tests passed.'));

        console.log(pc.cyan('\n[AUTOPILOT] Committing changes...'));
        try {
          safeGitAdd(ctx.toolContext.projectRoot);
          const cleanTitle = idea.replace(/[^a-zA-Z0-9 ]/g, '').trim();
          execSync(`git commit -m "feat: ${cleanTitle}"`, { cwd: ctx.toolContext.projectRoot });
          console.log(pc.green('[OK] Changes committed.'));
        } catch (err: unknown) {
          const msg = err instanceof Error ? errMessage(err) : String(err);
          if (msg.includes('nothing to commit')) {
            console.log(pc.yellow('[INFO] No changes to commit.'));
          } else {
            console.log(pc.red(`[ERROR] Failed to commit: ${msg}`));
            return;
          }
        }
      } else {
        console.log(pc.yellow('\n[INFO] Non-git working directory. Autonomous implementation completed directly on files.'));
      }

      if (repoInfo) {
        console.log(pc.cyan('\n[AUTOPILOT] Pushing branch and creating PR...'));
        let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
        if (!token) {
          try {
            token = execSync('gh auth token', { encoding: 'utf8' }).trim();
          } catch {
            console.log(pc.yellow('[INFO] No GitHub token found. Run `gh auth login` or set GITHUB_TOKEN.'));
            console.log(pc.yellow(`[INFO] Branch ${branchName} is ready locally. Push manually.`));
            return;
          }
        }

        try {
          execSync(`git push -u origin ${branchName} --force`, { cwd: ctx.toolContext.projectRoot });

          const prResponse = await fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              title: `[Autopilot] ${idea}`,
              head: branchName,
              base: 'main',
              body: `## Description\n\nAutonomously implemented by Daedalus Autopilot.\n\n**Feature:** ${idea}\n\n---\n_Generated by \`/autopilot\`_`,
            }),
          });

          if (prResponse.ok) {
            const pr = await prResponse.json() as { html_url: string };
            console.log(pc.green(`\n[OK] Pull Request created: ${pr.html_url}`));
          } else {
            const errText = await prResponse.text();
            console.log(pc.red(`[ERROR] Failed to create PR: ${prResponse.status} ${errText}`));
            console.log(pc.yellow(`[INFO] Branch ${branchName} is pushed. Create PR manually.`));
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? errMessage(err) : String(err);
          console.log(pc.red(`[ERROR] Push/PR failed: ${msg}`));
          console.log(pc.yellow(`[INFO] Branch ${branchName} is ready locally.`));
        }
      } else {
        console.log(pc.yellow('\n[INFO] No GitHub remote configured. Implementation is committed locally.'));
        console.log(pc.yellow(`[INFO] Branch: ${branchName}`));
      }

      console.log(pc.cyan(`\n[AUTOPILOT] Done! Run 'git checkout main' to return to main branch.`));
    }
  },
  {
    name: '/hunt',
    aliases: ['/bug'],
    description: 'Autonomously hunt down and fix a bug: reproduce, locate root cause, fix, verify',
    usage: '/hunt <failing-test-filepath> or <bug description>',
    helpText: 'End-to-end autonomous bug fixing. If given a test file path, runs it to capture the failure, searches the codebase for root cause, implements a fix, verifies the test passes, commits, pushes, and opens a pull request.\n\nFlow:\n  1. (Optional) Runs the failing test to capture error output\n  2. Creates a git branch (daedalus-hunt-<slug>)\n  3. Runs the multi-agent orchestrator to find and fix the bug\n  4. Re-runs the test to confirm the fix\n  5. Commits and pushes to GitHub\n  6. Opens a Pull Request against main\n\nProvide a test file path to enable automated reproduction and verification.',
    execute: async (args, ctx) => {
      const input = args.trim();
      if (!input) {
        console.log(pc.red('[WARN] Usage: /hunt <failing-test-filepath> or <bug description>'));
        return;
      }

      const repoInfo = getGitRepoInfo(ctx.toolContext.projectRoot);
      if (!repoInfo) {
        console.log(pc.yellow('[INFO] No GitHub remote found. Running in local-only mode (no PR will be created).'));
      }

      const slug = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      const branchName = `daedalus-hunt-${slug}`;

      const testFilePattern = /\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/i;
      const isTestFile = testFilePattern.test(input.trim());

      // Step 1: If input is a test file, run it to capture failure output
      let testFailureOutput = '';
      if (isTestFile) {
        const testPath = input.trim();
        console.log(pc.cyan(`\n[HUNT] Reproducing failure from: ${testPath}`));
        try {
          const { execute: termExec } = await import('../tools/builtin/terminal.js');
          const testResult = await termExec({ command: `npx vitest run ${testPath} --reporter=verbose`, timeout: 120, workdir: process.cwd() }, ctx.toolContext);
          if (testResult.success) {
            console.log(pc.yellow(`\n[HUNT] Test passed — no bug to fix. Running on main branch only.`));
            return;
          }
          testFailureOutput = testResult.content || '';
          const errorLines = testFailureOutput.split('\n').filter(l => l.includes('FAIL') || l.includes('AssertionError') || l.includes('Error:') || l.includes('×')).slice(0, 20).join('\n');
          console.log(pc.red(`\n[HUNT] Failure reproduced:\n${errorLines.slice(0, 1000)}`));
        } catch (err: unknown) {
          const msg = err instanceof Error ? errMessage(err) : String(err);
          console.log(pc.yellow(`[HUNT] Could not run test: ${msg}. Continuing with description only.`));
        }
      }

      // Step 2: Create branch
      try {
        execSync(`git checkout -B ${branchName}`, { cwd: ctx.toolContext.projectRoot });
        console.log(pc.green(`[OK] Created branch: ${branchName}`));
      } catch (err: unknown) {
        const msg = err instanceof Error ? errMessage(err) : String(err);
        console.log(pc.red(`[ERROR] Failed to create branch: ${msg}`));
        return;
      }

      // Step 3: Build goal for orchestrator
      const testContext = testFailureOutput ? `\n\nTest failure output:\n\`\`\`\n${testFailureOutput.slice(0, 4000)}\n\`\`\`` : '';
      const goal = `Fix the following bug:\n${input}${testContext}\n\nFind the root cause, fix it, and ensure existing tests still pass.`;

      console.log(pc.cyan(`\n[HUNT] Starting autonomous bug hunt...`));
      process.env.DAEDALUS_AUTO_APPROVE = 'true';

      let orchestratorResult = '';
      try {
        const { Orchestrator } = await import('../agents/orchestrator.js');
        const orchestrator = new Orchestrator(ctx.router, ctx.messages, ctx.toolContext, ctx.sessionManager, ctx.config?.modelOverride);
        orchestratorResult = await orchestrator.run(goal);
        console.log(pc.white(`\n${orchestratorResult}`));

        const orchestrationFailed = orchestratorResult.startsWith('Orchestration failed') || orchestratorResult.includes('## Orchestration Hit Verification Failures');
        const wasAborted = orchestratorResult.includes('## Orchestration Paused');
        if (orchestrationFailed || wasAborted) {
          throw new Error(orchestrationFailed ? 'Orchestration reported failure' : 'Orchestration was paused/aborted');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? errMessage(err) : String(err);
        console.log(pc.red(`\n[ERROR] Bug hunt failed: ${msg}`));
        console.log(pc.yellow('[ROLLBACK] Rolling back to main branch...'));
        try {
          execSync('git reset --hard', { cwd: ctx.toolContext.projectRoot });
          execSync('git checkout main', { cwd: ctx.toolContext.projectRoot });
          execSync(`git branch -D ${branchName}`, { cwd: ctx.toolContext.projectRoot });
          console.log(pc.green('[OK] Rolled back to main. Branch deleted.'));
        } catch (rollbackErr: unknown) {
          const rbMsg = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
          console.log(pc.red(`[ERROR] Rollback failed: ${rbMsg}. Manual cleanup may be needed.`));
        }
        return;
      }

      // Step 4: Verify fix by re-running the test
      if (isTestFile && testFailureOutput) {
        console.log(pc.cyan('\n[HUNT] Verifying fix...'));
        try {
          const { execute: termExec } = await import('../tools/builtin/terminal.js');
          const verifyResult = await termExec({ command: `npx vitest run ${input.trim()} --reporter=verbose`, timeout: 120, workdir: process.cwd() }, ctx.toolContext);
          if (verifyResult.success) {
            console.log(pc.green(`\n[HUNT] ✓ Fix verified — test passes.`));
          } else {
            console.log(pc.yellow(`\n[HUNT] ⚠ Fix verification failed. Test still failing. Continuing to commit partial fix.`));
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? errMessage(err) : String(err);
          console.log(pc.yellow(`[HUNT] Verification skipped: ${msg}`));
        }
      }

      // Step 5: Commit
      console.log(pc.cyan('\n[HUNT] Committing changes...'));
      try {
        execSync('git add .', { cwd: ctx.toolContext.projectRoot });
        const cleanTitle = input.replace(/[^a-zA-Z0-9 ]/g, '').trim();
        execSync(`git commit -m "fix: ${cleanTitle}"`, { cwd: ctx.toolContext.projectRoot });
        console.log(pc.green('[OK] Changes committed.'));
      } catch (err: unknown) {
        const msg = err instanceof Error ? errMessage(err) : String(err);
        if (msg.includes('nothing to commit')) {
          console.log(pc.yellow('[INFO] No changes to commit.'));
        } else {
          console.log(pc.red(`[ERROR] Failed to commit: ${msg}`));
          return;
        }
      }

      // Step 6: Push and PR
      if (repoInfo) {
        console.log(pc.cyan('\n[HUNT] Pushing branch and creating PR...'));
        let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
        if (!token) {
          try {
            token = execSync('gh auth token', { encoding: 'utf8' }).trim();
          } catch {
            console.log(pc.yellow('[INFO] No GitHub token found. Run `gh auth login` or set GITHUB_TOKEN.'));
            console.log(pc.yellow(`[INFO] Branch ${branchName} is ready locally. Push manually.`));
            return;
          }
        }

        try {
          execSync(`git push -u origin ${branchName} --force`, { cwd: ctx.toolContext.projectRoot });
          const hasSummary = orchestratorResult && !orchestratorResult.startsWith('Orchestration failed');
          const prBody = `## Description\n\nAutonomously fixed by Daedalus Hunt.\n\n**Bug:** ${input}\n${testFailureOutput ? `\n**Failure reproduced:**\n\`\`\`\n${testFailureOutput.slice(0, 1500)}\n\`\`\`\n` : ''}${hasSummary ? `\n**Summary:**\n${orchestratorResult.slice(0, 2000)}` : ''}\n\n---\n_Generated by \`/hunt\`_`;

          const prResponse = await fetch(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              title: `[Hunt] ${input}`,
              head: branchName,
              base: 'main',
              body: prBody,
            }),
          });

          if (prResponse.ok) {
            const pr = await prResponse.json() as { html_url: string };
            console.log(pc.green(`\n[OK] Pull Request created: ${pr.html_url}`));
          } else {
            const errText = await prResponse.text();
            console.log(pc.red(`[ERROR] Failed to create PR: ${prResponse.status} ${errText}`));
            console.log(pc.yellow(`[INFO] Branch ${branchName} is pushed. Create PR manually.`));
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? errMessage(err) : String(err);
          console.log(pc.red(`[ERROR] Push/PR failed: ${msg}`));
          console.log(pc.yellow(`[INFO] Branch ${branchName} is ready locally.`));
        }
      } else {
        console.log(pc.yellow('\n[INFO] No GitHub remote configured. Fix is committed locally.'));
        console.log(pc.yellow(`[INFO] Branch: ${branchName}`));
      }

      console.log(pc.cyan(`\n[HUNT] Done! Run 'git checkout main' to return to main branch.`));
    }
  },
  {
    name: '/preview',
    description: 'Screenshot a local HTML file or URL and save the image',
    usage: '/preview <filepath | url>',
    helpText: 'Opens the given HTML file or URL in headless Chrome and saves a PNG screenshot.\n  Examples:\n    /preview preview.html\n    /preview http://localhost:3000\n    /preview ./src/components/output.html',
    execute: async (args, ctx) => {
      const target = args.trim();
      if (!target) {
        console.log(pc.red('[WARN] Usage: /preview <filepath or URL>'));
        return;
      }

      let url = target;
      if (!/^https?:\/\//i.test(target) && !/^file:\/\//i.test(target)) {
        const absPath = path.resolve(target);
        if (!fs.existsSync(absPath)) {
          console.log(pc.red(`[ERROR] File not found: ${absPath}`));
          return;
        }
        url = `file:///${absPath.replace(/\\/g, '/')}`;
      }

      console.log(pc.dim(`[PREVIEW] Screenshotting ${url}...`));

      try {
        const { screenshotPage } = await import('../tools/builtin/screenshot.js');
        const result = await screenshotPage({ url }, ctx.toolContext);
        if (!result.success) {
          console.log(pc.red(`[ERROR] ${result.error || 'Screenshot failed'}`));
          return;
        }
        const data = JSON.parse(result.content);
        console.log(pc.green(`[OK] Screenshot saved to: ${data.savedPath}`));
        console.log(pc.dim(`     URL: ${data.url}`));
      } catch (err: unknown) {
        const msg = err instanceof Error ? errMessage(err) : String(err);
        console.log(pc.red(`[ERROR] Preview failed: ${msg}`));
      }
    }
  },
  {
    name: '/sigma',
    aliases: ['/memory'],
    description: 'Inspect active Σ-Mem (Sigma-Memory) knowledge items & scores',
    usage: '/sigma [min_score]  OR  /memory [min_score]',
    helpText: 'Displays active reliability-scored multi-agent team memory items from SQLite.\n  Example: /sigma 0.5',
    execute: async (args, ctx) => {
      const minScore = parseFloat(args.trim()) || 0.50;
      if (!ctx.sessionManager?.sessionDb) {
        console.log(pc.yellow('\n  [INFO] No active session database. Start a session or run /autopilot first.\n'));
        return;
      }

      const { getSigmaMemories } = await import('../session/sqlite.js');
      const memories = getSigmaMemories(ctx.sessionManager.sessionDb, minScore, 20);

      console.log(pc.bold(`\n=== 🧠 Σ-MEM (RELIABILITY-SCORED AGENT KNOWLEDGE) ===`));
      if (memories.length === 0) {
        console.log(pc.dim(`  No active memories found with Σ-Score >= ${(minScore * 100).toFixed(0)}%.`));
        console.log(pc.bold('===================================================\n'));
        return;
      }

      for (const m of memories) {
        const scorePct = (m.sigma_score * 100).toFixed(0);
        const scoreColor = m.sigma_score >= 0.8 ? pc.green : m.sigma_score >= 0.6 ? pc.cyan : pc.yellow;
        console.log(`  ${scoreColor(`[Σ-Score: ${scorePct}%]`)} ${pc.bold(`[${m.agent_role.toUpperCase()}]`)} ${m.summary}`);
        console.log(pc.dim(`    Used: ${m.usefulness_count} | Decays: ${m.decay_count} | Content: ${m.content.slice(0, 100)}...`));
        console.log();
      }
      console.log(pc.bold('===================================================\n'));
    }
  },
]
