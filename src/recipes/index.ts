import fs from 'fs';
import path from 'path';

export interface DaedalusRecipe {
  name: string;
  description: string;
  role?: string;
  skills?: string[];
  tools?: string[];
  prompt: string;
  filePath: string;
}

export function parseSimpleYaml(content: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = content.split('\n');
  let currentKey = '';
  let inMultiline = false;
  let multilineBuffer: string[] = [];

  for (const line of lines) {
    if (inMultiline) {
      if (line.startsWith('  ') || line.startsWith('\t') || line.trim() === '') {
        multilineBuffer.push(line.replace(/^\s{2}/, ''));
        continue;
      } else {
        result[currentKey] = multilineBuffer.join('\n').trim();
        inMultiline = false;
        multilineBuffer = [];
      }
    }

    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim();
      currentKey = key;

      if (val === '|' || val === '>') {
        inMultiline = true;
        multilineBuffer = [];
      } else if (val.startsWith('[') && val.endsWith(']')) {
        try {
          result[key] = JSON.parse(val);
        } catch {
          result[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        }
      } else {
        result[key] = val.replace(/^['"]|['"]$/g, '');
      }
    }
  }

  if (inMultiline && currentKey) {
    result[currentKey] = multilineBuffer.join('\n').trim();
  }

  return result;
}

export function loadRecipeFromFile(filePath: string): DaedalusRecipe | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    let parsed: Record<string, any>;
    if (filePath.endsWith('.json')) {
      parsed = JSON.parse(raw);
    } else {
      parsed = parseSimpleYaml(raw);
    }

    if (!parsed.name || !parsed.prompt) return null;

    return {
      name: String(parsed.name).trim(),
      description: String(parsed.description || '').trim(),
      role: parsed.role ? String(parsed.role).trim() : undefined,
      skills: Array.isArray(parsed.skills) ? parsed.skills.map(String) : undefined,
      tools: Array.isArray(parsed.tools) ? parsed.tools.map(String) : undefined,
      prompt: String(parsed.prompt).trim(),
      filePath,
    };
  } catch {
    return null;
  }
}

export const BUILTIN_DEFAULT_RECIPES: readonly Omit<DaedalusRecipe, 'filePath'>[] = [
  {
    name: 'security-audit',
    description: 'Audit codebase for type loosening, error swallowing, and missing sanitization',
    role: 'reviewer',
    skills: ['security-audit', 'typescript-best-practices'],
    prompt: `Inspect the codebase and audit all recent changes for:
1. Type loosening (converting interfaces to 'any' or 'unknown').
2. Error swallowing or empty catch {} blocks.
3. Hardcoded secrets, raw innerHTML, or missing input sanitization.
Provide a structured report with findings and recommended fixes.`,
  },
  {
    name: 'refactor-clean',
    description: 'Refactor code to remove redundant inline comments and dead variables while preserving tests',
    role: 'coder',
    prompt: `Inspect the active files and refactor to:
1. Remove redundant inline comments that merely restate standard code flow.
2. Remove unused imports and dead variables.
3. Preserve existing behavior and type signatures exactly.
Run tests to verify no regressions were introduced.`,
  },
  {
    name: 'spec-first-feature',
    description: 'Gather requirements and generate a SpecFirst contract with acceptance criteria',
    role: 'planner',
    prompt: `Analyze the user prompt and generate a SpecFirst contract (.daedalus/spec.json and spec.md):
1. Define goal, scope, and technical constraints.
2. Outline step-by-step implementation tasks.
3. Define explicit verification criteria for each task.`,
  },
  {
    name: 'bug-fix-triage',
    description: 'Diagnose error logs, isolate breaking symbol, and produce a minimal verified patch',
    role: 'debugger',
    prompt: `Diagnose the failure:
1. Read recent error logs and stack traces.
2. Isolate the exact breaking symbol or line.
3. Produce a minimal, verified patch and run vitest/tsc to verify the fix.`,
  },
] as const;

export function listRecipes(projectRoot: string, configDir: string): DaedalusRecipe[] {
  const recipes: DaedalusRecipe[] = [];
  const searchDirs = [
    path.join(projectRoot, '.daedalus', 'recipes'),
    path.join(configDir, 'recipes'),
  ];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.endsWith('.yaml') || file.endsWith('.yml') || file.endsWith('.json')) {
          const rec = loadRecipeFromFile(path.join(dir, file));
          if (rec && !recipes.some(r => r.name.toLowerCase() === rec.name.toLowerCase())) {
            recipes.push(rec);
          }
        }
      }
    } catch { /* ignore dir errors */ }
  }

  // Include built-in defaults if not overridden on disk
  for (const def of BUILTIN_DEFAULT_RECIPES) {
    if (!recipes.some(r => r.name.toLowerCase() === def.name.toLowerCase())) {
      recipes.push({
        ...def,
        filePath: '(built-in default)',
      });
    }
  }

  return recipes;
}
