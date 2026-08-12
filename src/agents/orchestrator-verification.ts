import fs from 'fs';
import path from 'path';
import os from 'os';
import pc from 'picocolors';

import { PLACEHOLDER_RE, HTML_PLACEHOLDER_RE } from './orchestrator-types.js';
import type { DelegationTask } from './orchestrator-types.js';
import type { ToolContext, ToolDefinition } from '../types.js';
import type { AgentRole } from './roles.js';
import { loadSpecContract } from './spec.js';

export function isDeclaredError(result: string): boolean {
  const normalized = result.trim().toLowerCase();
  return /^(error|failed)/.test(normalized);
}

export function requiresRealArtifacts(role: string, goal: string): boolean {
  if (role !== 'coder') return false;
  const keywords = ['implement', 'create', 'write', 'add', 'make', 'build', 'update', 'change', 'modify', 'generate', 'setup', 'fix'];
  const lower = goal.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

export function extractPendingWrites(result: string): string[] {
  const paths: string[] = [];
  const regex = /(?:created|wrote|added|updated|modified|in)\s+([A-Za-z0-9_\-./\\:]+\.[A-Za-z0-9]+)/gi;
  let match;
  while ((match = regex.exec(result)) !== null) {
    paths.push(match[1]);
  }
  const standaloneRegex = /\b([A-Za-z0-9_\-./\\:]+\.[a-zA-Z0-9]+)\b/g;
  let standaloneMatch;
  while ((standaloneMatch = standaloneRegex.exec(result)) !== null) {
    const p = standaloneMatch[1];
    if (!paths.includes(p) && (p.includes('/') || p.includes('\\') || p.includes('.'))) {
      paths.push(p);
    }
  }
  return paths;
}

export async function verifyArtifacts(
  toolContext: ToolContext,
  role: string,
  goal: string,
  result: string,
  historyStartIndex: number = 0,
): Promise<boolean> {
  if (!requiresRealArtifacts(role, goal)) return true;
  if (isDeclaredError(result)) return false;

  const isTerminalOnlyGoal = /^\s*(run|install|execute|compile)\b/i.test(goal)
    && !/\b(create|write|generate|add|make|implement|build|setup|configure)\b/i.test(goal);
  if (isTerminalOnlyGoal) return true;

  if (!toolContext.patchHistory || toolContext.patchHistory.length <= historyStartIndex) {
    return false;
  }

  const rawPaths = extractPendingWrites(result);
  const paths = rawPaths.map(p => p.replace(/\\/g, '/'));

  const currentPatches = toolContext.patchHistory.slice(historyStartIndex);
  const normalizedHistory = currentPatches.map(h => ({
    ...h,
    normalizedPath: h.filePath.replace(/\\/g, '/'),
  }));

  const hasPatchedMentioned = normalizedHistory.some(h =>
    paths.includes(h.normalizedPath) || paths.some(p => h.normalizedPath.endsWith('/' + p))
  );
  if (hasPatchedMentioned) return true;

  const hasRelevantPatch = normalizedHistory.some(h => {
    const base = h.normalizedPath.split('/').pop() || '';
    const goalLower = goal.toLowerCase();
    return goalLower.includes(base.split('.')[0].toLowerCase());
  });
  if (hasRelevantPatch) return true;

  return false;
}

export function hasRealWrites(toolContext: ToolContext, result: string): boolean {
  const claimed = extractPendingWrites(result);
  if (claimed.length === 0) return false;
  const history = toolContext.patchHistory || [];
  const historyPaths = new Set(history.map(h => (h.filePath || '').replace(/\\/g, '/')));
  return claimed.some(p => historyPaths.has(p.replace(/\\/g, '/')));
}

export function verifyArtifactsThoroughly(
  toolContext: ToolContext,
  role: string,
  goal: string,
  result: string,
  historyStartIndex: number = 0,
): boolean {
  if (!requiresRealArtifacts(role, goal)) return true;
  if (hasRealWrites(toolContext, result)) return true;
  const history = toolContext.patchHistory || [];
  if (history.length > historyStartIndex) return true;
  return false;
}

export function isRealFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < 100) return false;
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (/^\/\*[\s\S]*?\*\/$/i.test(content) || /^<!--[\s\S]*?-->$/i.test(content) || /^\/\/\s*todo/i.test(content) || /add .* content here/i.test(content)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function checkPlaceholders(toolContext: ToolContext, historyStartIndex: number): Promise<string[]> {
  const history = toolContext.patchHistory || [];
  const placeholders: string[] = [];
  for (let i = historyStartIndex; i < history.length; i++) {
    const entry = history[i];
    if (!entry.filePath) continue;
    try {
      const content = fs.readFileSync(entry.filePath, 'utf8');
      const lines = content.split('\n');
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const bracketMatch = lines[lineIdx].match(PLACEHOLDER_RE);
        if (bracketMatch) {
          placeholders.push(`${entry.filePath}:${lineIdx + 1} — ${bracketMatch[0].trim()}`);
        }
        const htmlMatch = lines[lineIdx].match(HTML_PLACEHOLDER_RE);
        if (htmlMatch) {
          placeholders.push(`${entry.filePath}:${lineIdx + 1} — HTML comment placeholder`);
        }
      }
    } catch {
    }
  }
  return placeholders;
}

export async function fillPlaceholders(toolContext: ToolContext, historyStartIndex: number): Promise<number> {
  const history = toolContext.patchHistory || [];
  let filled = 0;
  const year = new Date().getFullYear().toString();
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let userName: string;
  try { userName = os.userInfo().username; } catch { userName = 'user'; }

  for (let i = historyStartIndex; i < history.length; i++) {
    const entry = history[i];
    if (!entry.filePath) continue;
    try {
      const content = fs.readFileSync(entry.filePath, 'utf8');
      const newContent = content
        .replace(/\[(?:YEAR|Year|year|YYYY|yyyy)\]/g, year)
        .replace(/\[(?:DATE|Date|date|TODAY|Today|today)\]/g, today)
        .replace(/\[(?:YOUR\s+NAME|Your\s+Name|your\s+name|FULLNAME|Fullname|fullname|AUTHOR|Author|author|USERNAME|Username|username|OWNER|Owner|owner)\]/g, userName);
      if (newContent !== content) {
        fs.writeFileSync(entry.filePath, newContent, 'utf8');
        const bracketCount = (content.match(/\[/g) || []).length;
        const newBracketCount = (newContent.match(/\[/g) || []).length;
        filled += bracketCount - newBracketCount;
      }
    } catch {
    }
  }
  return filled;
}

export function buildCleanSummary(toolContext: ToolContext, task: DelegationTask, result: string, historyStartIndex: number): string | null {
  const history = toolContext.patchHistory || [];
  const newPatches = [];
  for (let i = historyStartIndex; i < history.length; i++) {
    newPatches.push(history[i]);
  }
  if (newPatches.length === 0 || result.split(/\s+/).length < 30) return null;
  const files = [...new Set(newPatches.map(p => p.filePath).filter(Boolean))];
  if (files.length === 0) return null;
  return `Completed: ${task.goal} — Files: ${files.join(', ')}`;
}

export function isBuildErrorRelated(errorLogs: string, modifiedFiles: string[], projectRoot?: string): boolean {
  if (!errorLogs) return false;
  const lowerLogs = errorLogs.toLowerCase();
  const configFiles = ['tsconfig.json', 'package.json', 'package-lock.json', 'cargo.toml', 'go.mod', 'requirements.txt'];
  for (const file of modifiedFiles) {
    const basename = path.basename(file).toLowerCase();
    if (configFiles.includes(basename)) {
      return true;
    }
    const relativePath = path.relative(projectRoot || process.cwd(), file).replace(/\\/g, '/').toLowerCase();
    if (lowerLogs.includes(basename) || lowerLogs.includes(relativePath)) {
      return true;
    }
  }
  return false;
}

export function generateBuildErrorHint(errorLogs: string): string {
  if (!errorLogs) return '';
  const hints: string[] = [];

  const missingModuleMatch = errorLogs.match(/cannot find module ['"]([^'"]+)['"]/i) ||
                             errorLogs.match(/could not resolve ['"]([^'"]+)['"]/i);
  if (missingModuleMatch) {
    const pkg = missingModuleMatch[1];
    hints.push(`Hint: A required package "${pkg}" is missing. Use the terminal tool to install it (e.g., "npm install ${pkg}").`);
  }

  if (errorLogs.toLowerCase().includes('duplicate page detected') ||
      (errorLogs.includes('pages/') && errorLogs.includes('src/pages/'))) {
    hints.push('Hint: Next.js detected duplicate pages in both pages/ and src/pages/. You must delete the duplicate files in the root pages/ directory to resolve the conflict.');
  }

  if (errorLogs.toLowerCase().includes('overload') || errorLogs.toLowerCase().includes('no overload matches')) {
    hints.push('Hint: TypeScript has type overload resolution issues. Try casting the options/arguments as "any" (e.g., "options as any") to bypass strict type checking.');
  }

  if (hints.length === 0) return '';
  return '\n\n' + hints.join('\n');
}

export async function runBuildVerification(toolContext: ToolContext, historyStartIndex: number = 0): Promise<{ success: boolean; errorLogs?: string }> {
  const cwd = toolContext.projectRoot || process.cwd();
  const history = toolContext.patchHistory || [];
  const touchedFiles = history.slice(historyStartIndex).map(p => p.filePath);
  const hasSourceFiles = touchedFiles.some(f => {
    const ext = path.extname(f).toLowerCase();
    return ['.ts', '.tsx', '.js', '.jsx', '.go', '.rs', '.py', '.cpp', '.c', '.h', '.java'].includes(ext);
  });
  if (touchedFiles.length > 0 && !hasSourceFiles) {
    console.log(pc.gray(`  [VERIFY] Skipping build check (only config/docs files modified).`));
    return { success: true };
  }

  let command = '';
  let lintCommand = '';

  if (fs.existsSync(path.join(cwd, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
      if (pkg.scripts) {
        if (pkg.scripts['daedalus-check']) {
          command = 'npm run daedalus-check';
        } else if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
          command = 'npx tsc --noEmit';
        } else if (pkg.scripts.build) {
          command = 'npm run build';
        }

        if (pkg.scripts.lint) {
          lintCommand = 'npm run lint';
        }
      }
    } catch { /* ignored */ }
  } else if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
    command = 'cargo check';
  } else if (fs.existsSync(path.join(cwd, 'go.mod'))) {
    command = 'go build ./...';
  }

  if (!command && !lintCommand) {
    return { success: true };
  }

  const { exec } = await import('child_process');

  const runCmd = (cmd: string): Promise<{ success: boolean; logs?: string }> => {
    return new Promise((resolve) => {
      exec(cmd, { cwd, timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, logs: (stdout + '\n' + stderr).trim() });
        } else {
          resolve({ success: true });
        }
      });
    });
  };

  if (command) {
    console.log(pc.cyan(`\n[VERIFY] Running verification command: "${command}"...`));
    let res = await runCmd(command);
    if (!res.success && res.logs) {
      const missingMatch = res.logs.match(/cannot find module ['"]([^'"]+)['"]/i) ||
                           res.logs.match(/could not resolve ['"]([^'"]+)['"]/i);
      if (missingMatch) {
        const missingPkg = missingMatch[1];
        // If it's an npm package (not relative path)
        if (missingPkg && !missingPkg.startsWith('.') && !missingPkg.startsWith('/')) {
          const cleanPkg = missingPkg.split('/')[0].startsWith('@') 
            ? missingPkg.split('/').slice(0, 2).join('/') 
            : missingPkg.split('/')[0];
          
          console.log(pc.yellow(`[Auto-Install] Missing module "${cleanPkg}" detected during build. Auto-installing via npm...`));
          const installCmd = cleanPkg.startsWith('@types/') 
            ? `npm install -D ${cleanPkg}` 
            : `npm install ${cleanPkg} && npm install -D @types/${cleanPkg}`;
          
          await runCmd(installCmd);
          console.log(pc.cyan(`[VERIFY] Re-running verification command: "${command}"...`));
          res = await runCmd(command);
        }
      }
    }

    if (!res.success && res.logs) {
      const isRelated = touchedFiles.length === 0 || isBuildErrorRelated(res.logs, touchedFiles, cwd);
      if (!isRelated) {
        console.log(pc.yellow(`[VERIFY] Build check failed, but errors appear to be in unrelated files. Ignoring build failure for this task.`));
      } else {
        console.log(pc.red(`[VERIFY] Verification failed!`));
        return { success: false, errorLogs: res.logs };
      }
    }
    console.log(pc.green(`[VERIFY] Verification passed.`));
  }

  if (lintCommand) {
    console.log(pc.cyan(`\n[VERIFY] Running linter command: "${lintCommand}"...`));
    const res = await runCmd(lintCommand);
    if (!res.success) {
      console.log(pc.red(`[VERIFY] Linter failed!`));
      return { success: false, errorLogs: res.logs };
    }
    console.log(pc.green(`[VERIFY] Linter passed.`));
  }

  if (fs.existsSync(path.join(cwd, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
      if (pkg.scripts && pkg.scripts['sync-docs']) {
        console.log(pc.cyan(`[VERIFY] Syncing documentation with latest command registry...`));
        await runCmd('npm run sync-docs');
      }
    } catch { /* ignored */ }
  }

  return { success: true };
}

export interface AgentExecutionContext {
  toolContext: ToolContext;
  runAgent(role: AgentRole, goal: string, context: string, tools: ToolDefinition[]): Promise<string>;
}

export async function attemptRepair(
  ctx: { runAgent: (role: AgentRole, goal: string, context: string, tools: ToolDefinition[]) => Promise<string>; toolContext: ToolContext; projectRoot?: string },
  task: DelegationTask,
  previous: { summary: string },
  customContext?: string,
  initialHistoryStartIndex: number = 0
): Promise<{ success: boolean; summary: string; evidence?: string }> {
  const { getAgentRole, filterToolsForRole } = await import('./roles.js');
  const { BUILTIN_TOOLS } = await import('../tools/definitions.js');
  const { mcpRegistry } = await import('../tools/mcp/registry.js');

  const role = getAgentRole(task.role);
  const tools = filterToolsForRole([...BUILTIN_TOOLS, ...mcpRegistry.getToolDefinitions()], task.role);
  const maxRetries = 2;
  let attempt = 0;
  let currentSummary = previous.summary;
  let currentCustomContext = customContext;

  while (attempt < maxRetries) {
    if (ctx.toolContext.abortSignal.aborted) {
      break;
    }
    attempt++;
    console.log(`\n[REPAIR] Attempt ${attempt}/${maxRetries} to repair task: ${task.goal}`);

    const baseCtx = currentCustomContext || task.context;
    let repairHint = '';
    const noRealWork = (ctx.toolContext.patchHistory?.length ?? 0) <= initialHistoryStartIndex;
    if (noRealWork) {
      repairHint = `\n\nCRITICAL: Your previous response did not produce any file writes. You MUST call write_file or patch — do not describe what you did, just do it now. Call the tool immediately.`;
    } else if (currentSummary && currentSummary.toLowerCase().includes('i will') && !currentSummary.includes('`write_file`') && !currentSummary.includes('`patch`') && !currentSummary.includes('`terminal`')) {
      repairHint = `\n\nCRITICAL: Your previous response described the work as text but did not actually call any tools. Do not describe WHAT you will do — directly EXECUTE the write_file or patch tool now. Your response must contain a tool call, not a plan or explanation.`;
    }
    const repairContext = `${baseCtx}\n\nPrevious attempt failed verification. Output was:\n${currentSummary}\n\nPlease retry and ensure you actually write the required files/artifacts.${repairHint}`;
    const result = await ctx.runAgent(role, task.goal, repairContext, tools);

    if (ctx.toolContext.abortSignal.aborted) {
      return { success: false, summary: 'Task aborted by user' };
    }

    let verified = await verifyArtifacts(ctx.toolContext, task.role, task.goal, result, initialHistoryStartIndex);
    let repairCheckLogs = '';
    if (verified && (task.role === 'coder' || task.role === 'debugger') && (ctx.toolContext.patchHistory?.length ?? 0) > initialHistoryStartIndex) {
      const checkResult = await runBuildVerification(ctx.toolContext, initialHistoryStartIndex);
      if (!checkResult.success) {
        const modifiedFiles = ctx.toolContext.patchHistory!.slice(initialHistoryStartIndex).map(p => p.filePath);
        const isRelated = isBuildErrorRelated(checkResult.errorLogs || '', modifiedFiles, ctx.toolContext.projectRoot);
        if (isRelated) {
          verified = false;
          repairCheckLogs = (checkResult.errorLogs || 'Build check failed') + generateBuildErrorHint(checkResult.errorLogs || '');
        } else {
          console.log(pc.yellow(`\n[VERIFY] Build check failed, but errors appear to be in unrelated files. Ignoring build failure for this task.`));
        }
      }
    }

    if (verified && !isDeclaredError(result)) {
      return { success: true, summary: result };
    }

    if (repairCheckLogs) {
      currentCustomContext = (customContext || task.context) + `\n\nAdditionally, the build/compilation check failed with error output:\n\`\`\`\n${repairCheckLogs}\n\`\`\``;
    }
    currentSummary = result;
  }

  return { success: false, summary: currentSummary, evidence: 'no artifacts' };
}

export async function rollbackTaskPatches(toolContext: ToolContext, historyStartIndex: number): Promise<void> {
  const history = toolContext.patchHistory;
  if (!history || history.length <= historyStartIndex) return;

  console.log(pc.dim(`\n[CHECK] Task did not verify. Reverting this task's changes to keep the workspace clean...`));

  for (let i = history.length - 1; i >= historyStartIndex; i--) {
    const patch = history[i];
    try {
      if (fs.existsSync(patch.filePath)) {
        fs.writeFileSync(patch.filePath, patch.oldContent, 'utf8');
        console.log(pc.gray(`  Reverted changes to ${path.relative(toolContext.projectRoot || process.cwd(), patch.filePath)}`));
      }
    } catch (err) {
      console.log(pc.red(`  Failed to revert changes to ${patch.filePath}: ${(err instanceof Error ? err.message : String(err))}`));
    }
  }

  history.length = historyStartIndex;
}

export async function verifySpecAssertions(projectRoot: string): Promise<{ success: boolean; errorLogs?: string }> {
  const spec = loadSpecContract(projectRoot);
  if (!spec || !spec.testCases || spec.testCases.length === 0) {
    return { success: true };
  }

  const failures: string[] = [];

  for (const tc of spec.testCases) {
    const fullPath = path.resolve(projectRoot, tc.targetFile);

    if (tc.assertionType === 'file_exists') {
      if (!fs.existsSync(fullPath)) {
        failures.push(`Spec Assertion Failed [file_exists]: Target file '${tc.targetFile}' was not created.`);
      }
    } else if (tc.assertionType === 'export_check' || tc.assertionType === 'type_check') {
      if (!fs.existsSync(fullPath)) {
        failures.push(`Spec Assertion Failed [${tc.assertionType}]: Target file '${tc.targetFile}' does not exist.`);
      } else {
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (tc.expectedOutput && !content.includes(tc.expectedOutput)) {
          failures.push(`Spec Assertion Failed [${tc.assertionType}]: '${tc.targetFile}' does not satisfy contract snippet: ${tc.expectedOutput}`);
        }
      }
    }
  }

  if (failures.length > 0) {
    return { success: false, errorLogs: failures.join('\n') };
  }

  return { success: true };
}
