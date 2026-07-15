// Command Registry and Router for Daedalus CLI
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import pc from 'picocolors';

import { executeToolCalls } from './tools/executor.js';
import { discoverLocalServers, saveConfig } from './config/index.js';
import type { ToolContext, ToolCall, ChatMessage } from './types.js';
import type { LocalRouter } from './router/index.js';
import type { SessionManager } from './session/manager.js';
import type { UserProfile } from './profile.js';
import type { SqliteTodo } from './session/sqlite.js';

import { getSessionTodos } from './tools/builtin/todo.js';
import { saveProfile } from './profile.js';
import { extractAndSave } from './extraction.js';
import { printUserTurn, turnSeparator } from './formatting.js';
import { getClipboardText, getClipboardImage } from './clipboard.js';
import { spawnBackgroundAgent } from './agents/background.js';
import { handleSpecCommand } from './agents/loop.js';

export interface CommandContext {
  config: any;
  configDir: string;
  cliTempDir: string;
  router: LocalRouter;
  sessionManager: SessionManager;
  userProfile: UserProfile;
  projectHash: string;
  messages: ChatMessage[];
  activeFiles: Map<string, string>;
  toolContext: ToolContext;
  getSystemPromptWithMemory: () => string;
  callModelWithTools: (userContent: string, imageBase64?: string) => Promise<{ content: string; toolCalls: ToolCall[] }>;
  callModelWithFallback: (userContent: string, imageBase64?: string) => Promise<string>;
  rl: readline.Interface;
  initializeSessionState: (loaded: { sessionId: string; turns: ChatMessage[]; activeFiles: Map<string, string>; todos: SqliteTodo[] }) => void;
  buildFileContext: () => string;
  askLine: (prompt: string) => Promise<string>;
  buildIndexContext: (msg: string) => Promise<string>;
  getIndexDbPath: () => string;
}

export interface Command {
  name: string;
  aliases?: string[];
  description: string;
  execute: (args: string, ctx: CommandContext) => Promise<boolean | void>;
}

export const commandsList: Command[] = [
  {
    name: '/add',
    description: 'Add file to context',
    execute: async (args, ctx) => {
      const fileArg = args.trim();
      if (!fileArg) {
        const { runInteractiveFileSelector } = await import('./session/selector.js');
        ctx.rl.pause();
        const result = await runInteractiveFileSelector(process.cwd(), ctx.config.indexing.exclude, new Set(ctx.activeFiles.keys()));
        ctx.rl.resume();
        if (result !== null) {
          ctx.activeFiles.clear();
          for (const absPath of result) {
            const rel = path.relative(process.cwd(), absPath);
            ctx.activeFiles.set(absPath, rel);
          }
          ctx.toolContext.activeFiles = new Map(ctx.activeFiles);
          console.log(pc.green(`\n[OK] Active context files updated: ${ctx.activeFiles.size} file(s)`));
        }
      } else {
        const absPath = path.resolve(fileArg);
        ctx.activeFiles.set(absPath, fileArg);
        ctx.toolContext.activeFiles = new Map(ctx.activeFiles);
        console.log(pc.green(`[OK] Added file to context: ${pc.bold(fileArg)}`));
      }
    }
  },
  {
    name: '/remove',
    description: 'Remove file from context',
    execute: async (args, ctx) => {
      const fileArg = args.trim();
      if (!fileArg) {
        console.log(pc.red('[WARN] Please specify a file path. Example: /remove src/App.tsx'));
      } else {
        const absPath = path.resolve(fileArg);
        if (ctx.activeFiles.delete(absPath)) {
          ctx.toolContext.activeFiles = new Map(ctx.activeFiles);
          console.log(pc.green(`[OK] Removed file from context: ${pc.bold(fileArg)}`));
        } else {
          console.log(pc.yellow(`[WARN] File was not in context: ${fileArg}`));
        }
      }
    }
  },
  {
    name: '/context',
    description: 'Show active file context',
    execute: async (args, ctx) => {
      console.log(pc.bold('\n--- Monitored Files in Context ---'));
      if (ctx.activeFiles.size === 0) {
        console.log(pc.gray('  (No active files. Use "/add <filepath>" to add files)'));
      } else {
        ctx.activeFiles.forEach((filename) => {
          console.log(`  • ${pc.cyan(filename)}`);
        });
      }
      console.log(pc.bold('----------------------------------'));
    }
  },
  {
    name: '/paste',
    description: 'Paste clipboard text/image as message',
    execute: async (args, ctx) => {
      const extra = args.trim();
      if (extra && !extra.startsWith('http')) {
        const filePath = path.resolve(extra);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
            const imgBuffer = fs.readFileSync(filePath);
            const base64 = imgBuffer.toString('base64');
            const message = 'What do you see in this image?';
            printUserTurn(`${path.basename(filePath)} (image)`);
            try {
              const filesContext = ctx.buildFileContext();
              const indexCtx = await ctx.buildIndexContext(message);
              const userContent = `${indexCtx}${filesContext}User Prompt: ${message}`;
              await ctx.callModelWithTools(userContent, base64);
              ctx.sessionManager.saveSessionState(ctx.messages, ctx.activeFiles, getSessionTodos(ctx.toolContext.sessionId));
            } catch {
              try {
                const filesContext = ctx.buildFileContext();
                const userContent = `${filesContext}User Prompt: ${message}`;
                console.log(pc.yellow('\n  [RETRY] Trying fallback mode...'));
                await ctx.callModelWithFallback(userContent, base64);
                ctx.sessionManager.saveSessionState(ctx.messages, ctx.activeFiles, getSessionTodos(ctx.toolContext.sessionId));
              } catch (fallbackErr: any) {
                const firstLine = (fallbackErr.message || '').split('\n')[0];
                console.log(pc.red(`\n  ${pc.bold('[ERROR]')} Fallback also failed: ${firstLine}`));
              }
            }
            turnSeparator();
            return;
          }
        }
      }

      const imgPath = getClipboardImage(ctx.cliTempDir);
      if (imgPath) {
        const imgBuffer = fs.readFileSync(imgPath);
        fs.unlinkSync(imgPath);
        const base64 = imgBuffer.toString('base64');
        const message = extra || 'What do you see in this image?';
        printUserTurn(`${message} (image)`);
        try {
          const filesContext = ctx.buildFileContext();
          const indexCtx = await ctx.buildIndexContext(message);
          const userContent = `${indexCtx}${filesContext}User Prompt: ${message}`;
          await ctx.callModelWithTools(userContent, base64);
          ctx.sessionManager.saveSessionState(ctx.messages, ctx.activeFiles, getSessionTodos(ctx.toolContext.sessionId));
        } catch {
          try {
            const filesContext = ctx.buildFileContext();
            const userContent = `${filesContext}User Prompt: ${message}`;
            console.log(pc.yellow('\n  [RETRY] Trying fallback mode...'));
            await ctx.callModelWithFallback(userContent, base64);
            ctx.sessionManager.saveSessionState(ctx.messages, ctx.activeFiles, getSessionTodos(ctx.toolContext.sessionId));
          } catch (fallbackErr: any) {
            const firstLine = (fallbackErr.message || '').split('\n')[0];
            console.log(pc.red(`\n  ${pc.bold('[ERROR]')} Fallback also failed: ${firstLine}`));
          }
        }
        turnSeparator();
        return;
      }

      const clipboard = getClipboardText();
      if (!clipboard) {
        console.log(pc.red('[WARN] Clipboard is empty or inaccessible.'));
        return;
      }
      const fullMessage = extra ? `${clipboard}\n\n${extra}` : clipboard;
      printUserTurn(fullMessage);
      try {
        const filesContext = ctx.buildFileContext();
        const indexCtx = await ctx.buildIndexContext(fullMessage);
        const userContent = `${indexCtx}${filesContext}User Prompt: ${fullMessage}`;
        await ctx.callModelWithTools(userContent);
        ctx.sessionManager.saveSessionState(ctx.messages, ctx.activeFiles, getSessionTodos(ctx.toolContext.sessionId));
      } catch { /* ignored */ }
      turnSeparator();
    }
  },
  {
    name: '/clear',
    description: 'Clear conversation history',
    execute: async (args, ctx) => {
      ctx.messages.length = 0;
      ctx.messages.push({ role: 'system', content: ctx.getSystemPromptWithMemory() });
      console.log(pc.green('[OK] Conversation history cleared!'));
    }
  },
  {
    name: '/system',
    description: 'Print the current active system prompt (including loaded rules)',
    execute: async (args, ctx) => {
      const sysMsg = ctx.messages.find(m => m.role === 'system');
      if (sysMsg) {
        console.log(pc.bold('\n--- Current System Prompt ---'));
        console.log(sysMsg.content);
        console.log(pc.bold('-----------------------------'));
      } else {
        console.log(pc.red('[WARN] No active system prompt found in conversation.'));
      }
    }
  },
  {
    name: '/spawn',
    aliases: ['/delegate'],
    description: 'Spawn sub-agent: /spawn [--bg] <role> <task>',
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

      const validRoles = ['coder', 'reviewer', 'debugger', 'researcher', 'planner'];
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
    execute: async (_args, _ctx) => {
      const { backgroundJobs } = await import('./agents/background.js');
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
    execute: async (args, _ctx) => {
      const { backgroundJobs, killBackgroundAgent } = await import('./agents/background.js');
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
    execute: async (args, ctx) => {
      const pendingPlan = ctx.sessionManager.getState('orchestrate_plan');
      const pendingGoal = ctx.sessionManager.getState('orchestrate_goal');

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
          const { Orchestrator } = await import('./agents/orchestrator.js');
          const orchestrator = new Orchestrator(ctx.router, ctx.messages, ctx.toolContext, ctx.sessionManager);
          const planText = ctx.sessionManager.getState('orchestrate_plan_text') || '';
          const taskIndex = ctx.sessionManager.getState('orchestrate_task_index') || 0;
          const prevResults = ctx.sessionManager.getState('orchestrate_results') || [];

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
      const { Orchestrator } = await import('./agents/orchestrator.js');
      const orchestrator = new Orchestrator(ctx.router, ctx.messages, ctx.toolContext, ctx.sessionManager);
      const result = await orchestrator.run(goal);
      console.log(pc.white(`\n${result}`));
    }
  },
  {
    name: '/memory',
    description: 'View project memory (facts & conventions)',
    execute: async (args, ctx) => {
      const mem = ctx.sessionManager.loadMemory();
      console.log(pc.bold('\n--- Project Facts & Conventions (Memory) ---'));
      console.log(pc.bold('Conventions:'));
      if (Object.keys(mem.conventions).length === 0) {
        console.log(pc.gray('  No conventions saved.'));
      } else {
        for (const [k, v] of Object.entries(mem.conventions)) {
          console.log(`  • ${pc.cyan(k)}: ${v}`);
        }
      }
      console.log(pc.bold('\nFacts:'));
      if (mem.facts.length === 0) {
        console.log(pc.gray('  No facts saved.'));
      } else {
        mem.facts.forEach(f => {
          console.log(`  • ${pc.cyan(f.key)}: ${f.value} (source: ${f.source})`);
        });
      }
      console.log(pc.bold('------------------------------------------'));
    }
  },
  {
    name: '/fact',
    description: 'Add a project fact to memory',
    execute: async (args, ctx) => {
      const eqIdx = args.indexOf('=');
      if (eqIdx < 0) {
        console.log(pc.red('[WARN] Usage: /fact <key> = <value>'));
      } else {
        const key = args.slice(0, eqIdx).trim();
        const value = args.slice(eqIdx + 1).trim();
        ctx.sessionManager.addFact(key, value, 'user');
        console.log(pc.green(`[OK] Saved fact: ${key} = ${value}`));
      }
    }
  },
  {
    name: '/convention',
    description: 'Add a project convention to memory',
    execute: async (args, ctx) => {
      const eqIdx = args.indexOf('=');
      if (eqIdx < 0) {
        console.log(pc.red('[WARN] Usage: /convention <key> = <value>'));
      } else {
        const key = args.slice(0, eqIdx).trim();
        const value = args.slice(eqIdx + 1).trim();
        ctx.sessionManager.setConvention(key, value);
        console.log(pc.green(`[OK] Saved convention: ${key} = ${value}`));
      }
    }
  },
  {
    name: '/extract',
    description: 'Manually extract facts from session',
    execute: async (args, ctx) => {
      console.log(pc.dim('  [EXTRACT] Extracting facts from conversation...'));
      await extractAndSave(ctx.router, ctx.sessionManager, ctx.messages);
    }
  },
  {
    name: '/profile',
    description: 'View or set user profile info',
    execute: async (args, ctx) => {
      const rest = args.trim();
      if (!rest || rest === 'view') {
        console.log(pc.bold('\n--- Your Profile ---'));
        console.log(`  ${pc.cyan('Name')}: ${ctx.userProfile.name || '(not set)'}`);
        console.log(`  ${pc.cyan('Bio')}:  ${ctx.userProfile.bio || '(not set)'}`);
        if (ctx.userProfile.updatedAt) {
          console.log(pc.gray(`  Last updated: ${new Date(ctx.userProfile.updatedAt).toLocaleString()}`));
        }
        console.log(pc.dim('  Set name: /profile name = Your Name'));
        console.log(pc.dim('  Set bio:  /profile bio = Tell me about yourself'));
        return;
      }

      const eqIdx = rest.indexOf('=');
      if (eqIdx < 0) {
        if (rest.startsWith('name ')) {
          ctx.userProfile.name = rest.substring(5).trim();
          saveProfile(ctx.userProfile);
          console.log(pc.green(`[OK] Profile name set: ${ctx.userProfile.name}`));
          return;
        }
        if (rest.startsWith('bio ')) {
          ctx.userProfile.bio = rest.substring(4).trim();
          saveProfile(ctx.userProfile);
          console.log(pc.green('[OK] Profile bio set.'));
          return;
        }
      } else {
        const key = rest.slice(0, eqIdx).trim().toLowerCase();
        const val = rest.slice(eqIdx + 1).trim();
        if (key === 'name') {
          ctx.userProfile.name = val;
          saveProfile(ctx.userProfile);
          console.log(pc.green(`[OK] Profile name set: ${ctx.userProfile.name}`));
          return;
        } else if (key === 'bio') {
          ctx.userProfile.bio = val;
          saveProfile(ctx.userProfile);
          console.log(pc.green('[OK] Profile bio set.'));
          return;
        }
      }
      console.log(pc.red('[WARN] Usage: /profile view | /profile name = <name> | /profile bio = <bio>'));
    }
  },
  {
    name: '/style',
    description: 'Set your coding style preferences',
    execute: async (args, ctx) => {
      const rest = args.trim();
      if (!rest || rest === 'view') {
        console.log(pc.bold('\n--- Coding Style ---'));
        console.log(`  ${ctx.userProfile.style || '(not set)'}`);
        console.log(pc.dim('  Set: /style <your coding preferences>'));
        console.log(pc.dim('  Example: /style I prefer tabs, functional style, descriptive variable names'));
        return;
      }
      ctx.userProfile.style = rest;
      saveProfile(ctx.userProfile);
      console.log(pc.green('[OK] Coding style saved. It will be injected into every session.'));
    }
  },
  {
    name: '/undo',
    description: 'Undo last file patch',
    execute: async (args, ctx) => {
      const history = ctx.toolContext.patchHistory;
      if (!history || history.length === 0) {
        console.log(pc.yellow('[WARN] No patches to undo.'));
      } else {
        const last = history[history.length - 1];
        try {
          const currentContent = fs.readFileSync(last.filePath, 'utf8');
          if (currentContent === last.newContent) {
            fs.writeFileSync(last.filePath, last.oldContent, 'utf8');
            console.log(pc.green(`[OK] Undid patch to ${last.filePath} (${last.description})`));
          } else {
            console.log(pc.yellow(`[WARN] File ${last.filePath} has been modified since last patch. Cannot auto-undo.`));
          }
          history.pop();
        } catch (err: any) {
          console.log(pc.red(`[WARN] Failed to undo: ${err.message}`));
        }
      }
    }
  },
  {
    name: '/branch',
    description: 'Git branch operations',
    execute: async (args, ctx) => {
      try {
        const { execute: termExec } = await import('./tools/builtin/terminal.js');
        const arg = args.trim();
        if (!arg) {
          const currentBranchResult = await termExec({ command: 'git branch --show-current', timeout: 5, workdir: process.cwd() }, ctx.toolContext);
          const current = currentBranchResult.content?.trim();
          if (current) {
            console.log(`\n  ${pc.cyan('Current Git branch:')} ${pc.bold(current)}`);
          } else {
            console.log(pc.red('\n  Not in a Git repository or no branch found.'));
          }
        } else {
          console.log(`\n  Creating and switching to branch ${pc.cyan(arg)}...`);
          const checkoutResult = await termExec({ command: `git checkout -b ${arg}`, timeout: 10, workdir: process.cwd() }, ctx.toolContext);
          if (checkoutResult.success) {
            console.log(pc.green(`  [OK] Switched to a new branch '${arg}'`));
          } else {
            console.log(pc.yellow(`  Branch might already exist, attempting to switch...`));
            const switchResult = await termExec({ command: `git checkout ${arg}`, timeout: 10, workdir: process.cwd() }, ctx.toolContext);
            if (switchResult.success) {
              console.log(pc.green(`  [OK] Switched to branch '${arg}'`));
            } else {
              console.log(pc.red(`  Switch failed: ${switchResult.error || switchResult.content}`));
            }
          }
        }
      } catch (err: any) {
        console.log(pc.red(`[WARN] Branch command error: ${err.message}`));
      }
    }
  },
  {
    name: '/pr',
    description: 'Generate PR description Compared to base branch',
    execute: async (args, ctx) => {
      const arg = args.trim();
      try {
        const { execute: termExec } = await import('./tools/builtin/terminal.js');
        const gitCheck = await termExec({ command: 'git rev-parse --is-inside-work-tree', timeout: 5, workdir: process.cwd() }, ctx.toolContext);
        if (!gitCheck.success) {
          console.log(pc.red('  Error: Not inside a Git repository.'));
          return;
        }

        let baseBranch = arg || 'main';
        if (!arg) {
          const mainCheck = await termExec({ command: 'git show-ref --verify refs/heads/main', timeout: 5, workdir: process.cwd() }, ctx.toolContext);
          if (!mainCheck.success) {
            const masterCheck = await termExec({ command: 'git show-ref --verify refs/heads/master', timeout: 5, workdir: process.cwd() }, ctx.toolContext);
            if (masterCheck.success) {
              baseBranch = 'master';
            }
          }
        }

        const currentBranchResult = await termExec({ command: 'git branch --show-current', timeout: 5, workdir: process.cwd() }, ctx.toolContext);
        const currentBranch = currentBranchResult.content?.trim();

        console.log(`\n  Comparing ${pc.cyan(currentBranch || 'HEAD')} with base branch ${pc.cyan(baseBranch)}...`);

        const commitsResult = await termExec({ command: `git log ${baseBranch}..HEAD --oneline`, timeout: 10, workdir: process.cwd() }, ctx.toolContext);
        const commitList = commitsResult.content?.trim() || '';

        const diffResult = await termExec({ command: `git diff ${baseBranch}...HEAD`, timeout: 15, workdir: process.cwd() }, ctx.toolContext);
        const diffContent = diffResult.content?.slice(0, 15000) || '';

        if (!commitList && !diffContent) {
          console.log(pc.yellow(`  No commits or diff found between ${currentBranch} and ${baseBranch}.`));
          return;
        }

        console.log(pc.dim('  Analyzing changes and generating PR description...'));

        const aiResponse = await ctx.router.chat.completions.create({
          model: 'auto',
          messages: [
            {
              role: 'system',
              content: 'You write clean, comprehensive, professional Pull Request descriptions in Markdown format. Output ONLY the markdown content — no extra chat, wrapper, or quotes.'
            },
            {
              role: 'user',
              content: `Generate a Pull Request description for the current branch compared to ${baseBranch}.\n\nCommits:\n${commitList}\n\nDiff:\n${diffContent}`
            }
          ],
          temperature: 0.3,
        });

        const prDesc = (aiResponse.choices[0]?.message?.content || '').trim();
        if (!prDesc) {
          console.log(pc.red('  Failed to generate PR description.'));
          return;
        }

        console.log(pc.bold('\n--- Generated PR Description ---'));
        console.log(prDesc);
        console.log(pc.bold('--------------------------------'));

        const outPath = path.join(process.cwd(), 'pr-desc.md');
        fs.writeFileSync(outPath, prDesc, 'utf8');
        console.log(pc.green(`\n[OK] PR description saved to ${pc.cyan('pr-desc.md')}`));
      } catch (err: any) {
        console.log(pc.red(`[WARN] PR command error: ${err.message}`));
      }
    }
  },
  {
    name: '/debug',
    description: 'Run command and autonomously debug failures',
    execute: async (args, ctx) => {
      const debugCmd = args.trim();
      if (!debugCmd) {
        console.log(pc.red('  Error: Please specify a command to run. Example: /debug npm test'));
        return;
      }

      console.log(`\n  ${pc.cyan('Starting autonomous debugging loop for:')} ${pc.bold(debugCmd)}`);

      const MAX_RETRIES = 5;
      let attempt = 1;
      let success = false;

      while (attempt <= MAX_RETRIES) {
        console.log(`\n  ${pc.yellow(`[Attempt ${attempt}/${MAX_RETRIES}]`)} Running: ${pc.bold(debugCmd)}...`);

        try {
          const { execute: termExec } = await import('./tools/builtin/terminal.js');
          const execResult = await termExec({ command: debugCmd, timeout: 60, workdir: process.cwd() }, ctx.toolContext);

          if (execResult.success) {
            console.log(pc.green(`\n  ${pc.green('✔')} ${pc.bold(`Success on attempt ${attempt}!`)} Command passed with exit code 0.`));
            success = true;
            break;
          }

          console.log(pc.red(`\n  ${pc.red('✗')} ${pc.bold(`Command failed on attempt ${attempt}.`)}`));

          const stdout = execResult.content || '';
          const errorMsg = execResult.error || '';
          const logs = `${stdout}\n${errorMsg}`.trim();

          console.log(pc.bold('\n--- Failure Logs ---'));
          const logLines = logs.split('\n');
          const preview = logLines.length > 20 ? logLines.slice(-20).join('\n') : logs;
          console.log(preview);
          if (logLines.length > 20) {
            console.log(pc.dim(`\n  (... truncated ${logLines.length - 20} lines of logs ...)`));
          }
          console.log(pc.bold('--------------------'));

          if (attempt === MAX_RETRIES) {
            console.log(pc.red(`\n  Reached maximum attempt limit of ${MAX_RETRIES}. Debugging loop failed.`));
            break;
          }

          console.log(pc.dim('\n  Calling Daedalus to analyze failure and apply a fix...'));

          const debugPrompt = `The command "${debugCmd}" failed on attempt ${attempt}.
Here are the execution logs (showing the failure details):

${logs.slice(-6000)}

Please analyze the error, identify which files need correction, and apply surgical edits using 'patch' or write tools to fix the issue.
Once you have finished making changes, I will automatically re-run the command to verify if it passes.`;

          await ctx.callModelWithTools(debugPrompt);

        } catch (err: any) {
          console.log(pc.red(`\n  Error in debugging loop: ${err.message}`));
          break;
        }

        attempt++;
      }

      if (!success) {
        console.log(pc.red(`\n  Autonomous debugging did not succeed after ${MAX_RETRIES} attempts.`));
      }
      turnSeparator();
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
        const { runEnsembleWorkflow } = await import('./agents/ensemble.js');
        await runEnsembleWorkflow(ensembleGoal, ctx.toolContext, ctx.config, ctx.router);
      } catch (err: any) {
        console.log(pc.red(`\n  Error in ensemble drafting: ${err.message}`));
      }
      turnSeparator();
    }
  },
  {
    name: '/commit',
    description: 'Stage and commit changes',
    execute: async (args, ctx) => {
      const forcedMsg = args.trim();
      try {
        const { execute: termExec } = await import('./tools/builtin/terminal.js');
        const statusResult = await termExec({ command: 'git status --short', timeout: 10, workdir: process.cwd() }, ctx.toolContext);
        console.log(pc.bold('\n--- Git Status ---'));
        console.log(statusResult.content || pc.gray('(clean)'));
        if (!statusResult.content?.trim()) {
          console.log(pc.yellow('Nothing to commit.'));
          return;
        }
        const addResult = await termExec({ command: 'git add -A', timeout: 10, workdir: process.cwd() }, ctx.toolContext);
        if (!addResult.success) {
          console.log(pc.red(`Stage failed: ${addResult.error}`));
          return;
        }
        let commitMsg = forcedMsg;
        if (!commitMsg) {
          const diffResult = await termExec({ command: 'git diff --cached --stat', timeout: 10, workdir: process.cwd() }, ctx.toolContext);
          const diffFull = await termExec({ command: 'git diff --cached', timeout: 10, workdir: process.cwd() }, ctx.toolContext);
          const diffContent = diffFull.content?.slice(0, 6000) || '';
          if (diffResult.content) console.log(pc.gray(diffResult.content));

          if (diffContent) {
            console.log(pc.dim('  Generating commit message...'));
            try {
              const aiResponse = await ctx.router.chat.completions.create({
                model: 'auto',
                messages: [
                  { role: 'system', content: 'You write concise git commit messages following the Conventional Commits spec (type(scope): description). Output only the commit message — no explanation, no quotes, no extra text.' },
                  { role: 'user', content: `Write a commit message for this diff:\n\n${diffContent}` }
                ],
                temperature: 0.2,
                max_tokens: 80,
              });
              const suggested = ((aiResponse.choices[0]?.message?.content) || '').trim().split('\n')[0].trim();
              if (suggested) {
                console.log(`\n  ${pc.dim('Suggested:')} ${pc.cyan(suggested)}`);
                const choice = await ctx.askLine(pc.dim('  [Enter] accept  [e] edit  [n] cancel: '));
                if (choice.trim().toLowerCase() === 'n') {
                  console.log(pc.yellow('Commit cancelled.'));
                  await termExec({ command: 'git restore --staged .', timeout: 10, workdir: process.cwd() }, ctx.toolContext);
                  return;
                } else if (choice.trim().toLowerCase() === 'e') {
                  commitMsg = await ctx.askLine(pc.cyan('  Commit message: '));
                } else {
                  commitMsg = suggested;
                }
              }
            } catch {
              // Model unavailable — manual fallback
            }
          }

          if (!commitMsg) {
            commitMsg = await ctx.askLine(pc.cyan('  Commit message: '));
          }
          if (!commitMsg.trim()) {
            console.log(pc.yellow('Commit cancelled — empty message.'));
            await termExec({ command: 'git restore --staged .', timeout: 10, workdir: process.cwd() }, ctx.toolContext);
            return;
          }
        }
        const commitResult = await termExec({ command: `git commit -m ${JSON.stringify(commitMsg)}`, timeout: 10, workdir: process.cwd() }, ctx.toolContext);
        if (commitResult.success) {
          console.log(pc.green(`\n[OK] Commit: ${commitMsg.slice(0, 60)}`));
        } else {
          console.log(pc.red(`Commit failed: ${commitResult.error}`));
        }
      } catch (err: any) {
        console.log(pc.red(`[WARN] Commit error: ${err.message}`));
      }
    }
  },
  {
    name: '/project',
    description: 'View or set project config settings (.daedalusrc)',
    execute: async (args, _ctx) => {
      const rest = args.trim();
      const { loadProjectConfig, saveProjectConfig, hasLocalConfig } = await import('./tools/builtin/project-config.js');
      if (!rest) {
        const cfg = loadProjectConfig(process.cwd());
        const isLocal = hasLocalConfig(process.cwd());
        console.log(pc.bold(`\n--- Project Config (${isLocal ? '.daedalusrc' : 'global'}) ---`));
        console.log(JSON.stringify(cfg, null, 2));
        console.log(pc.bold('----------------------------------'));
        console.log(pc.gray('Use /project set <key> = <value> to update'));
        console.log(pc.gray('Use /project init to create a .daedalusrc in this project'));
        return;
      }

      if (rest === 'init') {
        const localPath = path.join(process.cwd(), '.daedalusrc');
        if (fs.existsSync(localPath)) {
          console.log(pc.yellow('.daedalusrc already exists in this project'));
          return;
        }
        const cfg = loadProjectConfig(process.cwd());
        saveProjectConfig(cfg, true);
        console.log(pc.green('Created .daedalusrc — project config is now local to this repo'));
        return;
      }

      if (rest.startsWith('set ')) {
        const setArgs = rest.substring(4).trim();
        const eqIdx = setArgs.indexOf('=');
        let key: string, value: string;
        if (eqIdx >= 0) {
          key = setArgs.slice(0, eqIdx).trim();
          value = setArgs.slice(eqIdx + 1).trim();
        } else {
          const parts = setArgs.split(/\s+/);
          key = parts[0];
          value = parts.slice(1).join(' ');
        }
        if (!key || !value) {
          console.log(pc.red('Usage: /project set <key> = <value>'));
        } else {
          const cfg = loadProjectConfig(process.cwd());
          let parsedVal: any = value;
          if (value.toLowerCase() === 'true') parsedVal = true;
          else if (value.toLowerCase() === 'false') parsedVal = false;
          else if (!isNaN(Number(value))) parsedVal = Number(value);

          (cfg as Record<string, any>)[key] = parsedVal;
          const isLocal = hasLocalConfig(process.cwd());
          saveProjectConfig(cfg, isLocal);
          console.log(pc.green(`Set ${key} = ${value} (${isLocal ? '.daedalusrc' : 'global'})`));
        }
      } else {
        console.log(pc.red(`Unknown subcommand: ${rest}. Try: /project, /project set <key> = <value>, /project init`));
      }
    }
  },
  {
    name: '/session',
    description: 'Manage chat sessions — /session new to start, /session load <id> to restore, /session export [path] to save transcript',
    execute: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0].toLowerCase();
      const subcommandArg = parts.slice(1).join(' ').trim();

      if (!subcommand || subcommand === 'list') {
        const sessions = ctx.sessionManager.getSessionsForProject();
        console.log(pc.bold('\n--- Past Sessions ---'));
        if (sessions.length === 0) {
          console.log(pc.gray('  No past sessions found.'));
        } else {
          sessions.forEach(s => {
            const currentTag = s.id === ctx.sessionManager.sessionId ? pc.green(' (current)') : '';
            const dateStr = new Date(s.updated_at).toLocaleString();
            console.log(`  • ${pc.cyan(s.id)}${currentTag}`);
            console.log(`    Title: ${pc.white(s.title)}`);
            console.log(`    Updated: ${pc.dim(dateStr)}`);
          });
        }
        console.log(pc.bold('---------------------\n'));
        console.log(pc.gray('Use `/session load <id>` to resume a past session.'));
        console.log(pc.gray('Use `/session search <query>` to search sessions.'));
        console.log(pc.gray('Use `/session new [title]` to start a new session.'));
        console.log(pc.gray('Use `/session rename <title>` to rename the current session.'));
        console.log(pc.gray('Use `/session delete <id>` to delete a session.'));
        console.log(pc.gray('Use `/session export [path]` to export the current session to Markdown.'));
        return;
      }

      if (subcommand === 'search') {
        if (!subcommandArg) {
          console.log(pc.red('Usage: /session search <query>'));
          return;
        }
        const query = subcommandArg.toLowerCase();
        const sessions = ctx.sessionManager.getSessionsForProject();
        const matches = sessions.filter(s =>
          s.title.toLowerCase().includes(query) ||
          s.id.toLowerCase().includes(query)
        );
        if (matches.length === 0) {
          console.log(pc.yellow(`No sessions matching "${subcommandArg}"`));
        } else {
          console.log(pc.bold(`\n--- Matching Sessions (${matches.length}) ---`));
          matches.forEach(s => {
            const currentTag = s.id === ctx.sessionManager.sessionId ? pc.green(' (current)') : '';
            const dateStr = new Date(s.updated_at).toLocaleString();
            console.log(`  • ${pc.cyan(s.id)}${currentTag}`);
            console.log(`    Title: ${pc.white(s.title)}`);
            console.log(`    Updated: ${pc.dim(dateStr)}`);
          });
          console.log(pc.bold('----------------------------------\n'));
        }
        return;
      }

      if (subcommand === 'load') {
        if (!subcommandArg) {
          console.log(pc.red('Usage: /session load <session-id>'));
          return;
        }
        const sessions = ctx.sessionManager.getSessionsForProject();
        const found = sessions.find(s => s.id === subcommandArg || s.id.startsWith(subcommandArg));
        if (!found) {
          console.log(pc.red(`Session "${subcommandArg}" not found.`));
          return;
        }
        const currentTodos = getSessionTodos(ctx.toolContext.sessionId);
        ctx.sessionManager.saveSessionState(ctx.messages, ctx.activeFiles, currentTodos);

        if (found.project_path && found.project_path !== ctx.sessionManager.projectRoot) {
          ctx.sessionManager.setProjectRoot(found.project_path);
          ctx.sessionManager.reopenIndexDb();
          ctx.projectHash = ctx.sessionManager.projectHash;
          ctx.toolContext.projectRoot = ctx.sessionManager.projectRoot;
          ctx.toolContext.projectHash = ctx.sessionManager.projectHash;
        }

        const loaded = ctx.sessionManager.startSession(found.id, found.title);
        ctx.initializeSessionState(loaded);
        console.log(pc.green(`Loaded session: ${pc.bold(found.id)} ("${found.title}") [${ctx.sessionManager.projectRoot}]`));
        return;
      }

      if (subcommand === 'new') {
        const currentTodos = getSessionTodos(ctx.toolContext.sessionId);
        ctx.sessionManager.saveSessionState(ctx.messages, ctx.activeFiles, currentTodos);

        let title: string;
        let projectRoot: string | undefined;

        if (path.isAbsolute(subcommandArg)) {
          projectRoot = subcommandArg;
          title = `Session on ${path.basename(subcommandArg.replace(/[\\/]$/, ''))} — ${new Date().toLocaleDateString()}`;
        } else {
          title = subcommandArg || `Session on ${new Date().toLocaleDateString()}`;
        }

        if (projectRoot && projectRoot !== ctx.sessionManager.projectRoot) {
          ctx.sessionManager.setProjectRoot(projectRoot);
          ctx.sessionManager.reopenIndexDb();
          ctx.projectHash = ctx.sessionManager.projectHash;
          ctx.toolContext.projectRoot = ctx.sessionManager.projectRoot;
          ctx.toolContext.projectHash = ctx.sessionManager.projectHash;
        }

        const loaded = ctx.sessionManager.startSession(undefined, title);
        ctx.initializeSessionState(loaded);
        console.log(pc.green(`Started new session: ${pc.bold(loaded.sessionId)} [${ctx.sessionManager.projectRoot}]`));
        return;
      }

      if (subcommand === 'rename') {
        if (!subcommandArg) {
          console.log(pc.red('Usage: /session rename <new-title>'));
          return;
        }
        ctx.sessionManager.updateSessionTitle(subcommandArg);
        console.log(pc.green(`Session renamed to: "${subcommandArg}"`));
        return;
      }

      if (subcommand === 'delete') {
        if (!subcommandArg) {
          console.log(pc.red('Usage: /session delete <session-id>'));
          return;
        }
        if (subcommandArg === ctx.sessionManager.sessionId) {
          console.log(pc.red('Cannot delete the current active session.'));
          return;
        }
        const sessions = ctx.sessionManager.getSessionsForProject();
        const found = sessions.find(s => s.id === subcommandArg || s.id.startsWith(subcommandArg));
        if (!found) {
          console.log(pc.red(`Session "${subcommandArg}" not found.`));
          return;
        }

        ctx.sessionManager.deleteSession(found.id);
        console.log(pc.green(`Deleted session: ${pc.bold(found.id)}`));
        return;
      }

      if (subcommand === 'export') {
        const mdPath = subcommandArg || `transcript-${ctx.sessionManager.sessionId}.md`;
        const resolved = path.resolve(ctx.sessionManager.projectRoot || '.', mdPath);
        
        let md = `# Daedalus Session: ${ctx.sessionManager.sessionTitle}\n\n`;
        md += `*Generated: ${new Date().toLocaleString()}*\n\n---\n\n`;

        for (const msg of ctx.messages) {
          if (msg.role === 'system') continue;

          if (msg.role === 'user') {
            md += `### 👤 User\n\n`;
            md += `${msg.content}\n\n---\n\n`;
          } else if (msg.role === 'assistant') {
            md += `### 🤖 Daedalus\n\n`;
            if (msg.content) {
              md += `${msg.content}\n\n`;
            }
            if (msg.tool_calls && msg.tool_calls.length > 0) {
              md += `#### 🛠️ Tool Execution\n\n`;
              for (const tc of msg.tool_calls) {
                md += `* **${tc.function.name}**\n`;
                try {
                  const prettyArgs = JSON.stringify(JSON.parse(tc.function.arguments), null, 2);
                  md += `  \`\`\`json\n${prettyArgs}\n  \`\`\`\n`;
                } catch {
                  md += `  *Arguments*: \`${tc.function.arguments}\`\n`;
                }
              }
              md += `\n`;
            }
            md += `---\n\n`;
          } else if (msg.role === 'tool') {
            md += `#### 📥 Tool Response (${msg.name || 'unknown'})\n\n`;
            const trimmedContent = msg.content && msg.content.length > 2000 
              ? msg.content.slice(0, 2000) + '\n\n... (output truncated for readability)'
              : msg.content;
            md += `\`\`\`text\n${trimmedContent || '(no output)'}\n\`\`\`\n\n---\n\n`;
          }
        }

        fs.writeFileSync(resolved, md, 'utf8');
        console.log(pc.green(`Session transcript exported to: ${pc.bold(resolved)}`));
        return;
      }

      console.log(pc.red(`Unknown subcommand: ${subcommand}. Try: list, search, load, new, rename, delete, export`));
    }
  },
  {
    name: '/test',
    description: 'Run test loop and fix failures',
    execute: async (args, ctx) => {
      const maxLoops = args.trim() ? parseInt(args.trim(), 10) || 3 : 3;
      const { loadProjectConfig } = await import('./tools/builtin/project-config.js');
      const { execute: termExec } = await import('./tools/builtin/terminal.js');
      const cfg = loadProjectConfig(process.cwd());
      const testCmd = cfg.testCommand || 'npm test';
      console.log(pc.bold(`\nTest-Run-Fix Loop (max ${maxLoops} iterations)`));
      console.log(pc.gray(`Test command: ${testCmd}\n`));
      for (let i = 0; i < maxLoops; i++) {
        console.log(pc.cyan(`\n--- Run ${i + 1}/${maxLoops} ---`));
        const result = await termExec({ command: testCmd, timeout: 120, workdir: process.cwd() }, ctx.toolContext);
        console.log(result.content?.slice(0, 2000) || pc.gray('(no output)'));
        if (result.success) {
          console.log(pc.green('\n[OK] All tests passed!'));
          break;
        }
        if (i === maxLoops - 1) {
          console.log(pc.yellow(`\n[WARN] Max loops (${maxLoops}) reached. Tests still failing.`));
          break;
        }
        const failureCtx = `Tests failed (run ${i + 1}/${maxLoops}). Output:\n\n${result.content?.slice(0, 8000) || 'Unknown failure'}\n\nAnalyze the failures and fix the code. Do not re-read files you already have in context.`;
        await ctx.callModelWithTools(`User Prompt: ${failureCtx}`);
        ctx.sessionManager.saveSessionState(ctx.messages, ctx.activeFiles, getSessionTodos(ctx.toolContext.sessionId));
      }
    }
  },
  {
    name: '/index',
    description: 'Index codebase for symbol search',
    execute: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const opts: { exclude?: string[]; extensions?: string[] } = {};
      for (const arg of parts) {
        if (arg.startsWith('--exclude=')) {
          opts.exclude = arg.split('=')[1].split(',');
        } else if (arg.startsWith('--ext=')) {
          opts.extensions = arg.split('=')[1].split(',');
        }
      }
      
      console.log(pc.bold('\n--- Indexing Codebase ---'));
      console.log(pc.gray(`Project: ${process.cwd()}`));

      const indexDbPath = ctx.getIndexDbPath();

      if (!fs.existsSync(path.dirname(indexDbPath))) {
        fs.mkdirSync(path.dirname(indexDbPath), { recursive: true });
      }

      const { initIndexDb } = await import('./indexing/fts.js');
      const { indexCodebase } = await import('./indexing/indexer.js');
      const db = initIndexDb(indexDbPath);

      console.log(pc.gray('\nScanning files...'));
      const start = Date.now();

      try {
        const barWidth = 20;
        let lastPct = -1;
        const onProgress = ({ current, total, file }: { current: number; total: number; file: string }) => {
          const pct = Math.round((current / total) * 100);
          if (pct === lastPct) return;
          lastPct = pct;
          const filled = Math.round((current / total) * barWidth);
          const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);
          process.stdout.write(`\r  ${pc.cyan(bar)} ${pc.white(`${current}/${total}`)} ${pc.gray(file.slice(-40))}`);
        };

        const result = await indexCodebase(db, process.cwd(), ctx.projectHash, { ...opts, onProgress });
        process.stdout.write('\n');
        const elapsed = Date.now() - start;

        ctx.toolContext.indexDb = db;

        console.log(pc.green(`\n✔ Indexing complete in ${elapsed}ms`));
        console.log(pc.white(`  Total files:     ${result.totalFiles}`));
        console.log(pc.white(`  Indexed files:   ${result.indexedFiles}`));
        console.log(pc.white(`  Skipped (unchanged): ${result.skippedFiles}`));
        if (result.errors.length > 0) {
          console.log(pc.yellow(`\nErrors (${result.errors.length}):`));
          result.errors.slice(0, 10).forEach(e => console.log(pc.red(`  - ${e}`)));
          if (result.errors.length > 10) {
            console.log(pc.gray(`  ... and ${result.errors.length - 10} more`));
          }
        }
      } catch (err: any) {
        console.error(pc.red(`\n[ERROR] Indexing failed: ${err.message}`));
      }
    }
  },
  {
    name: '/find',
    description: 'Search indexed symbols',
    execute: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        console.log(pc.red('[WARN] Usage: /find <query> [limit]'));
        return;
      }
      const query = parts[0];
      const limit = parts[1] ? parseInt(parts[1], 10) : 30;
      if (isNaN(limit)) {
        console.log(pc.red('[WARN] Invalid limit'));
        return;
      }

      const indexDbPath = ctx.getIndexDbPath();
      if (!fs.existsSync(indexDbPath)) {
        console.log(pc.yellow('[WARN] No index found. Run /index first.'));
        return;
      }
      
      const { initIndexDb, searchSymbols } = await import('./indexing/fts.js');
      const db = initIndexDb(indexDbPath);

      console.log(pc.bold(`\n--- Symbol Search: "${query}" ---`));
      const symbols = searchSymbols(db, query, ctx.projectHash, limit);

      if (symbols.length === 0) {
        console.log(pc.gray('  No symbols found.'));
        return;
      }

      console.log(pc.white(`\nFound ${symbols.length} symbol(s):`));
      for (const s of symbols) {
        const kindColor = s.kind === 'function' ? pc.cyan : s.kind === 'class' ? pc.green : s.kind === 'interface' ? pc.blue : pc.white;
        const loc = `${s.file_path}:${s.line_start}${s.line_end !== s.line_start ? '-' + s.line_end : ''}`;
        console.log(`  ${kindColor(`[${s.kind}]`)} ${pc.bold(s.name)} ${pc.dim(`(${loc})`)}`);
        if (s.signature) {
          console.log(pc.dim(`    ${s.signature.slice(0, 100)}${s.signature.length > 100 ? '...' : ''}`));
        }
      }
    }
  },
  {
    name: '/refs',
    description: 'Find symbol references (callers)',
    execute: async (args, ctx) => {
      const symbol = args.trim();
      if (!symbol) {
        console.log(pc.red('[WARN] Usage: /refs <symbol>'));
        return;
      }

      const indexDbPath = ctx.getIndexDbPath();
      if (!fs.existsSync(indexDbPath)) {
        console.log(pc.yellow('[WARN] No index found. Run /index first.'));
        return;
      }

      const { initIndexDb, findReferences } = await import('./indexing/fts.js');
      const db = initIndexDb(indexDbPath);

      console.log(pc.bold(`\n--- References to: ${symbol} ---`));
      const refs = findReferences(db, symbol, ctx.projectHash);

      if (refs.length === 0) {
        console.log(pc.gray('  No references found.'));
        return;
      }

      const byCaller = new Map<string, typeof refs>();
      for (const r of refs) {
        const key = `${r.caller_name} (${r.caller_file}:${r.caller_line})`;
        if (!byCaller.has(key)) byCaller.set(key, []);
        byCaller.get(key)!.push(r);
      }

      console.log(pc.white(`\nFound ${refs.length} reference(s) from ${byCaller.size} caller(s):`));
      for (const [caller, refs] of byCaller) {
        console.log(pc.cyan(`\n  ${caller}:`));
        for (const r of refs.slice(0, 5)) {
          console.log(pc.dim(`    ${r.callee_name} at ${r.callee_file}:${r.callee_line}`));
        }
        if (refs.length > 5) {
          console.log(pc.dim(`    ... and ${refs.length - 5} more`));
        }
      }
    }
  },
  {
    name: '/def',
    description: 'Get symbol definition',
    execute: async (args, ctx) => {
      const symbol = args.trim();
      if (!symbol) {
        console.log(pc.red('[WARN] Usage: /def <symbol>'));
        return;
      }

      const indexDbPath = ctx.getIndexDbPath();
      if (!fs.existsSync(indexDbPath)) {
        console.log(pc.yellow('[WARN] No index found. Run /index first.'));
        return;
      }

      const { initIndexDb, findDefinitions } = await import('./indexing/fts.js');
      const db = initIndexDb(indexDbPath);

      console.log(pc.bold(`\n--- Definition: ${symbol} ---`));
      const defs = findDefinitions(db, symbol, ctx.projectHash);

      if (defs.length === 0) {
        console.log(pc.gray('  No definitions found.'));
        return;
      }

      console.log(pc.white(`\nFound ${defs.length} definition(s):`));
      for (const d of defs) {
        const kindColor = d.kind === 'function' ? pc.cyan : d.kind === 'class' ? pc.green : d.kind === 'interface' ? pc.blue : pc.white;
        const loc = `${d.file_path}:${d.line_start}${d.line_end !== d.line_start ? '-' + d.line_end : ''}`;
        console.log(`  ${kindColor(`[${d.kind}]`)} ${pc.bold(d.name)} ${pc.dim(`(${loc})`)}`);
        if (d.signature) {
          console.log(pc.dim(`    ${d.signature.slice(0, 120)}${d.signature.length > 120 ? '...' : ''}`));
        }
      }
    }
  },
  {
    name: '/changelog',
    description: 'View the latest CLI changes',
    execute: async (_args, _ctx) => {
      const { fileURLToPath } = await import('url');
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');

      if (!fs.existsSync(changelogPath)) {
        console.log(pc.yellow('[WARN] CHANGELOG.md not found.'));
        return;
      }

      const content = fs.readFileSync(changelogPath, 'utf8');
      const lines = content.split('\n');

      console.log(pc.bold('\n--- Latest CLI Changes ---'));

      let versionCount = 0;
      const maxVersions = 3;
      const displayLines: string[] = [];

      for (const line of lines) {
        const isHeader = line.startsWith('# ') || line.startsWith('## ');
        if (isHeader) {
          versionCount++;
          if (versionCount > maxVersions) {
            break;
          }
        }
        if (versionCount > 0) {
          displayLines.push(line);
        }
      }

      console.log(displayLines.join('\n').trim());
      console.log(pc.bold('---------------------------\n'));
    }
  },
  {
    name: '/models',
    description: 'List available and healthy models',
    execute: async (args, ctx) => {
      console.log(pc.bold('\n--- Available Models ---'));
      const models = await ctx.router.listModels();
      if (models.length === 0) {
        console.log(pc.yellow('  No models found. Check your local servers (LM Studio, Ollama, etc.)'));
      } else {
        for (const model of models) {
          console.log(`  • ${pc.cyan(model)}`);
        }
      }
      const { checkModelHealth } = await import('./router/health.js');
      const healthyModels = ctx.router.getHealthyModels();
      console.log(pc.bold('\n--- Healthy Models ---'));
      for (const model of healthyModels) {
        const health = await checkModelHealth(model, 5000);
        const status = health?.healthy ? pc.green('●') : pc.red('●');
        console.log(`  ${status} ${pc.cyan(model.name)} (${model.endpoint}) - ${model.model}`);
      }
      console.log(pc.bold('----------------------\n'));
    }
  },
  {
    name: '/config',
    description: 'Show current configuration',
    execute: async (args, ctx) => {
      const rest = args.trim();
      if (!rest) {
        console.log(pc.bold('\n--- Current Configuration ---'));
        console.log(JSON.stringify(ctx.config, null, 2));
        console.log(pc.bold('-----------------------------'));
        console.log(pc.gray(`\nEdit ${ctx.configDir}/config.json to modify settings.`));
        console.log(pc.gray('Or run `/config set <key> = <value>` (e.g. `/config set router.strategy = round-robin`)'));
        console.log(pc.gray('Or run `/config set model.<name>.<property> = <value>` (e.g. `/config set model.lmstudio-default.tier = intelligence`)'));
        return;
      }

      if (rest.startsWith('set ')) {
        const setArgs = rest.substring(4).trim();
        const eqIdx = setArgs.indexOf('=');
        let key: string, value: string;
        if (eqIdx >= 0) {
          key = setArgs.slice(0, eqIdx).trim();
          value = setArgs.slice(eqIdx + 1).trim();
        } else {
          const parts = setArgs.split(/\s+/);
          key = parts[0];
          value = parts.slice(1).join(' ').trim();
        }

        if (!key || !value) {
          console.log(pc.red('[WARN] Usage: /config set <key> = <value>'));
          return;
        }

        const { saveConfig, ConfigSchema } = await import('./config/index.js');
        let parsedVal: any = value;
        if (value.toLowerCase() === 'true') parsedVal = true;
        else if (value.toLowerCase() === 'false') parsedVal = false;
        else if (!isNaN(Number(value))) parsedVal = Number(value);

        try {
          if (key.startsWith('model.')) {
            const parts = key.split('.');
            if (parts.length < 3) {
              console.log(pc.red('[WARN] Usage: /config set model.<name>.<property> = <value>'));
              return;
            }
            const modelIdentifier = parts[1];
            const property = parts.slice(2).join('.');
            const chain = ctx.config.router.chain;
            const modelEntry = chain.find((m: any) => m.name === modelIdentifier || m.model === modelIdentifier);
            if (!modelEntry) {
              console.log(pc.red(`[WARN] Model '${modelIdentifier}' not found in router chain.`));
              return;
            }
            (modelEntry as Record<string, any>)[property] = parsedVal;
          } else {
            const parts = key.split('.');
            let currentObj: any = ctx.config;
            for (let i = 0; i < parts.length - 1; i++) {
              if (currentObj[parts[i]] === undefined) {
                currentObj[parts[i]] = {};
              }
              currentObj = currentObj[parts[i]];
            }
            currentObj[parts[parts.length - 1]] = parsedVal;
          }

          const validated = ConfigSchema.parse(ctx.config);
          ctx.config = validated;
          saveConfig(validated);
          console.log(pc.green(`[OK] Set global config: ${key} = ${value}`));
        } catch (err: any) {
          console.log(pc.red(`[WARN] Invalid configuration value: ${err.message}`));
        }
      } else {
        console.log(pc.red('[WARN] Usage: /config | /config set <key> = <value>'));
      }
    }
  },
  {
    name: '/doctor',
    description: 'Diagnose connection and discovery',
    execute: async (args, ctx) => {
      console.log(pc.bold('\n--- Daedalus Doctor ---'));
      console.log(pc.gray('Checking local server connections...\n'));
      const discovered = await discoverLocalServers();
      if (discovered.length === 0) {
        console.log(pc.yellow('  No local servers detected.'));
        console.log(pc.gray('  Start one of:'));
        console.log(pc.gray('    • LM Studio (http://localhost:1234)'));
        console.log(pc.gray('    • Ollama (http://localhost:11434)'));
        console.log(pc.gray('    • llama.cpp server (--server, default :8080)'));
        console.log(pc.gray('    • vLLM (http://localhost:8000)'));
      } else {
        console.log(pc.green(`  Found ${discovered.length} running server(s):\n`));
        for (const server of discovered) {
          console.log(`  ${pc.green('●')} ${server.name} at ${server.endpoint}`);
          for (const model of server.models.slice(0, 5)) {
            console.log(`      - ${model}`);
          }
          if (server.models.length > 5) {
            console.log(pc.gray(`      ... and ${server.models.length - 5} more`));
          }
        }
      }
      console.log(pc.bold('\n--- Router Health ---'));
      const enabledModels = ctx.router.getEnabledModels();
      if (enabledModels.length === 0) {
        console.log(pc.yellow('  No models configured. Run /onboard to set one up.'));
      } else {
        for (const model of enabledModels) {
          const { checkModelHealth } = await import('./router/health.js');
          const health = await checkModelHealth(model, 5000);
          const status = health.healthy ? pc.green('●') : pc.red('●');
          const latency = health.latencyMs ? ` (${health.latencyMs}ms)` : '';
          const err = health.error ? ` ${pc.red(health.error)}` : '';
          console.log(`  ${status} ${model.name}: ${model.endpoint}${latency}${err}`);
        }
      }
      console.log(pc.bold('  Config:') + pc.gray(` ${ctx.configDir}\\config.json`));
      console.log(pc.bold('----------------------\n'));
    }
  },
  {
    name: '/spec',
    description: 'Flesh out a feature idea into a GitHub Issue spec (Finn Loop)',
    execute: async (args, ctx) => {
      await handleSpecCommand(args, ctx);
    }
  },
  {
    name: '/help',
    aliases: ['?', 'help'],
    description: 'Show available commands',
    execute: async (_args, _ctx) => {
      console.log(pc.bold('\n--- Available Commands ---'));
      for (const cmd of commandsList) {
        const aliasList = cmd.aliases ? cmd.aliases.map(a => a.startsWith('/') ? a : `/${a}`) : [];
        const nameAndAliases = [cmd.name, ...aliasList].join(', ');
        console.log(`  ${pc.cyan(nameAndAliases.padEnd(30))} - ${cmd.description}`);
      }
      console.log(pc.bold('--------------------------'));
      console.log(pc.gray('  Detailed documentation: ') + pc.underline(pc.cyan('https://bgill55.github.io/daedalus/#/')));
      console.log();
    }
  },
  {
    name: '/mcp',
    description: 'Manage MCP servers: explore, search, install, list, remove, info',
    execute: async (args, _ctx) => {
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase();
      const rest = parts.slice(1).join(' ').trim();

      const { searchRegistry, fetchServerByName, fetchAllServers, registryEntryToConfig, addServerToConfig, removeServerFromConfig, listInstalledServers, toggleServer } = await import('./tools/mcp/manager.js');
      const { mcpRegistry } = await import('./tools/mcp/registry.js');

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
          } catch (err: any) {
            console.log(pc.red(`  Search failed: ${err.message}`));
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
          } catch (err: any) {
            console.log(pc.red(`  Install failed: ${err.message}`));
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

            const showSample = (list: any[], label: string, max = 5) => {
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
          } catch (err: any) {
            console.log(pc.red(`  Explore failed: ${err.message}`));
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
          } catch (err: any) {
            console.log(pc.red(`  Info fetch failed: ${err.message}`));
          }
          return;
        }

        case 'reconnect':
        case 'rc': {
          const { loadConfig } = await import('./config/index.js');
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
            } catch (err: any) {
              failed.push(`${s.name} (${err.message})`);
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
          console.log(`  ${pc.cyan('/mcp search <query>')}    ${pc.dim('Search the official MCP registry')}`);
          console.log(`  ${pc.cyan('/mcp install <name>')}   ${pc.dim('Install a server from the registry')}`);
          console.log(`  ${pc.cyan('/mcp list')}             ${pc.dim('List installed servers')}`);
          console.log(`  ${pc.cyan('/mcp remove <name>')}    ${pc.dim('Remove an installed server')}`);
          console.log(`  ${pc.cyan('/mcp info <name>')}      ${pc.dim('Show server details')}`);
          console.log(`  ${pc.cyan('/mcp reconnect')}        ${pc.dim('Reconnect all enabled servers')}`);
          console.log(`  ${pc.cyan('/mcp enable <name>')}    ${pc.dim('Enable a disabled server')}`);
          console.log(`  ${pc.cyan('/mcp disable <name>')}   ${pc.dim('Disable a server without removing it')}`);
          console.log(`\n  ${pc.bold('Zero-config starters (no API keys needed):')}`);
          console.log(`  ${pc.gray('→')} ${pc.cyan('io.github/modelcontextprotocol/sequential-thinking')}  ${pc.dim('Step-by-step reasoning')}`);
          console.log(`  ${pc.gray('→')} ${pc.cyan('io.github/modelcontextprotocol/filesystem')}           ${pc.dim('Read/write files in allowed dirs')}`);
          console.log(`  ${pc.gray('→')} ${pc.cyan('io.github/modelcontextprotocol/memory')}               ${pc.dim('Persistent key-value store')}`);
          console.log(`  ${pc.gray('→')} ${pc.cyan('io.github/modelcontextprotocol/fetch')}                ${pc.dim('Fetch URLs and extract content')}`);
          console.log(`  ${pc.gray('→')} ${pc.cyan('io.github/modelcontextprotocol/puppeteer')}            ${pc.dim('Browser automation')}`);
          console.log(`  ${pc.gray('→')} ${pc.cyan('ai.ankimcp/anki-mcp-server')}                         ${pc.dim('Anki flashcard management')}`);
          console.log(`  ${pc.dim('  /mcp install <name> to install any of the above')}`);
          console.log();
      }
    }
  },
  {
    name: '/onboard',
    description: 'First-time setup — discover local models, configure, and test',
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
      config.router.chain = [entry, ...config.router.chain.filter((e: any) => e.endpoint !== chosenEndpoint)];
      saveConfig(config as any);

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
          const text = completion.choices?.[0]?.message?.content || '(no response)';
          console.log(pc.green(`\n✓ Response received in ${elapsed}ms:`));
          console.log(`  ${pc.white(text)}`);
        } catch (err: any) {
          console.log(pc.yellow(`\n⚠ Test failed: ${err.message}`));
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
    execute: async (args, ctx) => {
      if (!ctx.rl) {
        throw new Error('SWITCH_MODE_CLI');
      } else {
        throw new Error('SWITCH_MODE_TUI');
      }
    }
  },
  {
    name: 'exit',
    aliases: ['/exit', '/quit', 'quit'],
    description: 'Save session and exit',
    execute: async (args, ctx) => {
      const todos = getSessionTodos(ctx.toolContext.sessionId);
      ctx.sessionManager.saveSessionState(ctx.messages, ctx.activeFiles, todos);
      console.log(pc.dim('  [EXTRACT] Extracting facts from session...'));
      await extractAndSave(ctx.router, ctx.sessionManager, ctx.messages);
      console.log(pc.gray(`Session saved: ${ctx.sessionManager.sessionId}`));
      console.log(pc.yellow('\nEnding session. Goodbye!\n'));
      ctx.rl.close();
      process.exit(0);
    }
  }
];

export async function executeCommand(input: string, ctx: CommandContext): Promise<boolean> {
  const trimmed = input.trim();
  if (!trimmed) return false;

  const parts = trimmed.split(/\s+/);
  const commandName = parts[0].toLowerCase();
  const args = trimmed.substring(parts[0].length).trim();

  let mappedName = commandName;
  if (commandName === '?' || commandName === 'help') {
    mappedName = '/help';
  }

  const command = commandsList.find(c =>
    c.name.toLowerCase() === mappedName ||
    c.aliases?.some(alias => alias.toLowerCase() === mappedName)
  );

  if (command) {
    if (command.name === '/tui') {
      await command.execute(args, ctx);
      return true;
    }
    try {
      await command.execute(args, ctx);
    } catch (err: any) {
      console.log(pc.red(`[ERROR] Command ${command.name} failed: ${err.message}`));
    }
    return true; // Handled
  }

  if (trimmed.startsWith('/')) {
    console.log(pc.red(`[WARN] Unknown command: ${commandName}. Type /help or ? to view all available commands.`));
    return true; // We treated it as a command, so don't pass it to the model
  }

  return false; // Not a command
}
