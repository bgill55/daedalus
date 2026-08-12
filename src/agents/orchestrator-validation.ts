import fs from 'fs';
import path from 'path';

import type { DelegationTask } from './orchestrator-types.js';

export function filterValidTasks(tasks: DelegationTask[]): DelegationTask[] {
  const doneRe = /\b(open|launch|start|run|execute)\b.*\b(file|editor|IDE|app|application|browser|window)\b|\b(commit|push|pull|merge)\b|\b(researcher)\b.*\b(identify and install)\b/i;
  const filtered = tasks.filter(t => !doneRe.test(t.goal));
  const metaRe = /\b(save changes|save the file|ensure that|ensure the)\b/i;
  const metaSaveRe = /(?:save|write)\s+the\s+(?:changes|file)/i;
  const guiTestRe = /\b(cypress|playwright|puppeteer|selenium)\b/i;
  const fileSimpleRe = /\b(create|write|build|make|generate|add)\b.*\b(file|component|page|layout|module|function|class|route)\b/i;
  const pathRe = /([a-z0-9_\-./\\:]+\\.[a-z0-9]+)/i;

  const seen = new Map<string, DelegationTask>();
  const out: DelegationTask[] = [];

  for (const t of filtered) {
    const rawGoal = t.goal;
    const cleanedGoal = cleanTaskText(rawGoal) || rawGoal;

    if (doneRe.test(cleanedGoal)) continue;
    if (metaRe.test(cleanedGoal)) continue;
    if (metaSaveRe.test(cleanedGoal)) continue;
    if (guiTestRe.test(cleanedGoal)) continue;
    if (/\b(open|view|check)\b/i.test(cleanedGoal) && cleanedGoal.length < 25) continue;

    const lower = cleanedGoal.toLowerCase();
    if (t.role === 'coder') {
      const pathMatch = lower.match(pathRe);
      const key = pathMatch ? `${t.role}:${pathMatch[1]}` : `${t.role}:${lower}`;

      if (seen.has(key)) {
        const existing = seen.get(key)!;
        if (cleanedGoal.length > existing.goal.length) existing.goal = cleanedGoal;
        continue;
      }
      seen.set(key, t);

      const isSimpleFileTask = fileSimpleRe.test(lower);
      if (isSimpleFileTask) {
        const simpleFileCount = out.filter(o => {
          if (o.role !== 'coder') return false;
          const p = o.goal.toLowerCase().match(pathRe);
          return p && pathMatch && p[1] === pathMatch[1];
        }).length;
        if (simpleFileCount >= 2) continue;
      }
    }

    t.goal = cleanedGoal;
    out.push(t);
  }

  return out;
}

export function stripCodeBlocks(text: string): string {
  let result = text.replace(/```[\s\S]*?```/g, '').trim();
  result = result.replace(/`([^`]+)`/g, '$1').trim();
  return result;
}

export function stripToolRequestArtifacts(text: string): string {
  let result = text.replace(/\[TOOL_REQUEST\][\s\S]*?\[END_TOOL_REQUEST\]/gi, '').trim();
  result = result.replace(/[:\s]+$/g, '').trim();
  return result;
}

export const VAGUE_GOAL_RE = /\b(add the necessary|add the required|install the necessary|install the required|appropriate packages|suitable packages)\b/i;

export function isComplexGoal(goal: string): boolean {
  const lines = goal.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const hasBullets = lines.filter(l => /^[-*•\d+]/.test(l)).length >= 2;
  const isLong = goal.length > 400;
  return hasBullets || isLong;
}

export function cleanTaskText(text: string): string {
  const withoutBlocks = stripCodeBlocks(text);
  const withoutToolRequests = stripToolRequestArtifacts(withoutBlocks);
  return withoutToolRequests || withoutBlocks || text;
}

export function cleanPlanOutput(text: string): string {
  return stripToolRequestArtifacts(text);
}

export function truncateGoal(text: string): string {
  if (text.length <= 200) return text;
  return text.slice(0, 197) + '...';
}

export function extractFilePaths(text: string): string[] {
  const re = /(?:^|\s)([a-z0-9_\-./\\]+(\.[a-z0-9]+){1,2})/gi;
  const matches = new Set<string>();
  let m;
  while ((m = re.exec(text)) !== null) {
    matches.add(m[1].trim());
  }
  return Array.from(matches);
}

// Spec-contract test intent: the planner must EXPLICITLY name a test file as a
// deliverable for this task, not just mention the word "tests". A goal like
// "implement the feature and add tests" must NOT disarm the test-suite lock;
// only a goal that references a concrete test file (tests/foo.test.ts,
// src/__tests__/bar.spec.js, *.test.tsx, etc.) does.
const TEST_FILE_RE = /(^|[\s/\\])(__tests__|tests?|spec|test)[\\/]|(\.(test|spec))\.(ts|tsx|js|jsx|mjs|cjs)$/i;
export function planNamesTestFiles(text: string): boolean {
  return extractFilePaths(text).some((p) => TEST_FILE_RE.test(p));
}

export function buildDependencyGraph(tasks: DelegationTask[]): DelegationTask[] {
  for (const task of tasks) {
    const deps: string[] = [];
    const paths = extractFilePaths(task.goal);
    for (const p of paths) {
      for (const other of tasks) {
        if (other === task) continue;
        const otherPaths = extractFilePaths(other.goal);
        const base = path.basename(p);
        if (otherPaths.some(op => op.includes(base) || base.includes(op))) {
          deps.push(other.goal.slice(0, 60));
        }
      }
    }
    if (deps.length > 0) task.dependencies = deps;
  }
  return tasks;
}

export function getTaskFilePaths(tasks: DelegationTask[]): string[] {
  const allPaths = tasks.flatMap(t => extractFilePaths(t.goal));
  return [...new Set(allPaths)];
}

export function hasFileConflict(a: DelegationTask, b: DelegationTask): boolean {
  const aPaths = extractFilePaths(a.goal);
  const bPaths = extractFilePaths(b.goal);
  return aPaths.some(ap => bPaths.some(bp => ap === bp));
}

export function groupIndependent(tasks: DelegationTask[]): DelegationTask[][] {
  const groups: DelegationTask[][] = [];
  const assigned = new Set<DelegationTask>();

  for (const task of tasks) {
    if (assigned.has(task)) continue;
    const group: DelegationTask[] = [task];
    assigned.add(task);

    for (const other of tasks) {
      if (assigned.has(other) || other === task) continue;
      if (!hasFileConflict(task, other)) {
        group.push(other);
        assigned.add(other);
      }
    }
    groups.push(group);
  }

  return groups;
}

export function validateTasks(tasks: DelegationTask[], goal: string, projectRoot?: string): string | null {
  if (tasks.length === 0) return 'No tasks generated';
  const isSplit = goal.toLowerCase().includes('continue the remaining work');
  const coderTasks = tasks.filter(t => t.role === 'coder');
  if (!isSplit && coderTasks.length === 1 && extractFilePaths(goal).length > 3) {
    return `Expected multiple coder tasks for goal with many file paths`;
  }
  if (!isSplit && tasks.length === 1 && isComplexGoal(goal)) {
    return `Expected multiple tasks (one per file/component) to delegate a complex goal, but the plan only has 1 task. Please break it down into at least 2-3 focused subtasks.`;
  }
  const isFallbackSingleTask = tasks.length === 1 && tasks[0].goal.trim() === goal.trim();
  for (const t of tasks) {
    if (VAGUE_GOAL_RE.test(t.goal)) {
      return `Task "${t.goal.slice(0, 80)}" contains vague wording — be concrete`;
    }
    const paths = extractFilePaths(t.goal);
    const isNonFileOp = /\b(install|npm|yarn|pnpm|compile|build|setup|initialize|init|run|test|lint)\b/i.test(t.goal);
    if ((t.role === 'coder' || t.role === 'debugger') && paths.length === 0 && !isFallbackSingleTask && !isNonFileOp) {
      return `Task "${t.goal.slice(0, 80)}" has no file path — each task must target a specific file`;
    }
    if (projectRoot) {
      for (const p of paths) {
        const basename = path.basename(p);
        const normalizedP = p.replace(/\\/g, '/');
        if (normalizedP.startsWith('src/') || normalizedP.startsWith('lib/')) {
          const rootPath = path.join(projectRoot, basename);
          const srcPath = path.join(projectRoot, p);
          if (fs.existsSync(rootPath) && !fs.existsSync(srcPath)) {
            return `Task "${t.goal.slice(0, 80)}" targets "${p}" but the file actually exists at the root level ("${basename}"). Correct the path.`;
          }
        }
      }
    }
  }
  return null;
}

export function isUnnecessaryConfigTask(task: DelegationTask, projectContext?: string): boolean {
  if (!projectContext) return false;
  const goal = task.goal.toLowerCase();
  const isNextJs = /\bNext\.js\b/i.test(projectContext);
  const isVue = /\b(Vue|Nuxt)\b/i.test(projectContext);

  if (isNextJs && /\bnext\.config\b/i.test(goal)) return true;
  if (isVue && /\b(vue|nuxt)\.config\b/i.test(goal)) return true;

  return false;
}

export function extractRequirements(output: string): string[] {
  const reqMatch = output.match(/\[REQUIREMENTS\]([\s\S]*?)(?:\[END_REQUIREMENTS\]|$)/i);
  const bulletMatch = output.match(/Requirements?:?\s*\n((?:\s*[-*•]\s*.+\n?)+)/i);
  const raw = reqMatch ? reqMatch[1].trim() : bulletMatch ? bulletMatch[1].trim() : '';
  if (!raw) return [];
  return raw.split('\n').map(l => l.replace(/^[-*•]\s*/, '')).filter(Boolean);
}

export function getFrameworkGuidance(projectContext?: string, projectRoot?: string): string {
  if (!projectContext) return '';
  const guidance: string[] = [];
  const lower = projectContext.toLowerCase();

  if (lower.includes('next.js') || lower.includes('nextjs')) {
    guidance.push('Use Next.js App Router (app/ directory) unless the project already has pages/.');
    guidance.push('Place new pages in app/ as route groups, not in pages/.');
    guidance.push('For client components, add "use client"; at the top of the file.');
    if (projectRoot && fs.existsSync(path.join(projectRoot, 'tailwind.config.ts'))) {
      guidance.push('This project uses Tailwind CSS. Use Tailwind utility classes for styling instead of CSS modules or inline styles.');
    }
  }

  if (lower.includes('react')) {
    guidance.push('Use functional components with hooks. Avoid class components unless already present.');
    guidance.push('Use TypeScript interfaces for props and state.');
  }

  if (lower.includes('typescript')) {
    guidance.push('Define proper TypeScript types for all functions and variables. Avoid `any`.');
  }

  if (lower.includes('express')) {
    guidance.push('Use Express async route handlers with try/catch error handling.');
  }

  if (guidance.length > 0) {
    return '\nFramework-specific guidance:\n' + guidance.map(g => `  - ${g}`).join('\n');
  }
  return '';
}
