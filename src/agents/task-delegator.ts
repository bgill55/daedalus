import fs from 'fs';
import path from 'path';
import pc from 'picocolors';
import { LocalRouter } from '../router/index.js';
import { BUILTIN_TOOLS } from '../tools/definitions.js';
import { getResolvedShellType } from '../tools/builtin/terminal.js';
import { mcpRegistry } from '../tools/mcp/registry.js';
import { getAgentRole, filterToolsForRole, roleLabel } from './roles.js';
import { ToolContext, PatchEntry } from '../types.js';
import { SessionManager } from '../session/manager.js';
import {
  cleanTaskText,
  extractFilePaths,
  extractRequirements,
  getFrameworkGuidance,
  orphanedModuleWarning,
} from './orchestrator-validation.js';
import {
  isDeclaredError,
  verifyArtifacts,
  verifyArtifactsThoroughly,
  checkPlaceholders,
  fillPlaceholders,
  buildCleanSummary,
  isBuildErrorRelated,
  generateBuildErrorHint,
  runBuildVerification,
  attemptRepair,
  rollbackTaskPatches,
  verifySpecAssertions,
} from './orchestrator-verification.js';
import { loadSpecContract, formatSpecForPromptSafe } from './spec.js';
import { SigmaMemEngine } from '../session/sigma-mem.js';
import { getSigmaMemories } from '../session/sqlite.js';
import type Database from 'better-sqlite3';
import type { DelegationTask, AgentResult } from './orchestrator-types.js';
import { SubAgentRunner } from './subagent-runner.js';

export interface TaskDelegatorOptions {
  createPlan?: (goal: string, projectContext?: string) => Promise<string>;
  parseDelegationTasks?: (plan: string, goal: string) => DelegationTask[];
  printTaskList?: (tasks: DelegationTask[], forceFull?: boolean) => void;
}

export class TaskDelegator {
  private router: LocalRouter;
  private toolContext: ToolContext;
  private sessionManager?: SessionManager;
  private modelOverride?: string;
  private subAgentRunner: SubAgentRunner;
  private options?: TaskDelegatorOptions;
  public results: AgentResult[] = [];

  constructor(
    router: LocalRouter,
    toolContext: ToolContext,
    sessionManager?: SessionManager,
    modelOverride?: string,
    subAgentRunner?: SubAgentRunner,
    options?: TaskDelegatorOptions,
  ) {
    this.router = router;
    this.toolContext = toolContext;
    this.sessionManager = sessionManager;
    this.modelOverride = modelOverride;
    this.subAgentRunner = subAgentRunner || new SubAgentRunner(router, toolContext, sessionManager, modelOverride);
    this.options = options;
  }

  getSubAgentRunner(): SubAgentRunner {
    return this.subAgentRunner;
  }

  findStyleReference(taskGoal: string): string | null {
    let dir = '';
    const fileMatch = taskGoal.match(/([A-Za-z0-9_\-/\\]+\.[a-zA-Z0-9]+)/);
    if (fileMatch) {
      dir = path.dirname(fileMatch[1].replace(/\\/g, '/'));
    } else {
      const dirMatch = taskGoal.match(/(?:in|at|to|under|inside)\s+(?:the\s+)?([A-Za-z0-9_\-/\\]{2,})(?:\s+(?:directory|folder|path))?/i);
      if (dirMatch) {
        dir = dirMatch[1].replace(/\\/g, '/').replace(/\/+$/, '');
      }
    }

    const checkDirForReference = (searchDir: string): { fullPath: string; content: string } | null => {
      if (!searchDir || !fs.existsSync(searchDir) || searchDir === '.') return null;
      let entries: string[];
      try { entries = fs.readdirSync(searchDir); } catch { return null; }
      const candidates = entries
        .filter(f => !f.startsWith('.') && !f.includes('.test.') && !f.includes('.spec.') && !f.startsWith('__'))
        .sort();

      const target = candidates.find(f => /\.(tsx?|jsx?|vue|svelte)$/i.test(f))
        || candidates.find(f => /\.(css|scss|less)$/i.test(f))
        || candidates[0];

      if (!target) return null;
      const fullPath = path.join(searchDir, target);
      if (fs.statSync(fullPath).isDirectory()) return null;
      try {
        let content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        if (lines.length > 80) {
          content = lines.slice(0, 80).join('\n') + '\n... (truncated)';
        }

        const isAppRouter = fs.existsSync(path.join(this.toolContext.projectRoot || process.cwd(), 'app'));
        const antiPatterns = [
          /legacyBehavior/,
          /^\s*<[A-Za-z]/m,
        ];
        if (isAppRouter) {
          antiPatterns.push(/import\s+React\s+from\s+['"]react['"]/);
        }
        if (antiPatterns.some(re => re.test(content))) return null;

        return { fullPath, content };
      } catch { return null; }
    };

    let ref = checkDirForReference(dir);
    if (ref) {
      return `\nExisting file in ${dir}/ (use as a style reference for structure and import order only):\n--- ${ref.fullPath} ---\n${ref.content}\n--- end ---`;
    }

    if (dir && dir !== '.' && dir !== '') {
      const parentDir = path.dirname(dir);
      ref = checkDirForReference(parentDir);
      if (ref) {
        return `\nExisting file in sibling/parent ${parentDir}/ (use as a style reference for structure and import order only):\n--- ${ref.fullPath} ---\n${ref.content}\n--- end ---`;
      }
    }

    const commonDirs = ['src/components', 'components', 'src/pages', 'pages', 'app', 'src', 'lib'];
    for (const commonDir of commonDirs) {
      const fullCommonDir = path.join(this.toolContext.projectRoot || process.cwd(), commonDir);
      ref = checkDirForReference(fullCommonDir);
      if (ref) {
        return `\nExisting file in ${commonDir}/ (use as a style reference for structure and import order only):\n--- ${ref.fullPath} ---\n${ref.content}\n--- end ---`;
      }
    }

    return null;
  }

  discoverDesignTokens(): string {
    const cwd = this.toolContext.projectRoot || process.cwd();
    let tokens = '';

    const twConfigs = ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs'];
    for (const configName of twConfigs) {
      const fullPath = path.join(cwd, configName);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const themeMatch = content.match(/theme\s*:\s*\{[\s\S]*?\}/);
          if (themeMatch) {
            tokens += `\nTailwind Theme Configuration (from ${configName}):\n${themeMatch[0]}\n`;
          } else {
            const lines = content.split('\n').slice(0, 40).join('\n');
            tokens += `\nTailwind Configuration Snippet (from ${configName}):\n${lines}\n`;
          }
          break;
        } catch { /* ignore */ }
      }
    }

    const commonCssDirs = ['src', 'app', 'styles', 'src/styles', '.'];
    const cssFileNames = ['globals.css', 'global.css', 'index.css', 'app.css', 'main.css'];
    for (const dirName of commonCssDirs) {
      for (const fileName of cssFileNames) {
        const fullPath = path.join(cwd, dirName, fileName);
        if (fs.existsSync(fullPath)) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            const rootMatches = content.match(/:root\s*\{[\s\S]*?\}/g);
            if (rootMatches && rootMatches.length > 0) {
              tokens += `\nDesign Tokens / CSS Variables (from ${dirName}/${fileName}):\n${rootMatches.join('\n')}\n`;
            }
            break;
          } catch { /* ignore */ }
        }
      }
      if (tokens) break;
    }

    return tokens;
  }

  pickMemoryCategory(task: DelegationTask): 'code_pattern' | 'fix_resolution' | 'schema_contract' | 'build_rule' {
    const goal = task.goal;
    if (task.role === 'debugger' || /fix|debug|repair|resolve/i.test(goal)) return 'fix_resolution';
    if (task.role === 'reviewer' || /verify|test|review|validate|inspect/i.test(goal)) return 'build_rule';
    if (task.role === 'planner' || /spec|contract|interface/i.test(goal)) return 'schema_contract';
    return 'code_pattern';
  }

  getTaskRelatedSigmaIds(db: Database.Database, activeIds: string[], task: DelegationTask): string[] {
    if (activeIds.length === 0) return [];
    const active = new Set(activeIds);
    const paths = extractFilePaths(task.goal).map(p => p.toLowerCase());
    const keywords = task.goal
      .split(/[^a-zA-Z0-9]+/)
      .map(k => k.toLowerCase())
      .filter(k => k.length >= 3);
    const hasOverlap = (tags: string[]): boolean => {
      for (const tag of tags) {
        const t = tag.toLowerCase();
        if (paths.some(p => p.includes(t) || t.includes(p))) return true;
        if (keywords.some(k => k.includes(t) || t.includes(k))) return true;
      }
      return false;
    };
    const related = new Set<string>();
    for (const row of getSigmaMemories(db, 0, 200)) {
      if (!active.has(row.id)) continue;
      let tags: string[] = [];
      try {
        const parsed = JSON.parse(row.tags);
        if (Array.isArray(parsed)) tags = parsed.map(String);
      } catch { /* unparseable tags */ }
      if (hasOverlap(tags)) related.add(row.id);
    }
    return activeIds.filter(id => related.has(id));
  }

  async delegateTask(task: DelegationTask, tasks?: DelegationTask[], goal?: string, projectContext?: string): Promise<void> {
    const role = getAgentRole(task.role);
    console.log(`\n[SPAWN] Delegating to ${roleLabel(role.name)}: ${task.goal}`);

    const tools = filterToolsForRole([...BUILTIN_TOOLS, ...mcpRegistry.getToolDefinitions()], task.role);
    const historyStartIndex = this.toolContext.patchHistory?.length || 0;

    const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    let enrichedContext = `Current date: ${currentDate}\n`;

    const projectRoot = this.toolContext.projectRoot || this.sessionManager?.projectRoot || process.cwd();
    const specContract = loadSpecContract(projectRoot);
    if (specContract) {
      enrichedContext += `\n${formatSpecForPromptSafe(specContract, projectRoot)}\n`;
    }

    const shellType = getResolvedShellType();
    if (shellType === 'bash') {
      enrichedContext += '\n[SHELL] Terminal commands run in BASH (git-bash/MSYS) on this Windows host. Use bash syntax ONLY — NOT PowerShell/cmd. Specifically: use "$" for variables (never "$null"), avoid "Select-String"/"Where-Object", and never use PowerShell "{ ... }" script blocks. Example: ls -la dir || echo "missing".\n';
    } else if (shellType === 'powershell') {
      enrichedContext += '\n[SHELL] Terminal commands run in POWERSHELL. Use PowerShell syntax ($, $null, Select-String are valid). Avoid bash-only constructs like "2>/dev/null" (use "2>$null").\n';
    } else {
      enrichedContext += '\n[SHELL] Terminal commands run in CMD (Windows command prompt). Use cmd.exe syntax (not bash, not PowerShell). Use "dir", "2>nul", "if exist".\n';
    }

    const frameworkBlock = projectContext
      ? `Follow the project framework conventions (e.g., Next.js pages go under pages/, Vue components under components/).\n`
      : '';

    const lessons = this.sessionManager ? this.sessionManager.getFailureLessons(task.role) : [];
    const topLesson = lessons.length > 0 ? lessons.sort((a, b) => ((b.used_count || 0) - (a.used_count || 0)))[0] : null;
    if (topLesson) {
      enrichedContext += `[LESSON] Previously failed on: "${topLesson.error_snippet}" -> resolution: ${topLesson.resolution} (occurred ${topLesson.used_count}x)\n`;
    }

    const styleRef = this.findStyleReference(task.goal);
    if (styleRef) {
      enrichedContext += styleRef;
    }

    if (task.role === 'coder') {
      const designTokens = this.discoverDesignTokens();
      if (designTokens) {
        enrichedContext += designTokens;
      }
    }

    const taskReqs = extractRequirements(task.goal);
    if (taskReqs.length > 0) {
      enrichedContext += `\nRequirements:\n${taskReqs.slice(0, 4).map(r => `  - ${r}`).join('\n')}\n`;
    }
    if (taskReqs.length > 0 && task.role === 'coder') {
      enrichedContext += `\nCRITICAL: You MUST implement every requirement above with real, specific content. Do NOT use generic filler like "Welcome to our platform", "We provide services", "Learn more about us", or placeholder text. Each requirement needs actual concrete content that a real business would publish.\n`;
    }

    const scopePaths = extractFilePaths(task.goal);
    if (scopePaths.length > 0) {
      enrichedContext += `\nSCOPE: only touch ${scopePaths.join(', ')}. Do NOT create a parallel module (e.g. a './foo/index.ts' beside an existing 'src/foo.ts') or expand into an unrelated refactor — if you find broken/duplicate adjacent code, fix the existing file in place.`;
    }

    const orphanWarn = this.toolContext.projectRoot
      ? orphanedModuleWarning(task.goal, this.toolContext.projectRoot)
      : null;
    if (orphanWarn) {
      enrichedContext += `\n${orphanWarn}`;
    }

    enrichedContext += `\n${frameworkBlock}${task.context}`;
    const frameworkRules = getFrameworkGuidance(projectContext, this.toolContext.projectRoot);
    
    let sigmaMemBlock = '';
    let activeSigmaMemoryIds: string[] = [];
    const sigmaDb = SigmaMemEngine.resolveProjectMemDb(this.sessionManager, this.toolContext.projectRoot);
    if (sigmaDb) {
      const sigmaRes = SigmaMemEngine.getPromptContext(sigmaDb, task.role, 0.60, 5, extractFilePaths(task.goal));
      sigmaMemBlock = sigmaRes.prompt;
      activeSigmaMemoryIds = sigmaRes.activeMemoryIds;
      SigmaMemEngine.markMemoriesUsed(sigmaDb, activeSigmaMemoryIds);
    }

    const systemExtra = `Project context:\n${projectContext || '(none discovered)'}${frameworkRules}${sigmaMemBlock}\n`;

    if (frameworkRules && task.role === 'coder') {
      enrichedContext = `IMPORTANT: The CODING RULES in your system context are mandatory and override any patterns you observe in style reference files or your training data.\n\n` + enrichedContext;
    }

    let result = await this.subAgentRunner.runAgent(role, task.goal, enrichedContext, tools, systemExtra);

    if (process.env.DAEDALUS_ENSEMBLE === 'true' && task.role === 'coder' && !this.toolContext.abortSignal.aborted) {
      const firstPatches = this.toolContext.patchHistory?.slice(historyStartIndex) || [];
      const firstCount = firstPatches.length;

      const secondRole = { ...role, temperature: 0.5 };
      const secondResult = await this.subAgentRunner.runAgent(secondRole, task.goal, enrichedContext, tools, systemExtra);

      const secondPatches = this.toolContext.patchHistory?.slice(historyStartIndex) || [];
      const secondCount = secondPatches.length;

      if (secondCount > firstCount) {
        result = secondResult;
      } else {
        if (this.toolContext.patchHistory) {
          this.toolContext.patchHistory.length = historyStartIndex + firstCount;
        }
      }
    }

    if (this.toolContext.abortSignal.aborted) {
      this.results.push({
        role: task.role,
        goal: task.goal,
        summary: 'Task aborted by user',
        success: false,
      });
      task.status = 'failed';
      task.error = 'Task aborted by user';
      return;
    }

    const MAX_TURNS_SIGNAL = 'Agent reached max turns';
    const PATCH_ABORT_PREFIX = 'Agent aborted: too many patch failures';
    if (result.startsWith(PATCH_ABORT_PREFIX)) {
      task.status = 'failed';
      task.error = result.split('\n')[0];
      if (task.role === 'coder' || task.role === 'debugger') {
        await rollbackTaskPatches(this.toolContext, historyStartIndex);
      }
      this.results.push({ role: task.role, goal: task.goal, summary: result, success: false });
      console.log(`[${pc.red('FAILED')}] ${role.name}: ${task.error}`);
      return;
    }
    if (result === MAX_TURNS_SIGNAL) {
      const partialWork = (this.toolContext.patchHistory?.length ?? 0) > historyStartIndex;
      const depth = task.splitDepth ?? 0;
      if (partialWork && depth < 3 && tasks && this.options?.createPlan && this.options?.parseDelegationTasks) {
        console.log(`\n${pc.yellow('Task exceeded turn limit with partial progress.')} Splitting remaining work (depth ${depth + 1})...`);

        const newPatches = this.toolContext.patchHistory?.slice(historyStartIndex) || [];
        const filesDone = [...new Set(newPatches.map(p => p.filePath).filter(Boolean))];

        task.status = 'completed';
        this.results.push({
          role: task.role,
          goal: task.goal,
          summary: 'Partially completed — splitting remaining work into sub-tasks',
          success: true,
        });

        const doneCtx = filesDone.length > 0 ? `\nPartially completed files: ${filesDone.join(', ')}` : '';

        const subPlan = await this.options.createPlan(
          `Continue the remaining work for: ${task.goal}${doneCtx}\nThe previous agent only got partial work done before hitting the turn limit. Break this into smaller, focused steps.`,
          projectContext
        );
        const subTasks = this.options.parseDelegationTasks(subPlan, goal || task.goal);
        const currentIndex = (tasks || []).indexOf(task);
        const doneBeforeSplit = (tasks || []).filter((t, idx) => t.status === 'completed' && idx < currentIndex);
        const deduped = subTasks.filter(st => {
          if (doneBeforeSplit.length === 0 || st.role !== 'coder') return true;
          const newPaths = extractFilePaths(st.goal).map(p => p.toLowerCase());
          if (newPaths.length === 0) return true;
          return !doneBeforeSplit.some(d => {
            if (d.role !== 'coder') return false;
            const donePaths = extractFilePaths(d.goal).map(p => p.toLowerCase());
            return donePaths.some(dp => newPaths.includes(dp));
          });
        });
        const inheritCtx = filesDone.length > 0
          ? `Original goal: ${task.goal}\nProject root: ${this.toolContext.projectRoot || process.cwd()}\n\nIMPORTANT — Files that were partially created and MUST be completed or replaced:\n${filesDone.map(f => `  - ${f}`).join('\n')}\n\nThe previous agent left these files incomplete before hitting the turn limit. You MUST read each file, then either complete it with a proper implementation or replace it entirely. Check the existing project structure first — use read_file on existing files to understand what's already there before creating new ones.`
          : `Original goal: ${task.goal}\nProject root: ${this.toolContext.projectRoot || process.cwd()}\n\nCheck the existing project structure first — use read_file on existing files to understand what's already there before creating new ones.`;
        for (const st of deduped) {
          st.status = 'pending';
          st.splitDepth = depth + 1;
          st.context = `${inheritCtx}\n\n${st.context}`;
          tasks.push(st);
        }

        if (this.options?.printTaskList) {
          this.options.printTaskList(tasks);
        }
        return;
      }

      task.status = 'failed';
      task.error = partialWork
        ? `Task still too large after ${depth} splits — manual review needed`
        : 'Task too large and no work completed';
      if (task.role === 'coder' || task.role === 'debugger') {
        await rollbackTaskPatches(this.toolContext, historyStartIndex);
      }
      this.results.push({
        role: task.role,
        goal: task.goal,
        summary: task.error,
        success: false,
      });
      return;
    }

    let verified = await verifyArtifacts(this.toolContext, task.role, task.goal, result, historyStartIndex);
    let evidence = '';
    let placeholderSites: string[] = [];
    let checkLogs = '';

    if (verified) {
      placeholderSites = await checkPlaceholders(this.toolContext, historyStartIndex);
      if (placeholderSites.length > 0) {
        console.log(pc.yellow(`\nFound ${placeholderSites.length} placeholder(s) in written files`));
        const filled = await fillPlaceholders(this.toolContext, historyStartIndex);
        if (filled > 0) {
          console.log(pc.green(`  Auto-filled ${filled} trivial placeholder(s) (year, name, etc.)`));
        }
        placeholderSites = await checkPlaceholders(this.toolContext, historyStartIndex);
        if (placeholderSites.length === 0) {
          verified = true;
        } else {
          verified = false;
        }
      }
    }

    if (verified && (task.role === 'coder' || task.role === 'debugger') && (this.toolContext.patchHistory?.length ?? 0) > historyStartIndex) {
      const checkResult = await runBuildVerification(this.toolContext, historyStartIndex);
      if (!checkResult.success) {
        const modifiedFiles = this.toolContext.patchHistory!.slice(historyStartIndex).map(p => p.filePath);
        const isRelated = isBuildErrorRelated(checkResult.errorLogs || '', modifiedFiles, this.toolContext.projectRoot);
        if (isRelated) {
          verified = false;
          checkLogs = (checkResult.errorLogs || 'Build check failed') + generateBuildErrorHint(checkResult.errorLogs || '');
        } else {
          console.log(pc.yellow(`\n[VERIFY] Build check failed, but errors appear to be in unrelated files. Ignoring build failure for this task.`));
        }
      }

      if (verified) {
        const specResult = await verifySpecAssertions(this.toolContext.projectRoot || process.cwd());
        if (!specResult.success) {
          console.log(pc.yellow(`\n[SpecFirst] Spec contract assertion check failed!`));
          verified = false;
          checkLogs = (specResult.errorLogs || 'Spec contract check failed');
        }
      }
    }

    if (!verified) {
      let repairCtx = task.context;
      if (placeholderSites.length > 0) {
        const siteList = placeholderSites.map(s => `  - ${s}`).join('\n');
        repairCtx += `\n\nPrevious attempt contained placeholders instead of real content:\n${siteList}\n\nYou MUST replace ALL placeholders with real content. Never output placeholder text like [Year], [Your Name], etc. Use actual values.`;
      }
      if (checkLogs) {
        repairCtx += `\n\nPrevious attempt failed build/compilation verification. The check failed with the following error output:\n\`\`\`\n${checkLogs}\n\`\`\`\nPlease fix the build/compilation errors listed above.`;
      }
      const repaired = await attemptRepair({ toolContext: this.toolContext, runAgent: (r, g, c, t) => this.subAgentRunner.runAgent(r, g, c, t) }, task, {
        summary: result,
      }, repairCtx, historyStartIndex);
      result = repaired.summary;
      verified = repaired.success;
      evidence = repaired.evidence || '';

      if (verified) {
        const stillPlaceholders = await checkPlaceholders(this.toolContext, historyStartIndex);
        if (stillPlaceholders.length > 0) {
          const filled = await fillPlaceholders(this.toolContext, historyStartIndex);
          if (filled > 0) console.log(pc.green(`  Auto-filled ${filled} remaining trivial placeholder(s)`));
          const remain = await checkPlaceholders(this.toolContext, historyStartIndex);
          if (remain.length > 0) {
            verified = false;
            evidence = `Placeholders remain: ${remain.join('; ')}`;
          }
        }
      }
    }

    const resultForCheck = result.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const success = verified && !isDeclaredError(resultForCheck) && verifyArtifactsThoroughly(this.toolContext, task.role, task.goal, resultForCheck, historyStartIndex);
    if (success) {
      const clean = buildCleanSummary(this.toolContext, task, result, historyStartIndex);
      if (clean) result = clean;

      if (this.sessionManager?.projectMemDb) {
        const related = this.getTaskRelatedSigmaIds(this.sessionManager.projectMemDb, activeSigmaMemoryIds, task);
        SigmaMemEngine.rewardSuccessfulPass(this.sessionManager.projectMemDb, related.length > 0 ? related : activeSigmaMemoryIds);
        SigmaMemEngine.recordVerifiedKnowledge(this.sessionManager.projectMemDb, {
          agentRole: task.role,
          category: this.pickMemoryCategory(task),
          tags: extractFilePaths(task.goal),
          summary: cleanTaskText(task.goal),
          content: result.slice(0, 300),
        });
      }
    }
    task.status = success ? 'completed' : 'failed';
    if (!success) {
      task.error = resultForCheck.split('\n')[0] || result.split('\n')[0] || 'Unknown failure';

      if (this.sessionManager?.projectMemDb) {
        const related = this.getTaskRelatedSigmaIds(this.sessionManager.projectMemDb, activeSigmaMemoryIds, task);
        if (related.length > 0) {
          SigmaMemEngine.penalizeFailedAttempt(this.sessionManager.projectMemDb, related, task.error?.slice(0, 280));
        }
      }

      if (task.role === 'coder' || task.role === 'debugger') {
        await rollbackTaskPatches(this.toolContext, historyStartIndex);
      }

      if (this.sessionManager) {
        try {
          this.sessionManager.saveFailureLesson({
            task_role: task.role,
            goal_keywords: task.goal.split(' ').slice(0, 5).join(' '),
            error_snippet: task.error.slice(0, 200),
            resolution: 'Pending — retry may succeed with different approach',
          });
        } catch { /* session not available */ }
      }
    }

    this.results.push({
      role: task.role,
      goal: task.goal,
      summary: result,
      success,
      ...(evidence ? { evidence } : {}),
    });

    if (success) {
      console.log(`[${pc.green('OK')}] ${role.name} completed`);
    } else {
      console.log(`[${pc.red('FAILED')}] ${role.name}: ${task.error || 'verification failed'}`);
    }

    if (success && this.sessionManager && task.role !== 'reviewer') {
      try {
        const reviewerRole = getAgentRole('reviewer');
        if (reviewerRole && !reviewerRole.canDelegate) {
          const touchedFiles = (this.toolContext.patchHistory || [])
            .filter((h: PatchEntry) => h.filePath)
            .map((h: PatchEntry) => h.filePath);
          const fileList = touchedFiles.length > 0
            ? `\nFILES_TOUCHED: ${touchedFiles.join(', ')}`
            : '';
          const truncatedResult = result.length > 6000 ? result.slice(0, 6000) + '\n...[result truncated for review]' : result;
          const reviewContext = `TASK: ${task.goal}\n\nAgent result:\n${truncatedResult}${fileList}\n\nReview the files that were touched for this task. Use git_diff or list files modified recently. Check for syntax errors, correctness, and project health.`;
          const reviewTools = filterToolsForRole([...BUILTIN_TOOLS, ...mcpRegistry.getToolDefinitions()], 'reviewer');
          const review = await this.subAgentRunner.runAgent(reviewerRole, `Review files from task: ${task.goal}`, reviewContext, reviewTools);

          const statusMatch = review.match(/STATUS:\s*(PASS|NEEDS_FIX|STOP)/i);
          const verdict = statusMatch?.[1]?.toUpperCase() || 'PASS';

          if ((verdict === 'NEEDS_FIX' || verdict === 'STOP') && (task.role === 'coder' || task.role === 'debugger')) {
            console.log(pc.yellow(`\n[REVIEWER] Found issues — triggering repair pass...`));
            const findingsMatch = review.match(/FINDINGS:([\s\S]*?)(?:RECOMMENDATION:|$)/i);
            const findings = findingsMatch?.[1]?.trim() || review;
            const repairGoal = `Fix the following reviewer findings in the files you just wrote for task: "${task.goal}"\n\nFINDINGS:\n${findings}\n\nApply targeted fixes only. Do not change unrelated code.`;
            const coderRole = getAgentRole('coder');
            if (coderRole) {
              const repairTools = filterToolsForRole([...BUILTIN_TOOLS, ...mcpRegistry.getToolDefinitions()], 'coder');
              await this.subAgentRunner.runAgent(coderRole, repairGoal, reviewContext, repairTools);
              console.log(pc.green(`[REPAIR] Repair pass complete.`));
            }
          }

          try {
            const buildStatus = /build.*pass|no errors|pass/i.test(review) ? 'passing' : 'needs_attention';
            this.sessionManager.saveProjectStatus({
              build_status: buildStatus,
              test_status: /test.*pass|no failures/i.test(review) ? 'passing' : 'unknown',
              key_concerns: review.split('\n').filter(l => /ERROR|FAIL|STOP|needs_fix/i.test(l)).slice(0, 3).join('; '),
              last_reviewed_at: Date.now(),
            });
          } catch { /* status save failed, non-critical */ }
        }
      } catch { /* review failed, non-critical */ }
    }
  }
}
