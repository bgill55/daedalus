import { describe, it, expect } from 'vitest';
import {
  isCompletionClaim,
  countIncompleteTodos,
  detectFalseCompletion,
  falseCompletionWarning,
  detectFalseCompletionOnDisk,
  isScopeOverstatedSummary,
  isUnsubstantiatedProgressReport,
} from './completion-guard.js';
import type { SqliteTodo } from '../session/sqlite.js';

function todo(status: string): SqliteTodo {
  return { id: Math.random().toString(36), content: 'x', status };
}

describe('completion-guard', () => {
  it('flags whole-task completion claims', () => {
    expect(isCompletionClaim('All sprints completed successfully.')).toBe(true);
    expect(isCompletionClaim('All tasks are complete.')).toBe(true);
    expect(isCompletionClaim('Everything is complete. Next steps...')).toBe(true);
    expect(isCompletionClaim('all 4 sprints done')).toBe(true);
  });

  it('does NOT flag local/partial completion claims', () => {
    expect(isCompletionClaim('The build completed successfully.')).toBe(false);
    expect(isCompletionClaim('I fixed the FTS5 injection.')).toBe(false);
    expect(isCompletionClaim('Sprint 1 done.')).toBe(false);
  });

  it('counts incomplete todos (pending + in_progress)', () => {
    const todos = [todo('completed'), todo('pending'), todo('in_progress')];
    expect(countIncompleteTodos(todos)).toBe(2);
  });

  it('detectFalseCompletion: true when claiming done with open todos', () => {
    const todos = [todo('completed'), todo('pending'), todo('pending')];
    expect(detectFalseCompletion('All sprints completed successfully.', todos)).toBe(true);
  });

  it('detectFalseCompletion: false when all todos completed', () => {
    const todos = [todo('completed'), todo('completed')];
    expect(detectFalseCompletion('All tasks complete.', todos)).toBe(false);
  });

  it('detectFalseCompletion: false with no todos (task used no list)', () => {
    expect(detectFalseCompletion('All done.', [])).toBe(false);
  });

  it('detectFalseCompletion: false when claiming done but no claim phrase', () => {
    const todos = [todo('completed'), todo('pending')];
    expect(detectFalseCompletion('Here is a summary of what I changed.', todos)).toBe(false);
  });

  it('warning names the remaining count', () => {
    expect(falseCompletionWarning(3)).toContain('3 todo item(s)');
  });
});

describe('detectFalseCompletionOnDisk', () => {
  function ctx(opts: { history?: string[]; streak?: string[]; total?: number }): any {
    return {
      patchHistory: (opts.history ?? []).map(f => ({ filePath: f })),
      patchFailureStreak: new Map((opts.streak ?? []).map(f => [f, 1])),
      patchFailureTotal: opts.total ?? (opts.streak?.length ?? 0),
    };
  }

  it('returns null when the claimed file was successfully patched', () => {
    const c = ctx({ history: ['/repo/src/server.ts'], streak: ['/repo/src/server.ts'] });
    expect(detectFalseCompletionOnDisk('Fixed createApp in src/server.ts', c)).toBeNull();
  });

  it('flags a file that was only reverted and never written', () => {
    const c = ctx({ history: [], streak: ['/repo/src/server.ts'] });
    expect(detectFalseCompletionOnDisk('All issues resolved, createApp no longer starts the server (src/server.ts)', c)).toBe('src/server.ts');
  });

  it('flags a session with reverts but no successful patch at all', () => {
    const c = ctx({ history: [], streak: ['/repo/src/server.ts'], total: 3 });
    expect(detectFalseCompletionOnDisk('All issues resolved', c)).toBe('(no successful patch recorded this session)');
  });

  it('returns null for a plain completion claim with no file mentions and no reverts', () => {
    const c = ctx({ history: [], streak: [] });
    expect(detectFalseCompletionOnDisk('All tasks complete.', c)).toBeNull();
  });

  it('does NOT fire when a file is only mentioned in incidental prose (read-only report)', () => {
    const c = ctx({ history: [], streak: ['/repo/extension/popup.js'] });
    const report =
      'The audit is complete. Recommendations: split public/script.js into modules and ' +
      'refactor popup.js for clarity. No patches were made this session.';
    expect(detectFalseCompletionOnDisk(report, c)).toBeNull();
  });

  it('does NOT fire when the message disclaims any patch while naming a reverted file', () => {
    const c = ctx({ history: [], streak: ['/repo/src/server.ts'] });
    const disclaimer =
      "I haven't made any patches to src/server.ts this session — the git changes are from prior work.";
    expect(detectFalseCompletionOnDisk(disclaimer, c)).toBeNull();
  });

  it('still fires when a claim sentence asserts a fix to a reverted-only file', () => {
    const c = ctx({ history: [], streak: ['/repo/src/server.ts'] });
    expect(detectFalseCompletionOnDisk('All issues resolved, createApp no longer starts the server (src/server.ts)', c)).toBe('src/server.ts');
  });
});

describe('isScopeOverstatedSummary', () => {
  function todo(status: string): any {
    return { id: Math.random().toString(36), content: 'x', status };
  }

  it('flags a deliverable checklist summary while todos remain open', () => {
    const todos = [todo('completed'), todo('pending'), todo('pending')];
    const summary =
      'Task 1 - Preview Validation: Done. Task 2 - safeParseJson Tests: Done. ' +
      'Task 3 - Refine Workflow: Done. All changes shipped.';
    expect(isScopeOverstatedSummary(summary, todos)).toBe(true);
  });

  it('does NOT flag when all todos are completed', () => {
    const todos = [todo('completed'), todo('completed'), todo('completed')];
    const summary =
      'Task 1 - Preview Validation: Done. Task 2 - safeParseJson Tests: Done. Task 3 - Refine Workflow: Done.';
    expect(isScopeOverstatedSummary(summary, todos)).toBe(false);
  });

  it('does NOT flag a summary without a task enumeration', () => {
    const todos = [todo('completed'), todo('pending')];
    const summary = 'All the changes are complete and the build is green.';
    expect(isScopeOverstatedSummary(summary, todos)).toBe(false);
  });

  it('does NOT flag an enumeration that is not claimed done', () => {
    const todos = [todo('completed'), todo('pending')];
    const summary =
      'Task 1 - Preview Validation: in progress. Task 2 - safeParseJson Tests: planned. ' +
      'Here is where things stand.';
    expect(isScopeOverstatedSummary(summary, todos)).toBe(false);
  });

  it('flags an Issue #N enumeration claimed complete with open todos', () => {
    const todos = [todo('completed'), todo('pending')];
    const summary = 'Issue #1: completed. Issue #2: completed. Everything is resolved.';
    expect(isScopeOverstatedSummary(summary, todos)).toBe(true);
  });
});

describe('isUnsubstantiatedProgressReport', () => {
  it('flags a ✅ deliverable checklist without a task tracker', () => {
    const report =
      'Current State Analysis:\n' +
      '✅ TypeScript Configuration: Fixed\n' +
      '✅ Error Handling: Added consistent try-catch blocks\n' +
      '✅ Dependencies: Cleaned up redundant devDependencies';
    expect(isUnsubstantiatedProgressReport(report)).toBe(true);
  });

  it('flags a numbered "Key Improvements Made" achievement list', () => {
    const report =
      'Key Improvements Made:\n' +
      '1. Fixed tsconfig.json: Removed rootDir\n' +
      '2. Enhanced Error Handling: Added try-catch blocks\n' +
      '3. Cleaned package.json: Removed duplicate devDependencies';
    expect(isUnsubstantiatedProgressReport(report)).toBe(true);
  });

  it('flags a bulleted achievement list', () => {
    const report =
      '• Fixed the build blocker\n' +
      '• Added DB error handling\n' +
      '• Removed unused imports';
    expect(isUnsubstantiatedProgressReport(report)).toBe(true);
  });

  it('does NOT flag a single incidental done sentence', () => {
    expect(isUnsubstantiatedProgressReport('I fixed the config bug and the build is green now.')).toBe(false);
  });

  it('does NOT flag a single ✅ bullet', () => {
    expect(isUnsubstantiatedProgressReport('✅ TypeScript config fixed.')).toBe(false);
  });

  it('does NOT flag a plain status summary with no achievement enumeration', () => {
    const report =
      'Here is where things stand. The tsconfig was adjusted and error handling was ' +
      'added to the database functions. Let me know if you want more.';
    expect(isUnsubstantiatedProgressReport(report)).toBe(false);
  });
});
