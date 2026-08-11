/**
 * Daedalus Codebase Constitution
 * Programmatic, non-bypassable execution contracts that govern agent tool calls,
 * patch verification, and multi-agent orchestration.
 */

export interface ConstitutionalPrinciple {
  id: string;
  name: string;
  description: string;
  enforcedBy: string;
}

export const DAEDALUS_CONSTITUTION: readonly ConstitutionalPrinciple[] = [
  {
    id: 'TEST_SUITE_INTEGRITY',
    name: 'Test Suite Integrity',
    description: 'Test files, test runner configs, and CI workflow files are locked as read-only by default during feature runs to prevent test-assertion weakening.',
    enforcedBy: 'checkTestFileLock (src/tools/builtin/patch-utils.ts)',
  },
  {
    id: 'PREFLIGHT_DEPENDENCY_VERIFICATION',
    name: 'Pre-flight Dependency Verification',
    description: 'Proposed module specifiers must be verified against project tsconfig and node_modules pre-flight before writing patches to disk.',
    enforcedBy: 'preflightDependencyCheck (src/tools/builtin/patch-utils.ts)',
  },
  {
    id: 'DETERMINISTIC_VERIFICATION',
    name: 'Deterministic Verification Claim',
    description: 'Completion claims must be verified against empirical build (tsc --noEmit) and test execution before marking a turn complete.',
    enforcedBy: 'detectFalseCompletionOnDisk (src/loop.ts)',
  },
  {
    id: 'NON_DESTRUCTIVE_ROLLBACK',
    name: 'Non-Destructive Git Checkpoints',
    description: 'Workspace state is snapshotted before multi-file edits; syntax errors or test regressions trigger clean checkpoints rollbacks.',
    enforcedBy: 'git-checkpoint (src/tools/git-checkpoint.ts)',
  },
  {
    id: 'DIFF_IMMUNITY_AUDIT',
    name: 'Diff Immunity Audit',
    description: 'Git diffs must be audited by the reviewer subagent to prevent silent type-loosening, error-swallowing, or mock fallbacks.',
    enforcedBy: 'Reviewer Subagent (src/agents/reviewer.ts)',
  },
] as const;

export function getConstitutionSummary(): string {
  return DAEDALUS_CONSTITUTION.map(p => `- **${p.name}**: ${p.description}`).join('\n');
}
