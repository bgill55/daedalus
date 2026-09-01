// Agent orchestration, MCP, setup & utility commands
import fs from 'fs';
import path from 'path';
import pc from 'picocolors';

import { executeToolCalls } from '../tools/executor.js';
import { spawnBackgroundAgent } from '../agents/background.js';
import { handleSpecCommand } from '../agents/loop.js';
import { generateSpecContract, loadSpecContract, formatSpecForPrompt } from '../agents/spec.js';
import { roleLabel } from '../agents/roles.js';
import { turnSeparator } from '../formatting.js';
import type { AgentResult, DelegationTask } from '../agents/orchestrator-types.js';
import { errMessage } from '../utils/errors.js';
import type { ToolCall } from '../types.js';
import type { Command } from './types.js';

import {
  autopilotCommand,
  normalizeAutopilotIdea,
  runAutopilotVerify,
  writeAutopilotManifest,
  type AutopilotManifest,
} from './autopilot.js';
import { mcpCommand } from './mcp.js';
import { huntCommand } from './hunt.js';
import { onboardCommand } from './onboard.js';

export {
  normalizeAutopilotIdea,
  runAutopilotVerify,
  writeAutopilotManifest,
  autopilotCommand,
  mcpCommand,
  huntCommand,
  onboardCommand,
};
export type { AutopilotManifest };

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
        console.log(pc.yellow('[WARN] Usage: /spawn [--bg] <role> <task>  OR  /delegate [--bg] <task> to <role>'));
        console.log(pc.gray(`  Roles: ${validRoles.join(', ')}`));
        return;
      }

      if (!validRoles.includes(role)) {
        console.log(pc.yellow(`[WARN] Unknown role: ${role}. Valid: ${validRoles.join(', ')}`));
        return;
      }

      const context = `Active files: ${Array.from(ctx.activeFiles.values()).join(', ') || 'none'}`;

      if (isBackground) {
        console.log(pc.cyan(`\n[SPAWN] Spawning ${roleLabel(role)} agent in background for: ${task.slice(0, 80)}...`));
        const id = spawnBackgroundAgent(role, task, context, ctx.toolContext);
        console.log(pc.green(`[OK] Spawned background task #${id} (${roleLabel(role)}) successfully.`));
        console.log(pc.gray(`  Check status via /tasks, view logs/results via /task ${id}, or cancel via /task kill ${id}`));
        return;
      }

      console.log(pc.cyan(`\n[SPAWN] Spawning ${roleLabel(role)} agent for: ${task.slice(0, 80)}...`));

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
        console.log(pc.yellow('[WARN] Usage: /task <id>  OR  /task kill <id>'));
        return;
      }

      if (trimmed.startsWith('kill ')) {
        const idStr = trimmed.substring(5).trim();
        const id = parseInt(idStr, 10);
        if (isNaN(id)) {
          console.log(pc.yellow(`[WARN] Invalid task ID: ${idStr}`));
          return;
        }
        const killed = killBackgroundAgent(id);
        if (killed) {
          console.log(pc.green(`[OK] Task #${id} cancelled.`));
        } else {
          console.log(pc.yellow(`[WARN] Task #${id} is not running or not found.`));
        }
        return;
      }

      const id = parseInt(trimmed, 10);
      if (isNaN(id)) {
        console.log(pc.yellow('[WARN] Usage: /task <id>  OR  /task kill <id>'));
        return;
      }

      const job = backgroundJobs.get(id);
      if (!job) {
        console.log(pc.yellow(`[WARN] Task #${id} not found.`));
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
        console.log(pc.yellow('[WARN] Usage: /orchestrate <goal>'));
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
    helpText: 'Run the ensemble drafting pipeline: multiple models draft in parallel and a synthesizer merges the best parts.',
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
        await handleSpecCommand(goal, ctx);
      }
    }
  },
  mcpCommand,
  onboardCommand,
  {
    name: '/tui',
    description: 'Toggle the Terminal User Interface (TUI) dashboard',
    usage: '/tui',
    helpText: 'Switch between standard REPL chat mode and the side-by-side Terminal dashboard mode (which includes resource charts, model settings, and context monitors).',
    execute: async (_args, ctx) => {
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
  autopilotCommand,
  huntCommand,
  {
    name: '/preview',
    description: 'Screenshot a local HTML file or URL and save the image',
    usage: '/preview <filepath | url>',
    helpText: 'Opens the given HTML file or URL in headless Chrome and saves a PNG screenshot.\n  Examples:\n    /preview preview.html\n    /preview http://localhost:3000\n    /preview ./src/components/output.html',
    execute: async (args, ctx) => {
      const target = args.trim();
      if (!target) {
        console.log(pc.yellow('[WARN] Usage: /preview <filepath or URL>'));
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
      if (!ctx.sessionManager?.projectMemDb) {
        console.log(pc.yellow('\n  [INFO] No active project memory database. Start a session first.\n'));
        return;
      }

      const { getSigmaMemories } = await import('../session/sqlite.js');
      const memories = getSigmaMemories(ctx.sessionManager.projectMemDb, minScore, 20);

      console.log(pc.bold(`\n=== 🧠 Σ-MEM (RELIABILITY-SCORED AGENT KNOWLEDGE) ===`));
      if (memories.length === 0) {
        console.log(pc.dim(`  No active memories found with Σ-Score >= ${(minScore * 100).toFixed(0)}%.`));
        console.log(pc.bold('===================================================\n'));
        return;
      }

      for (const m of memories) {
        const scorePct = (m.sigma_score * 100).toFixed(0);
        const scoreColor = m.sigma_score >= 0.8 ? pc.green : m.sigma_score >= 0.6 ? pc.cyan : pc.yellow;
        console.log(`  ${scoreColor(`[Σ-Score: ${scorePct}%]`)} ${pc.bold(`[${roleLabel(m.agent_role).toUpperCase()}]`)} ${m.summary}`);
        const verified = m.verified_pass + m.verified_fail > 0
          ? ` | Verified: ${m.verified_pass}✓/${m.verified_fail}✗`
          : '';
        console.log(pc.dim(`    Used: ${m.usefulness_count} | Decays: ${m.decay_count}${verified} | Content: ${m.content.slice(0, 100)}...`));
        if (m.critique && m.critique.trim()) {
          console.log(pc.dim(`    ${pc.yellow('AVOID critique:')} ${m.critique.trim().slice(0, 160)}`));
        }
        console.log();
      }
      console.log(pc.bold('===================================================\n'));
    }
  },
];
