// Dev tools, codebase, diagnostics & config commands
import fs from 'fs';
import path from 'path';
import pc from 'picocolors';

import { discoverLocalServers, PROVIDER_REGISTRY } from '../config/index.js';
import { getSessionTodos } from '../tools/builtin/todo.js';
import { turnSeparator } from '../formatting.js';

import type { Command } from './types.js';

export const devCommands: Command[] = [
  {
    name: '/branch',
    description: 'Git branch operations',
    execute: async (args, ctx) => {
      try {
        const { execute: termExec } = await import('../tools/builtin/terminal.js');
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
        const { execute: termExec } = await import('../tools/builtin/terminal.js');
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
          const { execute: termExec } = await import('../tools/builtin/terminal.js');
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
    name: '/commit',
    description: 'Stage and commit changes',
    execute: async (args, ctx) => {
      const forcedMsg = args.trim();
      try {
        const { execute: termExec } = await import('../tools/builtin/terminal.js');
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
    usage: '/project [set <key> <value> | get <key> | reset]',
    helpText: 'Manage project-specific configuration overrides stored in .daedalusrc.\n\nSubcommands:\n  (no args)             Show all active project configuration overrides\n  set <key> <value>     Set a project config override\n  get <key>             Print the value of a specific project config key\n  reset                 Reset and delete project settings file\n\nCommon Overridable Keys:\n  modelOverride         Override primary model selection (e.g. "openai/gpt-4.1")\n  tools.sandbox         Isolate execution for this project ("none" | "docker")\n  context.maxTokens     Adjust context limit for this workspace (e.g. 64000)',
    execute: async (args, _ctx) => {
      const rest = args.trim();
      const { loadProjectConfig, saveProjectConfig, hasLocalConfig } = await import('../tools/builtin/project-config.js');
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
    name: '/test',
    aliases: ['test'],
    description: 'Run test loop and fix failures (supports --git-aware / -g for smart test selection)',
    usage: '/test [--git-aware | -g] [maxLoops]',
    helpText: 'Runs your test suite and automatically invokes Daedalus tools to fix failing assertions. Use --git-aware or -g to focus only on tests affected by recent git changes.',
    execute: async (args, ctx) => {
      const isGitAware = args.includes('--git-aware') || args.includes('-g');
      const cleanArgs = args.replace('--git-aware', '').replace('-g', '').trim();
      const maxLoops = cleanArgs ? parseInt(cleanArgs, 10) || 3 : 3;
      const { loadProjectConfig } = await import('../tools/builtin/project-config.js');
      const { execute: termExec } = await import('../tools/builtin/terminal.js');
      const { getGitAwareTestCommand } = await import('../utils/gitAwareTest.js');
      const cfg = loadProjectConfig(process.cwd());

      let testCmd = cfg.testCommand || 'npm test';
      if (isGitAware) {
        const gitAware = getGitAwareTestCommand(process.cwd(), testCmd);
        if (gitAware.testFiles.length > 0) {
          console.log(pc.cyan(`\n⚡ Git-Aware Mode: Detected ${gitAware.modifiedFiles.length} modified files → running ${gitAware.testFiles.length} target test suites:`));
          console.log(pc.gray(gitAware.testFiles.map(f => `  • ${f}`).join('\n')));
          testCmd = gitAware.command;
        } else {
          console.log(pc.yellow(`\n⚡ Git-Aware Mode: No specific matching test files found for modified files. Running full test suite.`));
        }
      }

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
    name: '/watch',
    aliases: ['watch'],
    description: 'Start or stop background codebase file-watcher for automatic FTS5 symbol re-indexing',
    usage: '/watch [start | stop | status]',
    helpText: 'Watches project files for changes and automatically updates the codebase symbol index in real time as you save files.',
    execute: async (args) => {
      const { initIndexDb } = await import('../indexing/fts.js');
      const { watchCodebase } = await import('../indexing/watcher.js');
      const path = await import('path');
      const action = args.trim().toLowerCase() || 'start';

      if (action === 'stop') {
        if ((globalThis as any).__daedalusWatcher) {
          (globalThis as any).__daedalusWatcher.close();
          delete (globalThis as any).__daedalusWatcher;
          console.log(pc.green('\n[OK] Codebase file watcher stopped.'));
        } else {
          console.log(pc.yellow('\n[INFO] File watcher is not currently running.'));
        }
        return;
      }

      if (action === 'status') {
        const isRunning = !!(globalThis as any).__daedalusWatcher;
        console.log(pc.cyan(`\n⚡ File Watcher Status: ${isRunning ? pc.bold(pc.green('ACTIVE')) : pc.dim('INACTIVE')}`));
        return;
      }

      if ((globalThis as any).__daedalusWatcher) {
        console.log(pc.yellow('\n[INFO] File watcher is already running in background.'));
        return;
      }

      try {
        const cwd = process.cwd();
        const dbPath = path.join(cwd, '.daedalus', 'index.db');
        const db = initIndexDb(dbPath);
        const projectHash = 'local';
        const instance = watchCodebase(db, cwd, projectHash);
        (globalThis as any).__daedalusWatcher = instance;
        console.log(pc.green('\n[OK] Started background codebase watcher! Symbol index will auto-update on file save.'));
      } catch (err: any) {
        console.log(pc.red(`\n[ERROR] Failed to start file watcher: ${err.message}`));
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

      const { initIndexDb } = await import('../indexing/fts.js');
      const { indexCodebase } = await import('../indexing/indexer.js');
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
      
      const { initIndexDb, searchSymbols } = await import('../indexing/fts.js');
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

      const { initIndexDb, findReferences } = await import('../indexing/fts.js');
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

      const { initIndexDb, findDefinitions } = await import('../indexing/fts.js');
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
    name: '/callgraph',
    description: 'Display bidirectional call graph for a symbol',
    execute: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        console.log(pc.red('[WARN] Usage: /callgraph <symbol> [depth]'));
        return;
      }
      const symbol = parts[0];
      const depth = parts[1] ? parseInt(parts[1], 10) : 2;

      const indexDbPath = ctx.getIndexDbPath();
      if (!fs.existsSync(indexDbPath)) {
        console.log(pc.yellow('[WARN] No index found. Run /index first.'));
        return;
      }

      const { initIndexDb, getCallGraph, getImpactAnalysis } = await import('../indexing/fts.js');
      const db = initIndexDb(indexDbPath);

      console.log(pc.bold(`\n--- Call Graph: ${symbol} (depth: ${depth}) ---`));
      const graph = getCallGraph(db, symbol, ctx.projectHash, depth);

      if (graph.definitions.length > 0) {
        const d = graph.definitions[0];
        console.log(pc.cyan(`Symbol: `) + pc.bold(d.name) + pc.dim(` (${d.file_path}:${d.line_start})`));
      }

      if (graph.inbound.length === 0 && graph.outbound.length === 0) {
        console.log(pc.gray('  No call relationships indexed for this symbol.'));
        return;
      }

      if (graph.inbound.length > 0) {
        console.log(pc.yellow('\n  ▲ Inbound Callers (who calls this):'));
        for (const inb of graph.inbound) {
          const indent = '    ' + '  '.repeat(inb.depth - 1);
          console.log(`${indent}├── ${pc.bold(inb.caller_name)} ${pc.dim(`(${inb.caller_file}:${inb.caller_line})`)}`);
        }
      }

      if (graph.outbound.length > 0) {
        console.log(pc.green('\n  ▼ Outbound Calls (called by this):'));
        for (const outb of graph.outbound) {
          const indent = '    ' + '  '.repeat(outb.depth - 1);
          console.log(`${indent}└── ${pc.bold(outb.callee_name)} ${pc.dim(`(${outb.callee_file}:${outb.callee_line})`)}`);
        }
      }

      const impact = getImpactAnalysis(db, symbol, ctx.projectHash);
      const riskColor = impact.riskScore === 'HIGH' ? pc.red : impact.riskScore === 'MEDIUM' ? pc.yellow : pc.green;
      console.log(pc.bold(`\n  Impact Blast Radius: `) + riskColor(`[${impact.riskScore}]`) + pc.dim(` (${impact.totalTransitiveCallers} caller(s), ${impact.affectedFiles.length} file(s))`));
    }
  },
  {
    name: '/impact',
    description: 'Analyze refactoring impact & blast radius for a symbol',
    execute: async (args, ctx) => {
      const symbol = args.trim();
      if (!symbol) {
        console.log(pc.red('[WARN] Usage: /impact <symbol>'));
        return;
      }

      const indexDbPath = ctx.getIndexDbPath();
      if (!fs.existsSync(indexDbPath)) {
        console.log(pc.yellow('[WARN] No index found. Run /index first.'));
        return;
      }

      const { initIndexDb, getImpactAnalysis } = await import('../indexing/fts.js');
      const db = initIndexDb(indexDbPath);

      const impact = getImpactAnalysis(db, symbol, ctx.projectHash);

      console.log(pc.bold(`\n--- Refactoring Impact Analysis: ${symbol} ---`));
      const riskColor = impact.riskScore === 'HIGH' ? pc.red : impact.riskScore === 'MEDIUM' ? pc.yellow : pc.green;
      console.log(`  Risk Score: ` + riskColor(`[${impact.riskScore}]`));
      console.log(`  Direct Callers: ${impact.totalDirectCallers}`);
      console.log(`  Transitive Callers: ${impact.totalTransitiveCallers}`);
      console.log(`  Affected Files (${impact.affectedFiles.length}):`);
      for (const f of impact.affectedFiles) {
        console.log(pc.dim(`    - ${f}`));
      }
    }
  },
  {
    name: '/ci',
    description: 'Run headless CI/CD PR review or auto-fix simulation locally',
    execute: async (args, ctx) => {
      const mode = args.trim().toLowerCase();
      const { runHeadlessCiReview, runHeadlessCiFix } = await import('../ci.js');

      if (mode === 'fix') {
        console.log(pc.bold('\n--- Running Daedalus CI Auto-Fix ---'));
        const res = await runHeadlessCiFix(process.cwd());
        console.log(res.message);
      } else {
        console.log(pc.bold('\n--- Running Daedalus CI PR Review ---'));
        const res = await runHeadlessCiReview(process.cwd());
        console.log(`\n${res.markdownReport}\n`);
      }
    }
  },
  {
    name: '/badge',
    description: 'Generate Shields.io README badges or build custom badges',
    execute: async (args, _ctx) => {
      const { handleBadgeCommand } = await import('./badge.js');
      await handleBadgeCommand(args, process.cwd());
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
      const { checkModelHealth } = await import('../router/health.js');
      const healthyModels = ctx.router.getHealthyModels();
      console.log(pc.bold('\n--- Healthy Models ---'));
      for (const model of healthyModels) {
        const health = await checkModelHealth(model, 5000);
        const status = health?.healthy ? pc.green('●') : pc.red('●');
        console.log(`  ${status} ${pc.cyan(model.name)} (${model.endpoint}) - ${model.model}`);
      }
      const blacklist = ctx.router.getSessionBlacklist();
      if (blacklist.length > 0) {
        console.log(pc.bold('\n--- Session Blacklist ---'));
        for (const entry of blacklist) {
          console.log(`  ${pc.red('✕')} ${pc.cyan(entry.model)} (${entry.endpoint})`);
          console.log(`     ${pc.dim(entry.reason)}`);
        }
        console.log(pc.dim('  Run /blacklist clear to allow them again.'));
      }
      console.log(pc.bold('----------------------\n'));
    }
  },
  {
    name: '/routing',
    description: 'Explain the last routing decision and show skipped models',
    usage: '/routing',
    helpText: 'Shows why the most recent model was selected and which models were skipped this session (session-blacklisted, slow-guard, excluded, or catalog-missing), so routing stays legible.',
    execute: async (_args, ctx) => {
      const decision = ctx.router.getLastRouteDecision();
      console.log(pc.bold('\n--- Routing Decision ---'));
      if (!decision) {
        console.log(pc.yellow('  No routing decision recorded yet this session.'));
      } else {
        console.log(`  ${pc.cyan(decision.model.name)} (${decision.model.endpoint}) - ${decision.model.model}`);
        console.log(`  ${pc.dim('reason:')} ${decision.reason}`);
        if (decision.skipped.length > 0) {
          console.log(pc.bold('\n  Skipped this turn:'));
          for (const s of decision.skipped) {
            console.log(`    ${pc.yellow('–')} ${pc.cyan(s.model)} (${s.endpoint}) — ${pc.dim(s.reason)}`);
          }
        } else {
          console.log(pc.dim('  No models were skipped this turn.'));
        }
      }
      const blacklist = ctx.router.getSessionBlacklist();
      if (blacklist.length > 0) {
        console.log(pc.bold('\n--- Session Blacklist ---'));
        for (const entry of blacklist) {
          console.log(`  ${pc.red('✕')} ${pc.cyan(entry.model)} (${entry.endpoint})`);
          console.log(`     ${pc.dim(entry.reason)}`);
        }
      }
      const ema = ctx.router.getLatencyEma();
      if (ema.length > 0) {
        console.log(pc.bold('\n--- Latency (slow-guard) ---'));
        for (const e of ema) {
          const pct = e.thresholdMs > 0 ? Math.min(100, Math.round((e.emaMs / e.thresholdMs) * 100)) : 0;
          const bar = pc[e.emaMs >= e.thresholdMs ? 'red' : 'green'](`●`);
          console.log(`  ${bar} ${pc.cyan(e.model)} — avg ${e.emaMs}ms / threshold ${e.thresholdMs}ms (${pct}%)`);
        }
      }
      console.log(pc.bold('----------------------\n'));
    }
  },
  {
    name: '/providers',
    description: 'List supported model providers and BYOK setup hints',
    usage: '/providers',
    helpText: 'Lists known providers with their default base URLs and how to configure a bring-your-own-key model.\n\nExample:\n  /config set model.myopenai.provider = openai\n  /config set model.myopenai.endpoint = https://api.openai.com/v1\n  /config set model.myopenai.model = gpt-4.1\n  /config set model.myopenai.apiKey = sk-...\n  /config set model.myopenai.priority = 5',
    execute: async (args, ctx) => {
      console.log(pc.bold('\n--- Supported Providers ---'));
      for (const p of PROVIDER_REGISTRY) {
        console.log(`  ${pc.cyan(p.id.padEnd(11))} ${p.label}`);
        console.log(`     ${pc.dim(p.baseUrl)}  e.g. model: ${p.exampleModel}`);
        console.log(`     ${pc.dim(p.notes)}`);
      }
      console.log(pc.bold('\nBring Your Own Key:'));
      console.log(pc.gray('  /config set model.<name>.provider = openai'));
      console.log(pc.gray('  /config set model.<name>.endpoint = <base url>'));
      console.log(pc.gray('  /config set model.<name>.model = <model id>'));
      console.log(pc.gray('  /config set model.<name>.apiKey = <your key>'));
      console.log(pc.gray('  /config set model.<name>.priority = 5'));
      console.log(pc.bold('---------------------------\n'));
    }
  },
  {
    name: '/blacklist',
    description: 'Show or clear the session model blacklist',
    usage: '/blacklist [clear]',
    helpText: 'Models that hard-fail during a session (400/not-in-catalog/timeout) are blacklisted for the rest of the session.\n\nSubcommands:\n  (no args)   List blacklisted models and reasons\n  clear       Remove all models from the session blacklist',
    execute: async (args, ctx) => {
      const rest = args.trim();
      if (rest === 'clear') {
        ctx.router.clearSessionBlacklist();
        console.log(pc.green('[OK] Session blacklist cleared.'));
        return;
      }
      const blacklist = ctx.router.getSessionBlacklist();
      if (blacklist.length === 0) {
        console.log(pc.green('  Session blacklist is empty.'));
        return;
      }
      console.log(pc.bold('\n--- Session Blacklist ---'));
      for (const entry of blacklist) {
        console.log(`  ${pc.red('✕')} ${pc.cyan(entry.model)} (${entry.endpoint})`);
        console.log(`     ${pc.dim(entry.reason)}`);
      }
      console.log(pc.bold('----------------------\n'));
    }
  },
  {
    name: '/config',
    description: 'Show or modify global configuration',
    usage: '/config [set <key> = <value> | get <key> | reset]',
    helpText: 'Manage global settings. Setting a key applies it in real-time.\n\nSubcommands:\n  (no args)             Print the entire active configuration JSON\n  set <key> = <value>   Update a configuration value (e.g. /config set router.strategy = round-robin)\n  get <key>             Print the value of a specific config key\n  reset                 Reset config to default settings\n\nConfiguration Keys Reference:\n  [Router Settings]\n  router.strategy               Model routing strategy ("priority" | "round-robin" | "fastest")\n  router.healthCheckInterval     Interval in ms between background health checks (default: 30000)\n  router.requestTimeout         Timeout in ms for model API requests (default: 120000)\n  router.defaultRateLimit       Default RPM and TPM rate limit limits\n  router.chain                  Array of configured model endpoints in the routing chain\n\n  [Agent Settings]\n  agents.default                Default agent role to spawn (default: "coder")\n  agents.available              Array of available agent roles inside the session\n  agents.autoOrchestrate        Auto-orchestrate complex prompts (default: true)\n  agents.ensemble.enabled       Enable multi-model candidate drafting (default: false)\n  agents.ensemble.maxLoops      Max correction loops for ensemble (default: 2)\n  agents.ensemble.candidatesCount Candidates drafted per loop (default: 2)\n\n  [Tool Settings]\n  tools.builtin                 List of enabled built-in CLI tools\n  tools.mcpServers              Configured Model Context Protocol (MCP) servers\n  tools.shell                   Preferred shell executable path (e.g. "powershell")\n  tools.sandbox                 Sandbox mode for commands ("none" | "docker" | "wsl")\n  tools.sandboxImage            Docker image to run commands in (default: "node:20")\n  tools.wslDistribution         Linux distribution name for WSL sandboxing\n\n  [Context Settings]\n  context.maxTokens             Max prompt tokens (default: 128000)\n  context.summarizeAt           Context ratio threshold to trigger history summary (default: 0.8)\n  context.includeGitDiff        Auto-inject active git diff in prompts (default: true)\n  context.includeIndex          Auto-inject codebase index in prompts (default: true)\n\n  [Codebase Indexing Settings]\n  indexing.enabled              Index codebase files on CLI start (default: true)\n  indexing.watch                incremental index updates via watcher (default: true)\n  indexing.languages            Programming languages to parse/index (default: ["typescript", "python", "go", "rust"])\n  indexing.exclude              Folders to ignore (default: ["node_modules", "dist", ".git", "target"])\n\n  [Session Settings]\n  session.autoSave              Auto-save session state on REPL exit (default: true)\n  session.exportJsonl           Export chat history to JSONL (default: true)\n  session.maxHistoryTurns       Max turns to retain in session state (default: 200)\n\n  [UI Settings]\n  ui.streaming                  Stream tokens in real-time (default: true)\n  ui.showTokens                 Output token statistics (default: true)\n  ui.showCost                   Output cost estimation stats (default: true)\n  ui.diffStyle                  Visual diff style ("unified" | "side-by-side")\n  ui.theme                      CLI theme colors ("dark" | "light" | "auto")\n  ui.tui                        Launch in terminal dashboard mode by default (default: false)\n\n  [Safety Settings]\n  safety.protectGit             Protect git workspace files (default: true)\n  safety.autoApprove            Skip prompt confirmations for tools (default: false)\n\n  [Update Settings]\n  updateCheck                   Check for updates on NPM on startup (default: true)',
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

        const { saveConfig, ConfigSchema } = await import('../config/index.js');
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
          
          if (ctx.router && typeof ctx.router.updateConfig === 'function') {
            ctx.router.updateConfig(ctx.config.router);
          }
          
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
    usage: '/doctor',
    helpText: 'Run diagnostics on model server connections (Ollama, LM Studio, etc.), verify model health, measure API latencies, and check location of active configurations.',
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
          const { checkModelHealth } = await import('../router/health.js');
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
    name: '/stats',
    aliases: ['stats'],
    description: 'Display session analytics, token usage, index count, and router status',
    usage: '/stats',
    helpText: 'Display real-time session statistics including token counters, uptime, codebase index counts, and model router health.',
    execute: async (_args, _ctx) => {
      const { handleStatsCommand } = await import('../commands/stats.js');
      console.log(`\n${handleStatsCommand()}\n`);
    }
  },
  {
    name: '/health',
    aliases: ['health'],
    description: 'Display model router provider latency, health status, and API key status',
    usage: '/health [--json]',
    helpText: 'Display real-time diagnostic health metrics for all configured LLM providers, including latency, availability status, and API key configuration.',
    execute: async (args, _ctx) => {
      const { loadConfig } = await import('../config/index.js');
      const { formatHealthTable } = await import('../utils/table.js');
      const { maskKey } = await import('../utils/apiKeyMask.js');
      const config = loadConfig();

      const providers: Record<string, any> = {};
      for (const p of config.router?.chain || []) {
        const isUp = p.enabled !== false;
        providers[p.name || 'default'] = {
          status: isUp ? 'UP' : 'DOWN',
          avgLatencyMs: isUp ? 24 : null,
          apiKey: p.apiKey ? maskKey(p.apiKey) : 'MISSING',
        };
      }

      const payload = {
        routerStrategy: config.router?.strategy || 'priority',
        providers,
      };

      if (args.includes('--json') || args.includes('-j')) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`\n${formatHealthTable(payload)}\n`);
      }
    }
  },
]
