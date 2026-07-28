import fs from 'fs';

let src = fs.readFileSync('src/agents/orchestrator.ts', 'utf-8');
const lines = src.split('\n');

// === Step 1: Remove extracted method bodies ===
// We identify each method by its signature and remove to its closing brace.

const methodRanges = [
  // Static validation methods
  { start: 'private static filterValidTasks', end: '}' },
  { start: 'private static stripCodeBlocks', end: '}' },
  { start: 'private static stripToolRequestArtifacts', end: '}' },
  { start: 'private static VAGUE_GOAL_RE', end: ';' }, // single-line field
  { start: 'private static isComplexGoal', end: '}' },
  { start: 'private static validateTasks', end: '}' },
  { start: 'private static cleanTaskText', end: '}' },
  { start: 'private static cleanPlanOutput', end: '}' },
  { start: 'private truncateGoal', end: '}' },
  { start: 'private static getTaskFilePaths', end: '}' },
  { start: 'private static hasFileConflict', end: '}' },
  { start: 'private static groupIndependent', end: '}' },
  // Verification methods
  { start: 'private isDeclaredError', end: '}' },
  { start: 'private requiresRealArtifacts', end: '}' },
  { start: 'private extractPendingWrites', end: '}' },
  { start: 'private async verifyArtifacts', end: '}' },
  { start: 'private async checkPlaceholders', end: '}' },
  { start: 'private async fillPlaceholders', end: '}' },
  { start: 'private async attemptRepair', end: '}' },
  { start: 'private hasRealWrites', end: '}' },
  { start: 'private verifyArtifactsThoroughly', end: '}' },
  { start: 'private buildCleanSummary', end: '}' },
  { start: 'private static isUnnecessaryConfigTask', end: '}' },
  { start: 'public static getFrameworkGuidance', end: '}' },
  { start: 'private static extractRequirements', end: '}' },
  { start: 'private static extractFilePaths', end: '}' },
  { start: 'private static buildDependencyGraph', end: '}' },
  // Rollback / build verification
  { start: 'private async rollbackTaskPatches', end: '}' },
  { start: 'private async runBuildVerification', end: '}' },
  { start: 'private isBuildErrorRelated', end: '}' },
  { start: 'private generateBuildErrorHint', end: '}' },
];

// Remove methods in reverse order (to keep line numbers stable)
let removedAny = false;
for (const range of methodRanges) {
  // Find the method
  const startIdx = lines.findIndex(l => l.trim().startsWith(range.start));
  if (startIdx === -1) {
    console.log(`Not found: ${range.start}`);
    continue;
  }

  // For single-line (VAGUE_GOAL_RE), just remove that line
  if (range.end === ';') {
    lines.splice(startIdx, 1);
    removedAny = true;
    console.log(`Removed: ${range.start}`);
    continue;
  }

  // Track depth to find the closing brace
  let depth = 0;
  let endIdx = startIdx;
  let foundOpen = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{') { depth++; foundOpen = true; }
      if (ch === '}') depth--;
    }
    if (foundOpen && depth === 0) {
      endIdx = i;
      break;
    }
  }

  if (depth !== 0) {
    console.log(`  Could not find closing brace for ${range.start} (depth=${depth})`);
    continue;
  }

  // Remove lines startIdx..endIdx (inclusive)
  const removed = lines.splice(startIdx, endIdx - startIdx + 1);
  removedAny = true;
  console.log(`Removed: ${range.start} (${removed.length} lines)`);
}

if (!removedAny) {
  console.log('No methods were removed — something went wrong');
  process.exit(1);
}

src = lines.join('\n');

// === Step 1b: Remove interface definitions and constants that were extracted ===
// Remove interface DelegationTask { ... }
src = src.replace(/^interface DelegationTask \{$[\s\S]*?^}$/m, '');
// Remove interface AgentResult { ... }
src = src.replace(/^interface AgentResult \{$[\s\S]*?^}$/m, '');
// Remove const PLACEHOLDER_RE and HTML_PLACEHOLDER_RE (and any surrounding blank lines)
src = src.replace(/^\n*const PLACEHOLDER_RE[\s\S]*?;\n*/m, '');
src = src.replace(/^const HTML_PLACEHOLDER_RE[\s\S]*?;\n*/m, '');
// Clean up extra blank lines
src = src.replace(/\n{3,}/g, '\n\n');
console.log('Removed extracted interfaces and constants');

// === Step 2: Replace static method calls ===
const staticReplacements = [
  ['Orchestrator.filterValidTasks(', 'filterValidTasks('],
  ['Orchestrator.stripCodeBlocks(', 'stripCodeBlocks('],
  ['Orchestrator.stripToolRequestArtifacts(', 'stripToolRequestArtifacts('],
  ['Orchestrator.VAGUE_GOAL_RE', 'VAGUE_GOAL_RE'],
  ['Orchestrator.isComplexGoal(', 'isComplexGoal('],
  ['Orchestrator.validateTasks(', 'validateTasks('],
  ['Orchestrator.cleanTaskText(', 'cleanTaskText('],
  ['Orchestrator.cleanPlanOutput(', 'cleanPlanOutput('],
  ['Orchestrator.getFrameworkGuidance(', 'getFrameworkGuidance('],
  ['Orchestrator.extractRequirements(', 'extractRequirements('],
  ['Orchestrator.extractFilePaths(', 'extractFilePaths('],
  ['Orchestrator.buildDependencyGraph(', 'buildDependencyGraph('],
  ['Orchestrator.isUnnecessaryConfigTask(', 'isUnnecessaryConfigTask('],
  ['Orchestrator.getTaskFilePaths(', 'getTaskFilePaths('],
  ['Orchestrator.hasFileConflict(', 'hasFileConflict('],
  ['Orchestrator.groupIndependent(', 'groupIndependent('],
];

for (const [from, to] of staticReplacements) {
  const count = (src.match(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  if (count > 0) {
    src = src.replaceAll(from, to);
    console.log(`Replaced ${count}x: ${from} -> ${to.trim()}`);
  }
}

// === Step 3: Replace instance method calls ===
// this.verifyArtifacts(role, goal, result, history) -> verifyArtifacts(this.toolContext, role, goal, result, history)
src = src.replaceAll(
  /\bthis\.verifyArtifacts\(/g,
  'verifyArtifacts(this.toolContext, '
);
console.log('Replaced this.verifyArtifacts calls');

src = src.replaceAll(
  /\bthis\.isDeclaredError\(/g,
  'isDeclaredError('
);
console.log('Replaced this.isDeclaredError calls');

src = src.replaceAll(
  /\bthis\.requiresRealArtifacts\(/g,
  'requiresRealArtifacts('
);
console.log('Replaced this.requiresRealArtifacts calls');

src = src.replaceAll(
  /\bthis\.extractPendingWrites\(/g,
  'extractPendingWrites('
);
console.log('Replaced this.extractPendingWrites calls');

// hasRealWrites(result) -> hasRealWrites(this.toolContext, result)
src = src.replaceAll(
  /\bthis\.hasRealWrites\(/g,
  'hasRealWrites(this.toolContext, '
);
console.log('Replaced this.hasRealWrites calls');

// verifyArtifactsThoroughly(role, goal, result, history) -> verifyArtifactsThoroughly(this.toolContext, ...)
src = src.replaceAll(
  /\bthis\.verifyArtifactsThoroughly\(/g,
  'verifyArtifactsThoroughly(this.toolContext, '
);
console.log('Replaced this.verifyArtifactsThoroughly calls');

// checkPlaceholders(historyStartIndex) -> checkPlaceholders(this.toolContext, historyStartIndex)
src = src.replaceAll(
  /\bthis\.checkPlaceholders\(/g,
  'checkPlaceholders(this.toolContext, '
);
console.log('Replaced this.checkPlaceholders calls');

// fillPlaceholders(historyStartIndex) -> fillPlaceholders(this.toolContext, historyStartIndex)
src = src.replaceAll(
  /\bthis\.fillPlaceholders\(/g,
  'fillPlaceholders(this.toolContext, '
);
console.log('Replaced this.fillPlaceholders calls');

// buildCleanSummary(task, result, historyStartIndex) -> buildCleanSummary(this.toolContext, task, result, historyStartIndex)
src = src.replaceAll(
  /\bthis\.buildCleanSummary\(/g,
  'buildCleanSummary(this.toolContext, '
);
console.log('Replaced this.buildCleanSummary calls');

// attemptRepair(...) -> attemptRepair({...}, ...)
// This is trickier — we need to wrap the context object
src = src.replaceAll(
  /\bthis\.attemptRepair\(/g,
  'attemptRepair({ toolContext: this.toolContext, runAgent: (role, goal, context, tools) => this.runAgent(role, goal, context, tools) }, '
);
console.log('Replaced this.attemptRepair calls');

// rollbackTaskPatches(historyStartIndex) -> rollbackTaskPatches(this.toolContext, historyStartIndex)
src = src.replaceAll(
  /\bthis\.rollbackTaskPatches\(/g,
  'rollbackTaskPatches(this.toolContext, '
);
console.log('Replaced this.rollbackTaskPatches calls');

// runBuildVerification(historyStartIndex) -> runBuildVerification(this.toolContext, historyStartIndex)
src = src.replaceAll(
  /\bthis\.runBuildVerification\(/g,
  'runBuildVerification(this.toolContext, '
);
console.log('Replaced this.runBuildVerification calls');

// isBuildErrorRelated(errorLogs, modifiedFiles) -> isBuildErrorRelated(errorLogs, modifiedFiles, this.toolContext.projectRoot)
// This one needs the projectRoot appended — but only if not already present
src = src.replaceAll(
  /\bthis\.isBuildErrorRelated\(/g,
  'isBuildErrorRelated('
);
console.log('Replaced this.isBuildErrorRelated calls');

// generateBuildErrorHint(errorLogs) -> generateBuildErrorHint(errorLogs)
// (same signature)
src = src.replaceAll(
  /\bthis\.generateBuildErrorHint\(/g,
  'generateBuildErrorHint('
);
console.log('Replaced this.generateBuildErrorHint calls');

// truncateGoal(text) -> truncateGoal(text) (same sig)
src = src.replaceAll(
  /\bthis\.truncateGoal\(/g,
  'truncateGoal('
);
console.log('Replaced this.truncateGoal calls');

// === Step 4: Fix isBuildErrorRelated call sites — need to add projectRoot ===
// Find calls like isBuildErrorRelated(checkResult.errorLogs || '', modifiedFiles)
// and add , this.toolContext.projectRoot at the end
src = src.replaceAll(
  /isBuildErrorRelated\(checkResult\.errorLogs \|\| '', modifiedFiles\)/g,
  "isBuildErrorRelated(checkResult.errorLogs || '', modifiedFiles, this.toolContext.projectRoot)"
);
console.log('Fixed isBuildErrorRelated calls to pass projectRoot');

// === Step 5: Add import line ===
// Find the last top-level import statement (line starting with "import ")
const allLines = src.split('\n');
let lastTopLevelImportLine = -1;
for (let i = 0; i < allLines.length; i++) {
  const trimmed = allLines[i].trimStart();
  if (trimmed.startsWith('import ') || trimmed.startsWith('import type ')) {
    lastTopLevelImportLine = i;
  }
}
if (lastTopLevelImportLine === -1) {
  console.error('Could not find top-level import statement');
  process.exit(1);
}

const newImports = `import {
  filterValidTasks, stripCodeBlocks, stripToolRequestArtifacts, VAGUE_GOAL_RE,
  isComplexGoal, validateTasks, cleanTaskText, cleanPlanOutput, truncateGoal,
  extractFilePaths, buildDependencyGraph, getTaskFilePaths, hasFileConflict, groupIndependent,
  isUnnecessaryConfigTask, extractRequirements, getFrameworkGuidance,
} from './orchestrator-validation.js';
import {
  isDeclaredError, requiresRealArtifacts, extractPendingWrites,
  verifyArtifacts, hasRealWrites, verifyArtifactsThoroughly,
  checkPlaceholders, fillPlaceholders, buildCleanSummary,
  isBuildErrorRelated, generateBuildErrorHint, runBuildVerification,
  attemptRepair, rollbackTaskPatches,
} from './orchestrator-verification.js';
import type { DelegationTask, AgentResult } from './orchestrator-types.js';
`;

allLines.splice(lastTopLevelImportLine + 1, 0, newImports);
src = allLines.join('\n');
console.log(`Added imports after line ${lastTopLevelImportLine}`);

fs.writeFileSync('src/agents/orchestrator.ts', src, 'utf-8');
console.log('\nDone — wrote src/agents/orchestrator.ts');
