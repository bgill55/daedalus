// SpecFirst Generator & Spec Contract Manager for Daedalus CLI
import fs from 'fs';
import path from 'path';
import type { LocalRouter } from '../router/index.js';
import { messageText } from '../types.js';

export interface SpecInterface {
  name: string;
  filePath: string;
  code: string;
}

export interface SpecFunction {
  name: string;
  signature: string;
  filePath: string;
  description: string;
}

export interface SpecTestCase {
  name: string;
  description: string;
  expectedInput?: string;
  expectedOutput?: string;
  assertionType: 'type_check' | 'unit_test' | 'file_exists' | 'export_check';
  targetFile: string;
}

export interface SpecContract {
  featureName: string;
  summary: string;
  interfaces: SpecInterface[];
  functions: SpecFunction[];
  testCases: SpecTestCase[];
  verificationCommands: string[];
}

export function getSpecDir(projectRoot: string): string {
  return path.join(projectRoot, '.daedalus');
}

export function getSpecJsonPath(projectRoot: string): string {
  return path.join(getSpecDir(projectRoot), 'spec.json');
}

export function getSpecMdPath(projectRoot: string): string {
  return path.join(getSpecDir(projectRoot), 'spec.md');
}

export function saveSpecContract(projectRoot: string, spec: SpecContract): void {
  const dir = getSpecDir(projectRoot);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Save machine-readable spec JSON
  fs.writeFileSync(getSpecJsonPath(projectRoot), JSON.stringify(spec, null, 2), 'utf-8');

  // Save human-readable spec Markdown
  const mdLines = [
    `# Feature Specification: ${spec.featureName}`,
    '',
    `> **Summary:** ${spec.summary}`,
    '',
    '## 1. Interface & Data Contracts',
    '',
  ];

  if (spec.interfaces.length > 0) {
    for (const iface of spec.interfaces) {
      mdLines.push(`### Interface: \`${iface.name}\` (\`${iface.filePath}\`)`);
      mdLines.push('```ts');
      mdLines.push(iface.code);
      mdLines.push('```');
      mdLines.push('');
    }
  } else {
    mdLines.push('_No specific TS interfaces declared._');
    mdLines.push('');
  }

  mdLines.push('## 2. Function Signatures');
  if (spec.functions.length > 0) {
    for (const fn of spec.functions) {
      mdLines.push(`- **\`${fn.name}\`** in \`${fn.filePath}\`: \`${fn.signature}\``);
      mdLines.push(`  - _${fn.description}_`);
    }
    mdLines.push('');
  } else {
    mdLines.push('_No explicit function signatures declared._');
    mdLines.push('');
  }

  mdLines.push('## 3. Test Cases & Verification Assertions');
  for (const tc of spec.testCases) {
    mdLines.push(`- [ ] **[${tc.assertionType.toUpperCase()}] ${tc.name}** (\`${tc.targetFile}\`)`);
    mdLines.push(`  - ${tc.description}`);
  }
  mdLines.push('');

  mdLines.push('## 4. Verification Commands');
  for (const cmd of spec.verificationCommands) {
    mdLines.push(`- \`${cmd}\``);
  }
  mdLines.push('');

  fs.writeFileSync(getSpecMdPath(projectRoot), mdLines.join('\n'), 'utf-8');
}

export function loadSpecContract(projectRoot: string): SpecContract | null {
  const jsonPath = getSpecJsonPath(projectRoot);
  if (!fs.existsSync(jsonPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    return JSON.parse(raw) as SpecContract;
  } catch {
    return null;
  }
}

export function formatSpecForPrompt(spec: SpecContract): string {
  const lines = [
    `=== SPECFIRST FEATURE CONTRACT: ${spec.featureName} ===`,
    `Summary: ${spec.summary}`,
    '',
    'REQUIRED INTERFACES & TYPES:',
  ];

  for (const iface of spec.interfaces) {
    lines.push(`- File: ${iface.filePath}`);
    lines.push(`  Code:\n${iface.code}`);
  }

  lines.push('');
  lines.push('REQUIRED FUNCTIONS:');
  for (const fn of spec.functions) {
    lines.push(`- File: ${fn.filePath} | ${fn.name}: ${fn.signature}`);
  }

  lines.push('');
  lines.push('REQUIRED TEST CASES & ACCEPTANCE CRITERIA:');
  for (const tc of spec.testCases) {
    lines.push(`- [${tc.targetFile}] ${tc.name}: ${tc.description}`);
  }

  lines.push('================================================');
  return lines.join('\n');
}

/**
 * Returns the fraction (0..1) of the spec's referenced filePaths that actually exist on
 * disk. A SpecFirst contract describes the files a feature SHOULD create; if most of them
 * are missing, the spec is a PLAN that was never implemented (or was abandoned) — not the
 * current code state. Injecting such a spec as authoritative context makes the agent report
 * the spec's intended design as the codebase's reality (e.g. hallucinating a missing
 * `helmet` import or "12 TODO comments" that don't exist).
 */
export function specFileExistenceRatio(spec: SpecContract, projectRoot: string): number {
  const paths = [
    ...spec.interfaces.map((i) => i.filePath),
    ...spec.functions.map((f) => f.filePath),
    ...spec.testCases.map((t) => t.targetFile),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (paths.length === 0) return 1; // no file claims → nothing to contradict
  const existing = paths.filter((p) => {
    try { return fs.existsSync(path.resolve(projectRoot, p)); } catch { return false; }
  });
  return existing.length / paths.length;
}

/**
 * Format a spec for injection into agent context, but guard against a STALE/aspirational
 * spec being treated as current code state. If few of the spec's referenced files exist,
 * prepend a clear warning that this is a PLAN, not the implemented codebase, so the agent
 * does not fabricate "findings" (missing deps, TODOs, error-handling gaps) that match the
 * spec's intent rather than the real files.
 */
export function formatSpecForPromptSafe(spec: SpecContract, projectRoot: string): string {
  const ratio = specFileExistenceRatio(spec, projectRoot);
  const body = formatSpecForPrompt(spec);
  if (ratio >= 0.5) return body; // majority of referenced files exist → spec reflects reality
  return [
    '=== SPECFIRST FEATURE CONTRACT (ASPIRATIONAL / NOT YET IMPLEMENTED) ===',
    `WARNING: This spec describes a planned feature. Only ${Math.round(ratio * 100)}% of its referenced`,
    'files exist in the current project. Do NOT treat this as the current code state, and do NOT report',
    'its intended design (e.g. dependencies, files, or gaps) as existing problems in the codebase.',
    'Discover the actual project state by inspecting real files before making any claims.',
    '================================================',
    body,
  ].join('\n');
}

export async function generateSpecContract(
  goal: string,
  router: LocalRouter,
  projectRoot: string
): Promise<SpecContract> {
  const systemPrompt = `You are a SpecFirst System Architect Agent. Your job is to create an explicit, unambiguous specification contract before any code is written.
  
Output MUST be a valid JSON object matching this TypeScript interface:
{
  "featureName": string,
  "summary": string,
  "interfaces": Array<{ "name": string, "filePath": string, "code": string }>,
  "functions": Array<{ "name": string, "signature": string, "filePath": string, "description": string }>,
  "testCases": Array<{ "name": string, "description": string, "expectedInput"?: string, "expectedOutput"?: string, "assertionType": "type_check" | "unit_test" | "file_exists" | "export_check", "targetFile": string }>,
  "verificationCommands": string[]
}

Rules:
1. Provide exact, valid TypeScript code for interfaces and types.
2. Provide exact function signatures (parameters with types, return type).
3. Provide at least 3 concrete test cases covering inputs, outputs, and edge cases.
4. DOM & CSS SELECTOR SYNC: For web UI tasks (HTML/CSS/JS), include explicit test cases enforcing exact matching CSS class names and element IDs across index.html, style.css, and script.js (e.g. index.html uses class="prompt-card", style.css defines .prompt-card, and script.js queries .prompt-card).
5. Output ONLY clean JSON. No markdown fences.`;

  const userPrompt = `Create a complete SpecFirst specification for the following goal:
  
Goal: ${goal}
Project Root: ${projectRoot}`;

  try {
    const response = await router.chat.completions.create({
      model: 'intelligence',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
    });

    let content = messageText(response.choices[0]?.message?.content ?? '') || '{}';
    // Clean potential markdown JSON fences
    content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

    const spec: SpecContract = JSON.parse(content);
    // Ensure fallback arrays
    spec.interfaces = spec.interfaces || [];
    spec.functions = spec.functions || [];
    spec.testCases = spec.testCases || [];
    spec.verificationCommands = spec.verificationCommands || ['npx tsc --noEmit', 'npm test'];

    saveSpecContract(projectRoot, spec);
    return spec;
  } catch {
    // Fallback basic contract if LLM JSON parsing fails
    const fallbackSpec: SpecContract = {
      featureName: goal.slice(0, 50),
      summary: goal,
      interfaces: [],
      functions: [],
      testCases: [
        {
          name: 'Verify implementation files exist',
          description: 'Ensure target source files are created and export valid modules',
          assertionType: 'file_exists',
          targetFile: 'src/index.ts',
        },
      ],
      verificationCommands: ['npx tsc --noEmit', 'npm test'],
    };
    saveSpecContract(projectRoot, fallbackSpec);
    return fallbackSpec;
  }
}
