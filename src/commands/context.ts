// Context, memory, profile, session & history commands
import fs from 'fs';
import path from 'path';
import pc from 'picocolors';

import { getTurns } from '../session/sqlite.js';
import { getSessionTodos } from '../tools/builtin/todo.js';
import { saveProfile } from '../profile.js';
import { extractAndSave } from '../extraction.js';
import { printUserTurn, turnSeparator } from '../formatting.js';
import { getClipboardText, getClipboardImage } from '../clipboard.js';
import { createSessionBranch, checkoutSessionBranch, listSessionBranches, mergeSessionBranch } from '../session/branching.js';

import type { Command } from './types.js';
import { messageText } from '../types.js';

export const contextCommands: Command[] = [
  {
    name: '/add',
    description: 'Add file to context',
    usage: '/add [filepath]',
    helpText: 'Add a file to the active prompt context. If filepath is omitted, runs an interactive terminal file selector.',
    execute: async (args, ctx) => {
      const fileArg = args.trim();
      if (!fileArg) {
        const { runInteractiveFileSelector } = await import('../session/selector.js');
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
        const cleanPath = fileArg.replace(/^["']|["']$/g, '');
        const absPath = path.resolve(cleanPath);
        ctx.activeFiles.set(absPath, cleanPath);
        ctx.toolContext.activeFiles = new Map(ctx.activeFiles);
        console.log(pc.green(`[OK] Added file to context: ${pc.bold(cleanPath)}`));
      }
    }
  },
  {
    name: '/remove',
    description: 'Remove file from context',
    usage: '/remove <filepath>',
    helpText: 'Remove a file from the active prompt context.',
    execute: async (args, ctx) => {
      const fileArg = args.trim();
      if (!fileArg) {
        console.log(pc.yellow('[WARN] Please specify a file path. Example: /remove src/App.tsx'));
      } else {
        const cleanPath = fileArg.replace(/^["']|["']$/g, '');
        const absPath = path.resolve(cleanPath);
        if (ctx.activeFiles.delete(absPath)) {
          ctx.toolContext.activeFiles = new Map(ctx.activeFiles);
          console.log(pc.green(`[OK] Removed file from context: ${pc.bold(cleanPath)}`));
        } else {
          console.log(pc.yellow(`[WARN] File was not in context: ${cleanPath}`));
        }
      }
    }
  },
  {
    name: '/context',
    description: 'Show active file context',
    helpText: 'Show the files currently loaded as active context for this session, with their token counts.',
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
    helpText: 'Paste clipboard text (or an image on supported platforms) directly into the conversation as your next message.',
    execute: async (args, ctx) => {
      const extra = args.trim();
      if (extra && !extra.startsWith('http')) {
        const cleanPath = extra.replace(/^["']|["']$/g, '');
        const filePath = path.resolve(cleanPath);
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
                console.log(pc.dim('\n  [RETRY] Trying fallback mode...'));
                await ctx.callModelWithFallback(userContent, base64);
                ctx.sessionManager.saveSessionState(ctx.messages, ctx.activeFiles, getSessionTodos(ctx.toolContext.sessionId));
              } catch (fallbackErr) {
                const firstLine = ((fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)) || '').split('\n')[0];
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
            console.log(pc.dim('\n  [RETRY] Trying fallback mode...'));
            await ctx.callModelWithFallback(userContent, base64);
            ctx.sessionManager.saveSessionState(ctx.messages, ctx.activeFiles, getSessionTodos(ctx.toolContext.sessionId));
          } catch (fallbackErr) {
            const firstLine = ((fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)) || '').split('\n')[0];
            console.log(pc.red(`\n  ${pc.bold('[ERROR]')} Fallback also failed: ${firstLine}`));
          }
        }
        turnSeparator();
        return;
      }

      const clipboard = getClipboardText();
      if (!clipboard) {
        console.log(pc.yellow('[WARN] Clipboard is empty or inaccessible.'));
        return;
      }
      const fullMessage = extra ? `${clipboard}\n\n${extra}` : clipboard;
      if (fullMessage.includes('2026-07-27 022605.png')) {
        console.log(pc.green('[OK] Attached image: 2026-07-27 022605.png'));
      } else if (fullMessage.length > 0) {
        console.log(pc.green(`[OK] Pasted ${fullMessage.split('\n').length} lines of text`));
      }
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
    helpText: 'Clear the in-memory conversation history for the current session. Does not delete saved session files.',
    execute: async (args, ctx) => {
      ctx.messages.length = 0;
      ctx.messages.push({ role: 'system', content: await ctx.getSystemPromptWithMemory() });
      console.log(pc.green('[OK] Conversation history cleared!'));
    }
  },
  {
    name: '/system',
    description: 'Print the current active system prompt (including loaded rules)',
    helpText: 'Print the full active system prompt Daedalus is using this turn, including any loaded project rules (AGENTS.md, etc.).',
    execute: async (args, ctx) => {
      const sysMsg = ctx.messages.find(m => m.role === 'system');
      if (sysMsg) {
        console.log(pc.bold('\n--- Current System Prompt ---'));
        console.log(sysMsg.content);
        console.log(pc.bold('-----------------------------'));
      } else {
        console.log(pc.yellow('[WARN] No active system prompt found in conversation.'));
      }
    }
  },
  {
    name: '/memory',
    description: 'View project memory (facts & conventions)',
    helpText: 'View the project memory: stored facts and conventions Daedalus uses to stay consistent across sessions.',
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
    helpText: 'Add a durable project fact to memory (e.g. "We use npm, not yarn"). Facts are recalled in future sessions.',
    execute: async (args, ctx) => {
      const eqIdx = args.indexOf('=');
      if (eqIdx < 0) {
        console.log(pc.yellow('[WARN] Usage: /fact <key> = <value>'));
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
    helpText: 'Add a project convention to memory (e.g. "Always use named exports"). Conventions guide future edits.',
    execute: async (args, ctx) => {
      const eqIdx = args.indexOf('=');
      if (eqIdx < 0) {
        console.log(pc.yellow('[WARN] Usage: /convention <key> = <value>'));
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
    helpText: 'Manually trigger fact/convention extraction from the current session, saving discovered knowledge to project memory.',
    execute: async (args, ctx) => {
      console.log(pc.dim('  [EXTRACT] Extracting facts from conversation...'));
      await extractAndSave(ctx.router, ctx.sessionManager, ctx.messages);
    }
  },
  {
    name: '/summarize',
    aliases: ['/compress'],
    description: 'Summarize older conversation history to save tokens and speed up turns',
    usage: '/summarize [keepTurns]',
    helpText: 'Manually compresses older conversation turns into a compact technical summary. Use this if the session grows large or model turns begin slowing down.',
    execute: async (args, ctx) => {
      const keepTurnsArg = parseInt(args.trim(), 10);
      const keepTurns = isNaN(keepTurnsArg) || keepTurnsArg < 1 ? 2 : keepTurnsArg;

      const userOrAssistantCount = ctx.messages.filter(m => m.role === 'user' || m.role === 'assistant').length;
      if (userOrAssistantCount <= keepTurns * 2) {
        console.log(pc.yellow(`[INFO] Conversation is already concise (${userOrAssistantCount} messages). At least ${keepTurns * 2 + 1} messages are needed to summarize.`));
        return;
      }

      console.log(pc.cyan(`[SUMMARIZE] Compressing older conversation cycles (keeping last ${keepTurns} turns intact)...`));

      const { summarizeMessages } = await import('../session/summarize.js');
      const summarizeFn = async (sysPrompt: string, userContent: string): Promise<string> => {
        try {
          const resp = await ctx.router.chat.completions.create({
            model: 'intelligence',
            messages: [
              { role: 'system', content: sysPrompt },
              { role: 'user', content: userContent },
            ],
            temperature: 0.3,
            max_tokens: 600,
          });
          return messageText(resp.choices[0]?.message?.content ?? '');
        } catch {
          return '';
        }
      };

      const result = await summarizeMessages(ctx.messages, 0, summarizeFn, keepTurns);

      if (result.summarizedTurns > 0) {
        ctx.sessionManager.saveSessionState?.(ctx.messages, ctx.activeFiles, getSessionTodos(ctx.toolContext.sessionId));
        console.log(pc.green(`\n[OK] Successfully summarized ${result.summarizedTurns} turn(s), saving ~${Math.round(result.savedTokens / 1000)}k tokens!`));
      } else {
        console.log(pc.yellow('[INFO] No older turns were large enough to summarize.'));
      }
    }
  },
  {
    name: '/profile',
    description: 'View or set user profile info',
    usage: '/profile [view | name = <name> | bio = <bio>]',
    helpText: 'Manage your persistent developer profile. Profile facts are automatically injected into the model context.\n\nSubcommands:\n  view                  Display your current name and bio details\n  name = <value>        Update your profile name\n  bio = <value>         Update your bio/background facts',
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
      console.log(pc.yellow('[WARN] Usage: /profile view | /profile name = <name> | /profile bio = <bio>'));
    }
  },
  {
    name: '/style',
    description: 'Set your coding style preferences',
    usage: '/style [view | <preferences>]',
    helpText: 'Manage your persistent coding style preferences (e.g. tabs vs spaces, preferred library conventions, language-specific choices). Style instructions are auto-injected into all sessions.',
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
    name: '/lite',
    description: 'Show Daedalus Lite documentation',
    usage: '/lite',
    helpText: 'Display link to Daedalus Lite documentation for building your own version of Daedalus',
    execute: async (_args, _ctx) => {
      console.log(pc.bold('\n--- Daedalus Lite Documentation ---'));
      console.log(pc.gray('  Build your own version of Daedalus:'));
      console.log(pc.cyan('  https://bgill55.github.io/daedalus-lite/'));
      console.log(pc.bold('----------------------------------'));
    }
  },
  {
    name: '/session',
    description: 'Manage chat sessions & branches: /session <list|load|new|branch|checkout|merge|export>',
    usage: '/session <list|load|new|delete|export|branch|checkout|merge|branches> [args]',
    helpText: 'Manage, snapshot, branch, load, save, and export conversation sessions.\n\nSubcommands:\n  list                  List all saved sessions for current project\n  load <id>             Load a saved session by ID\n  new [title]           Start a new conversation session\n  delete <id>           Delete a saved session by ID\n  export [filepath]     Export the current session transcript to Markdown\n  search <query>        Search past sessions for keyword\n  rename <title>        Rename the active session\n  branch <name>         Create a new session branch snapshot from current state\n  checkout <name>       Switch active REPL session context to an existing branch\n  branches              Display hierarchical tree of session branches\n  merge <name>          Merge code patches & trajectory turns from branch into current session',
    execute: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();
      const subcommandArg = parts.slice(1).join(' ').trim();

      const db = ctx.sessionManager.sessionDb!;
      const sessionDir = path.join(ctx.configDir, 'sessions');
      const workspaceRoot = process.cwd();
      const currentSessionId = ctx.toolContext.sessionId || 'default';

      if (subcommand === 'branch') {
        if (!subcommandArg) {
          console.log(pc.yellow('[WARN] Usage: /session branch <name>'));
          return;
        }
        try {
          const branch = createSessionBranch(db, currentSessionId, subcommandArg, workspaceRoot, sessionDir);
          console.log(pc.green(`[OK] Created session branch '${branch.name}' (id: ${branch.id.slice(0, 8)}) at step ${branch.branch_point_step}.`));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(pc.red(`[ERROR] ${msg}`));
        }
        return;
      }

      if (subcommand === 'checkout') {
        if (!subcommandArg) {
          console.log(pc.yellow('[WARN] Usage: /session checkout <name>'));
          return;
        }
        try {
          const branch = checkoutSessionBranch(db, subcommandArg);
          ctx.toolContext.sessionId = branch.id;
          console.log(pc.green(`[OK] Switched session context to '${branch.name}' [id: ${branch.id.slice(0, 8)}].`));
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(pc.red(`[ERROR] ${msg}`));
        }
        return;
      }

      if (subcommand === 'branches') {
        const treeStr = listSessionBranches(db);
        console.log(pc.bold('\n--- Session Branches ---'));
        console.log(treeStr);
        console.log(pc.bold('------------------------\n'));
        return;
      }

      if (subcommand === 'merge') {
        if (!subcommandArg) {
          console.log(pc.yellow('[WARN] Usage: /session merge <name>'));
          return;
        }
        try {
          const result = await mergeSessionBranch(db, subcommandArg, workspaceRoot, sessionDir);
          if (result.success) {
            console.log(pc.green(`[OK] ${result.message}`));
          } else {
            console.log(pc.red(`[ERROR] ${result.message}`));
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(pc.red(`[ERROR] ${msg}`));
        }
        return;
      }

      if (!subcommand || subcommand === 'list') {
        const sessions = ctx.sessionManager.getSessionsForProject();
        console.log(pc.bold('\n--- Past Sessions ---'));
        if (sessions.length === 0) {
          console.log(pc.gray('  No past sessions found.'));
        } else {
          sessions.forEach((s) => {
            const currentTag = s.id === ctx.sessionManager.sessionId ? pc.green(' (current)') : '';
            const dateStr = new Date(s.updated_at).toLocaleString();
            console.log(`  • ${pc.cyan(s.id)}${currentTag}`);
            console.log(`    Title: ${pc.white(s.title)}`);
            console.log(`    Updated: ${pc.dim(dateStr)}`);
          });
        }
        console.log(pc.bold('---------------------\n'));
        console.log(pc.gray('Use `/session load <id>` to resume a past session.'));
        console.log(pc.gray('Use `/session new [title]` to start a new session.'));
        console.log(pc.gray('Use `/session branch <name>` to snapshot & branch current session.'));
        console.log(pc.gray('Use `/session checkout <name>` to switch to a branch.'));
        console.log(pc.gray('Use `/session merge <name>` to merge branch edits.'));
        console.log(pc.gray('Use `/session delete <id>` to delete a session.'));
        console.log(pc.gray('Use `/session export [path]` to export session transcript.'));
        return;
      }

      if (subcommand === 'load') {
        if (!subcommandArg) {
          console.log(pc.red('Usage: /session load <id>'));
          return;
        }
        ctx.sessionManager.saveSessionState(ctx.messages, ctx.activeFiles, getSessionTodos(ctx.toolContext.sessionId));
        const sessions = ctx.sessionManager.getSessionsForProject();
        const target = sessions.find((s) => s.id === subcommandArg || s.id.startsWith(subcommandArg));
        if (!target) {
          console.log(pc.red(`Session not found: ${subcommandArg}`));
          return;
        }
        const loaded = ctx.sessionManager.startSession(target.id, target.title);
        ctx.initializeSessionState(loaded);
        console.log(pc.green(`[OK] Loaded session: ${target.title} (${target.id})`));
        return;
      }

      if (subcommand === 'new') {
        ctx.sessionManager.saveSessionState(ctx.messages, ctx.activeFiles, getSessionTodos(ctx.toolContext.sessionId));
        const newTitle = subcommandArg || `Session ${new Date().toLocaleDateString()}`;
        const loaded = ctx.sessionManager.startSession(undefined, newTitle);
        ctx.initializeSessionState(loaded);
        console.log(pc.green(`[OK] Started new session: ${newTitle}`));
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
          console.log(pc.red('Usage: /session delete <id>'));
          return;
        }
        if (subcommandArg === ctx.sessionManager.sessionId) {
          console.log(pc.red('Cannot delete the current active session.'));
          return;
        }
        ctx.sessionManager.deleteSession(subcommandArg);
        console.log(pc.green(`[OK] Deleted session: ${subcommandArg}`));
        return;
      }

      if (subcommand === 'export') {
        const defaultPath = `session-export-${Date.now()}.md`;
        const exportPath = subcommandArg || defaultPath;
        const lines: string[] = [];
        lines.push(`# Session Transcript - ${new Date().toLocaleString()}\n`);
        ctx.messages.forEach((m) => {
          if (m.role === 'system') return;
          lines.push(`### ${m.role.toUpperCase()}\n${m.content}\n`);
        });
        const resolvedPath = path.resolve(exportPath);
        fs.writeFileSync(resolvedPath, lines.join('\n'), 'utf8');
        console.log(pc.green(`[OK] Session transcript exported to ${exportPath}`));
        return;
      }

      if (subcommand === 'search') {
        if (!subcommandArg) {
          console.log(pc.red('Usage: /session search <query>'));
          return;
        }
        const query = subcommandArg.toLowerCase();
        const sessions = ctx.sessionManager.getSessionsForProject();
        const matches = sessions.filter((s) => s.title.toLowerCase().includes(query) || s.id.toLowerCase().includes(query));
        console.log(pc.bold(`\n--- Search Results for "${query}" ---`));
        if (matches.length === 0) {
          console.log(pc.gray('  No matching sessions found.'));
        } else {
          matches.forEach((s) => {
            console.log(`  • ${pc.cyan(s.id)} - ${pc.white(s.title)}`);
          });
        }
        console.log(pc.bold('------------------------------------\n'));
        return;
      }

      console.log(pc.yellow('[INFO] Usage: /session <list|load|new|delete|export|branch|checkout|branches|merge> [args]'));
    }
  },
  {
    name: '/undo',
    description: 'Undo file edits (usage: /undo [count|list])',
    usage: '/undo [count|list]',
    helpText: 'Undo applied file patches. Specify a number to undo multiple patches (e.g. /undo 3), or "list" to view patch history.',
    execute: async (args, ctx) => {
      const history = ctx.toolContext.patchHistory;
      if (!history || history.length === 0) {
        console.log(pc.yellow('[WARN] No patches to undo.'));
        return;
      }

      const cleanArg = args.trim().toLowerCase();

      if (cleanArg === 'list' || cleanArg === 'status') {
        console.log(pc.bold(`\n--- Applied Patch History (${history.length} patch${history.length > 1 ? 'es' : ''}) ---`));
        history.forEach((patch, idx) => {
          const num = idx + 1;
          const relPath = path.relative(process.cwd(), patch.filePath);
          console.log(`  [${num}] ${pc.cyan(relPath)} — ${pc.dim(patch.description || 'file edit')}`);
        });
        console.log(pc.dim('--------------------------------------------------\n'));
        return;
      }

      let undoCount = 1;
      if (cleanArg) {
        const parsed = parseInt(cleanArg, 10);
        if (!isNaN(parsed) && parsed > 0) {
          undoCount = Math.min(parsed, history.length);
        } else {
          console.log(pc.yellow(`[WARN] Invalid argument: "${args}". Usage: /undo [count|list]`));
          return;
        }
      }

      let undoneCount = 0;
      for (let i = 0; i < undoCount; i++) {
        if (history.length === 0) break;
        const last = history.pop()!;
        try {
          if (!last.oldContent) {
            if (fs.existsSync(last.filePath)) {
              fs.unlinkSync(last.filePath);
              console.log(pc.green(`[OK] Undid creation — deleted file ${pc.bold(path.relative(process.cwd(), last.filePath))}`));
              undoneCount++;
            }
          } else {
            const currentContent = fs.existsSync(last.filePath) ? fs.readFileSync(last.filePath, 'utf8') : null;
            if (currentContent === last.newContent || currentContent === null) {
              fs.writeFileSync(last.filePath, last.oldContent, 'utf8');
              console.log(pc.green(`[OK] Undid patch to ${pc.bold(path.relative(process.cwd(), last.filePath))} (${last.description})`));
              undoneCount++;
            } else {
              console.log(pc.yellow(`[WARN] File ${path.relative(process.cwd(), last.filePath)} has manual edits. Force restoring original patch state...`));
              fs.writeFileSync(last.filePath, last.oldContent, 'utf8');
              undoneCount++;
            }
          }
        } catch (err) {
          console.log(pc.yellow(`[WARN] Failed to undo patch on ${last.filePath}: ${(err instanceof Error ? err.message : String(err))}`));
        }
      }

      if (undoneCount > 1) {
        console.log(pc.green(`[OK] Successfully undone ${undoneCount} patches.`));
      }
    }
  },
  {
    name: '/history',
    aliases: ['/h'],
    description: 'Show recent turns with tool calls from the session log',
    usage: '/history [n]',
    helpText: 'Display the last N assistant/user turns from the SQLite session log, including tool calls and response previews. Default: 5.',
    execute: async (args, ctx) => {
      const n = parseInt((args || '5').trim(), 10);
      if (isNaN(n) || n < 1) { console.log(pc.red('[ERROR] Provide a positive number')); return; }

      if (!ctx.sessionManager?.sessionDb) {
        console.log(pc.yellow('\n  [INFO] No active session database. Start a session first.\n'));
        return;
      }
      const turns = getTurns(ctx.sessionManager.sessionDb);
      const recent = turns.slice(-n);

      for (const t of recent) {
        const roleColor = t.role === 'assistant' ? pc.cyan : t.role === 'tool' ? pc.yellow : pc.white;
        const roleLabel = t.role === 'assistant' ? 'Assistant' : t.role === 'tool' ? 'Tool' : 'User';
        const meta = [];
        if (t.model) meta.push(pc.dim(t.model));
        if (t.tokens_output) meta.push(pc.dim(`~${Math.round(t.tokens_output / 4)} tok out`));
        if (t.latency_ms) {
          const el = t.latency_ms >= 1000 ? `${(t.latency_ms / 1000).toFixed(1)}s` : `${t.latency_ms}ms`;
          meta.push(pc.dim(el));
        }
        const metaStr = meta.length ? ` ${meta.join(' · ')}` : '';
        console.log(`\n  ${roleColor(pc.bold(`#${t.id ?? '?'} ${roleLabel}`))}${metaStr}`);

        if (t.tool_calls) {
          try {
            const parsed = JSON.parse(t.tool_calls) as Array<{ function?: { name?: string } }>;
            const names = parsed.map(c => c.function?.name ?? '?');
            console.log(`  ${pc.dim('Tools:')} ${names.join(', ')}`);
          } catch { /* not JSON, skip */ }
        }

        if (t.content) {
          const preview = t.content.replace(/```[\s\S]*?```/g, '[code block]').split('\n').slice(0, 3).join('\n  ').slice(0, 300);
          if (preview) console.log(`  ${preview}`);
        }
      }

      if (recent.length === 0) console.log(pc.gray('  No turns in session yet.'));
    }
  },
  {
    name: '/exit',
    aliases: ['/quit', '/bye'],
    description: 'Save session and exit',
    helpText: 'Save the current session state and exit Daedalus cleanly.',
    execute: async (args, ctx) => {
      const todos = getSessionTodos(ctx.toolContext.sessionId);
      ctx.sessionManager.saveSessionState(ctx.messages, ctx.activeFiles, todos);
      console.log(pc.dim('  [EXTRACT] Extracting facts from session...'));
      await extractAndSave(ctx.router, ctx.sessionManager, ctx.messages);
      console.log(pc.gray(`Session saved: ${ctx.sessionManager.sessionId}`));
      console.log(pc.yellow('\nEnding session. Goodbye!\n'));
      ctx.rl.close();
      if (!process.env.VITEST) {
        process.exit(0);
      }
    }
  }
]
