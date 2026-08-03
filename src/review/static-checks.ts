import type { CiReviewResult } from '../ci.js';

export interface StaticFinding {
  rule: string;
  severity: 'error' | 'warning';
  file: string;
  line: number;
  message: string;
}

export interface StaticCheckResult {
  findings: StaticFinding[];
  passed: boolean;
  markdownReport: string;
}

interface DiffHunk {
  file: string;
  addedLines: { lineNo: number; text: string }[];
}

function parseDiffHunks(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let newLineNo = 0;

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git')) {
      const m = raw.match(/ b\/(.+)$/);
      if (current) hunks.push(current);
      current = { file: m ? m[1] : 'unknown', addedLines: [] };
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const m = raw.match(/ b\/(.+)$/);
      if (m && current) current.file = m[1];
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/\+(\d+)/);
      newLineNo = m ? parseInt(m[1], 10) : 0;
      continue;
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      const text = raw.slice(1);
      if (current) current.addedLines.push({ lineNo: newLineNo, text });
      newLineNo++;
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      // removed line; new line counter unaffected relative to new file
    } else if (!raw.startsWith('---') && raw.length > 0) {
      newLineNo++;
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

const SILENT_CATCH_RE = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/;

const DEFAULT_EXPORT_RE = /export\s+default\s+/;

const ANY_IN_ADDED_RE = /\bany\b/;

const ESM_IMPORT_RE = /(?:import|export)[^;]*from\s*['"](\.[^'"]*)['"]/g;

const TYPE_IMPORT_RE = /import\s+type\s+/;

function checkHunk(hunk: DiffHunk, findings: StaticFinding[]): void {
  const isTs = hunk.file.endsWith('.ts') || hunk.file.endsWith('.tsx');
  const isJs = hunk.file.endsWith('.js') || hunk.file.endsWith('.jsx');
  const isSource = isTs || isJs;

  for (const added of hunk.addedLines) {
    const text = added.text;

    if (SILENT_CATCH_RE.test(text)) {
      findings.push({
        rule: 'no-silent-catch',
        severity: 'error',
        file: hunk.file,
        line: added.lineNo,
        message:
          'Empty catch block swallows the error. Either rethrow, or log it (e.g. console.error) so failures are observable. ' +
          'This mirrors the team convention (PR #9) that scripts must fail deterministically.',
      });
    }

    if (isSource && DEFAULT_EXPORT_RE.test(text)) {
      findings.push({
        rule: 'no-default-export',
        severity: 'warning',
        file: hunk.file,
        line: added.lineNo,
        message:
          'Default export detected. The project convention is named exports only (see AGENTS.md). Prefer exporting a named symbol.',
      });
    }

    if (isSource && ANY_IN_ADDED_RE.test(text) && !TYPE_IMPORT_RE.test(text)) {
      findings.push({
        rule: 'no-explicit-any',
        severity: 'warning',
        file: hunk.file,
        line: added.lineNo,
        message:
          'Explicit `any` in added code weakens type safety. Prefer a concrete type, Record<string, unknown>, or unknown with narrowing.',
      });
    }

    if (isTs && ESM_IMPORT_RE.test(text) && !text.includes('.js')) {
      const m = text.match(ESM_IMPORT_RE);
      if (m) {
        findings.push({
          rule: 'esm-import-extension',
          severity: 'warning',
          file: hunk.file,
          line: added.lineNo,
          message:
            `ESM relative import '${m[1]}' is missing the '.js' extension. ` +
            'The project requires explicit .js extensions in ESM imports (see AGENTS.md).',
        });
      }
    }
  }
}

export function runStaticChecks(diffPatch: string): StaticCheckResult {
  const findings: StaticFinding[] = [];
  if (diffPatch && diffPatch.trim()) {
    const hunks = parseDiffHunks(diffPatch);
    for (const hunk of hunks) checkHunk(hunk, findings);
  }

  const passed = !findings.some(f => f.severity === 'error');

  let markdownReport = `### 🔎 Daedalus Static Analysis\n`;
  if (findings.length === 0) {
    markdownReport += `✅ No static anti-pattern findings.\n\n`;
  } else {
    const errors = findings.filter(f => f.severity === 'error');
    const warnings = findings.filter(f => f.severity === 'warning');
    markdownReport += `Found ${findings.length} finding(s) (${errors.length} error, ${warnings.length} warning):\n\n`;
    for (const f of findings) {
      const icon = f.severity === 'error' ? '🐞' : '⚠️';
      markdownReport += `${icon} **${f.rule}** (${f.severity}) \`${f.file}:${f.line}\`\n`;
      markdownReport += `> ${f.message}\n\n`;
    }
  }

  return { findings, passed, markdownReport };
}

export function emptyStaticCheckResult(): StaticCheckResult {
  return { findings: [], passed: true, markdownReport: '' };
}

export type { CiReviewResult };
