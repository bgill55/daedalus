import { describe, it, expect } from 'vitest';
import {
  isCompletionClaim,
  countIncompleteTodos,
  detectFalseCompletion,
  falseCompletionWarning,
  detectFalseCompletionOnDisk,
  isScopeOverstatedSummary,
  isUnsubstantiatedProgressReport,
  ClaimLedger,
  detectUngroundedClaim,
  isGreenStateClaim,
  isUngroundedProjectClaim,
  isReviewTask,
  isReviewDeliverable,
  isReviewWithoutSourceInspection,
  claimedTestCountWithoutRun,
  isNegativeExistenceClaim,
  detectUngroundedWorksClaim,
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

  it('does NOT flag an honest "not done yet / here is what remains" update', () => {
    // Regression: a reconciled status update that states remaining work must close
    // without force-looping the [SYSTEM WARNING].
    expect(isCompletionClaim('I cannot claim completion of work that hasn\'t been verified. The sprints are NOT completed.')).toBe(false);
    expect(isCompletionClaim('Tasks are not all complete. Here is what is left: 1. Fix the build 2. Add tests')).toBe(false);
    expect(isCompletionClaim('Still in progress. Next steps: finish Sprint 5.')).toBe(false);
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

  it('detectFalseCompletion: true when concluding with an achievement enumeration while todos remain open', () => {
    const todos = [todo('completed'), todo('pending')];
    const text = 'Here is a summary of the bugs I found and fixed:\n1. Fixed bug in suggestions.ts\n2. Updated ranking.ts\nVerification:\n• npm test passed';
    expect(detectFalseCompletion(text, todos)).toBe(true);
  });

  it('detectFalseCompletion: false when concluding with achievement enumeration but with an honest disclaimer about remaining work', () => {
    const todos = [todo('completed'), todo('pending')];
    const text = 'Here is a summary of the bugs I found and fixed:\n1. Fixed bug in suggestions.ts\n2. Updated ranking.ts\nNote: Adding tests for suggestions is still in progress.';
    expect(detectFalseCompletion(text, todos)).toBe(false);
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

  it('does NOT flag an HONEST reconciled update that lists ✅ done + ❌ NOT completed', () => {
    // Regression: the exact shape from a graded run. The agent separated verified
    // ✅ items from explicit ❌/NOT-completed items and said it cannot claim
    // completion. This is a truthful status update and must close without the guard
    // force-looping the [SYSTEM WARNING].
    const report =
      'Honest Assessment - What Was Actually Accomplished\n' +
      '✅ What WAS Actually Completed:\n' +
      '1. Installed helmet - npm install helmet ✓\n' +
      '2. Added helmet import to server.ts ✓\n' +
      '❌ What WAS NOT Actually Completed:\n' +
      '• Syntax errors in server.ts prevent compilation\n' +
      '• Sprints 2-9 were NOT actually completed because the code has syntax errors\n' +
      'I cannot claim completion of work that hasn\'t been properly implemented and verified.';
    expect(isUnsubstantiatedProgressReport(report)).toBe(false);
  });
});

describe('ClaimLedger + detectUngroundedClaim', () => {
  it('returns null when the claimed file was observed this session', () => {
    const ledger = new ClaimLedger();
    ledger.record({ kind: 'read', base: 'src/db.ts', hit: true });
    const claim = 'The db.ts module exports updatePromptTemplateDb and it works correctly.';
    expect(detectUngroundedClaim(claim, ledger)).toBeNull();
  });

  it('flags a factual claim about a file never inspected this session', () => {
    const ledger = new ClaimLedger();
    // Only looked at server.ts — not db.ts.
    ledger.record({ kind: 'read', base: 'src/server.ts', hit: true });
    const claim = 'The db.ts module has unused path and url imports that should be removed.';
    expect(detectUngroundedClaim(claim, ledger)).toBe('db.ts');
  });

  it('flags an "already implemented" claim about an unobserved file', () => {
    const ledger = new ClaimLedger();
    const claim = 'Rate limiting is already implemented in package.json via express-rate-limit.';
    expect(detectUngroundedClaim(claim, ledger)).toBe('package.json');
  });

  it('flags a claim about a type/error that was never verified', () => {
    const ledger = new ClaimLedger();
    const claim = 'updatePromptTemplateDb in src/db.ts has TS2304 errors that break the build.';
    expect(detectUngroundedClaim(claim, ledger)).toBe('src/db.ts');
  });

  it('does NOT flag a sentence that merely names a file without a claim verb', () => {
    const ledger = new ClaimLedger();
    const claim = 'You can see the full logic in src/db.ts if you want to review it.';
    expect(detectUngroundedClaim(claim, ledger)).toBeNull();
  });

  it('does NOT flag when no file is mentioned at all', () => {
    const ledger = new ClaimLedger();
    expect(detectUngroundedClaim('The code is clean and ready to ship.', ledger)).toBeNull();
  });

  it('ignores unrelated observed files and only flags the unobserved one', () => {
    const ledger = new ClaimLedger();
    ledger.record({ kind: 'search', base: 'src/server.ts', hit: true });
    ledger.record({ kind: 'terminal', base: 'src/validation.ts', hit: true });
    const claim =
      'server.ts handles routing and validation.ts validates input. Also, logger.ts is missing a performance() method.';
    expect(detectUngroundedClaim(claim, ledger)).toBe('logger.ts');
  });

  it('does NOT flag a claim about the Node.js runtime (verified via `node -e`, not a repo file)', () => {
    const ledger = new ClaimLedger();
    // Agent ran `node -e "typeof import.meta.dirname"` — that is a terminal observation of
    // the runtime, not a file read. "Node.js" should not be treated as an uninspected file.
    const claim = 'import.meta.dirname exists in Node.js v22.23.2, confirmed via node -e.';
    expect(detectUngroundedClaim(claim, ledger)).toBeNull();
  });

  it('extracts style.css as style.css, not style.cs (longest-extension-first)', () => {
    const ledger = new ClaimLedger();
    // The extension alternation must prefer the longer "css" over "cs", otherwise
    // "style.css" collapses to "style.cs" and the ungrounded warning names the wrong file.
    const claim = 'public/style.css has the gradient styling for the generate button.';
    // style.css was never observed this session → flagged, and the reported base is style.css.
    expect(detectUngroundedClaim(claim, ledger)).toBe('style.css');
  });

  it('still extracts a real .cs file correctly when one is actually named', () => {
    const ledger = new ClaimLedger();
    // detectUngroundedClaim returns the raw match (case-preserving), so "Program.cs" stays "Program.cs".
    const claim = 'Program.cs defines the entry point of the service.';
    expect(detectUngroundedClaim(claim, ledger)).toBe('Program.cs');
  });
});

describe('isGreenStateClaim', () => {
  it('detects a tests-passing claim', () => {
    expect(isGreenStateClaim('Tests: ✅ 9 validation tests passing')).toBe(true);
  });

  it('detects a build-passing claim', () => {
    expect(isGreenStateClaim('Build: ✅ Passing (tsc --noEmit)')).toBe(true);
  });

  it('detects a clean-state claim', () => {
    expect(isGreenStateClaim('The project is now in a clean state with no warnings or errors.')).toBe(true);
  });

  it('does NOT flag a plain status summary without a green/clean assertion', () => {
    const report =
      'Here is where things stand. The tsconfig was adjusted and error handling was ' +
      'added to the database functions. Let me know if you want more.';
    expect(isGreenStateClaim(report)).toBe(false);
  });

  it('does NOT flag a report that names a failure honestly', () => {
    expect(isGreenStateClaim('2 db/api tests are failing; the rest pass.')).toBe(false);
  });
});

describe('isUngroundedProjectClaim', () => {
  it('flags an asserted feature the agent never observed', () => {
    const ledger = new ClaimLedger();
    const review =
      'Architecture & Tech Stack:\n' +
      '• Express.js: Standard web framework with good middleware support (helmet).\n' +
      '• The project uses a circuit breaker pattern for patch failures.\n' +
      '• Favorites: API endpoint for favorite toggling.';
    expect(isUngroundedProjectClaim(review, ledger)).toBeTruthy();
  });

  it('does NOT flag a feature the agent actually observed in tool output', () => {
    const ledger = new ClaimLedger();
    ledger.recordText('import helmet from "helmet";');
    ledger.recordText('app.use(helmet());');
    const review = 'The project uses helmet for security headers.';
    expect(isUngroundedProjectClaim(review, ledger)).toBeNull();
  });

  it('does NOT flag a hypothetical / recommendation (no assertion verb)', () => {
    const ledger = new ClaimLedger();
    const review = 'If you want security you could add helmet, or fix the import path.';
    expect(isUngroundedProjectClaim(review, ledger)).toBeNull();
  });

  it('does NOT flag when no feature term is present', () => {
    const ledger = new ClaimLedger();
    const review = 'Architecture: Node.js with Express and better-sqlite3. Build uses tsc --noEmit.';
    expect(isUngroundedProjectClaim(review, ledger)).toBeNull();
  });
});

describe('isNegativeExistenceClaim', () => {
  it('flags "no ESLint config" when the agent never searched', () => {
    const ledger = new ClaimLedger();
    const review = 'Negative Aspects:\n• No ESLint configuration found (lint script exists but no config file)';
    expect(isNegativeExistenceClaim(review, ledger)).toBe('eslint');
  });

  it('flags "missing JSDoc" when the agent never searched', () => {
    const ledger = new ClaimLedger();
    const review = 'Missing JSDoc documentation for most functions.';
    expect(isNegativeExistenceClaim(review, ledger)).toBe('jsdoc');
  });

  it('does NOT flag absence when the agent actually searched this session', () => {
    const ledger = new ClaimLedger();
    ledger.record({ kind: 'search', base: 'eslint.config.cjs', hit: false });
    const review = 'No ESLint configuration found (lint script exists but no config file)';
    expect(isNegativeExistenceClaim(review, ledger)).toBeNull();
  });

  it('does NOT flag a positive/existence claim (only absence)', () => {
    const ledger = new ClaimLedger();
    const review = 'The project uses ESLint for linting.';
    expect(isNegativeExistenceClaim(review, ledger)).toBeNull();
  });

  it('does NOT flag when no negative-existence term is present', () => {
    const ledger = new ClaimLedger();
    const review = 'The architecture is clean and modular.';
    expect(isNegativeExistenceClaim(review, ledger)).toBeNull();
  });
});

describe('isReviewTask / isReviewDeliverable', () => {
  it('detects a review request', () => {
    expect(isReviewTask('can you check out this project and give me your thoughts.')).toBe(true);
    expect(isReviewTask('review this codebase and tell me what you think')).toBe(true);
    expect(isReviewTask('hey how are you today')).toBe(false);
  });

  it('detects a multi-section review deliverable', () => {
    const review =
      'High-Level Project Review\n\n' +
      '#### Architecture & Tech Stack\n' +
      '• Node.js with TypeScript: Clean setup with proper type safety enabled.\n' +
      '• Express.js: Standard web framework with good middleware support for rate limiting and security headers.\n' +
      '• Database: better-sqlite3 with a clear schema and proper separation of concerns in db.ts.\n' +
      '• Build/Test: tsc --noEmit for typechecking, vitest for testing with the existing suite passing.\n\n' +
      '#### Key Features\n' +
      '• Prompt Management: CRUD operations with case-insensitive search and tag filtering.\n' +
      '• Favorites System: database schema column and an API endpoint for favorite toggling.\n' +
      '• User Experience: dark theme with glassmorphism styling and tag filtering in the frontend.\n' +
      '• Rate Limiting: express-rate-limit middleware protecting the public API endpoints.\n';
    expect(isReviewDeliverable(review)).toBe(true);
  });

  it('does NOT treat a short reply as a review deliverable', () => {
    expect(isReviewDeliverable('Looks good to me, nice work!')).toBe(false);
  });
});

const REVIEW_DELIVERABLE = (
  'High-Level Project Review\n\n' +
  '#### Architecture & Tech Stack\n' +
  '• Node.js with TypeScript: Clean setup with proper type safety enabled.\n' +
  '• Express.js: Standard web framework with good middleware support.\n' +
  '• Database: better-sqlite3 with proper separation of concerns.\n\n' +
  '#### Key Features\n' +
  '• Prompt Management: CRUD operations with case-insensitive search.\n' +
  '• Rate Limiting: express-rate-limit middleware protecting the API.\n' +
  '#### Top Recommendations\n' +
  '1. Add more tests. 2. Refactor db.ts. 3. Add environment validation.\n'
);

describe('isReviewWithoutSourceInspection', () => {
  it('fires when agent only read walkthrough.md (no source files)', () => {
    const ledger = new ClaimLedger();
    ledger.record({ kind: 'read', base: 'walkthrough.md', hit: true });
    expect(isReviewWithoutSourceInspection(REVIEW_DELIVERABLE, ledger)).toBe(true);
  });

  it('fires when agent only read README.md and CHANGELOG.md', () => {
    const ledger = new ClaimLedger();
    ledger.record({ kind: 'read', base: 'README.md', hit: true });
    ledger.record({ kind: 'read', base: 'CHANGELOG.md', hit: true });
    expect(isReviewWithoutSourceInspection(REVIEW_DELIVERABLE, ledger)).toBe(true);
  });

  it('does NOT fire when agent read at least 2 source files', () => {
    const ledger = new ClaimLedger();
    ledger.record({ kind: 'read', base: 'src/server.ts', hit: true });
    ledger.record({ kind: 'read', base: 'src/db.ts', hit: true });
    expect(isReviewWithoutSourceInspection(REVIEW_DELIVERABLE, ledger)).toBe(false);
  });

  it('does NOT fire when text is not a review deliverable', () => {
    const ledger = new ClaimLedger();
    expect(isReviewWithoutSourceInspection('Looks good!', ledger)).toBe(false);
  });

  it('fires when agent read only 1 source file (below MIN_SOURCE_READS threshold)', () => {
    const ledger = new ClaimLedger();
    ledger.record({ kind: 'read', base: 'src/server.ts', hit: true });
    expect(isReviewWithoutSourceInspection(REVIEW_DELIVERABLE, ledger)).toBe(true);
  });
});

describe('claimedTestCountWithoutRun', () => {
  it('fires when agent claims "9 tests passing" with no real run', () => {
    expect(claimedTestCountWithoutRun('The project has 9 tests passing.', undefined)).toBe('9');
  });

  it('fires when agent claims "all 16 tests passing" with no real run', () => {
    expect(claimedTestCountWithoutRun('All 16 tests passing.', undefined)).toBe('16');
  });

  it('does NOT fire when lastActualPassCount is set (let existing guard handle it)', () => {
    expect(claimedTestCountWithoutRun('9 tests passing', 9)).toBeNull();
    expect(claimedTestCountWithoutRun('9 tests passing', 12)).toBeNull();
  });

  it('does NOT fire when no specific count is asserted', () => {
    expect(claimedTestCountWithoutRun('Tests are green and passing.', undefined)).toBeNull();
  });

  it('does NOT fire when text has no test claim at all', () => {
    expect(claimedTestCountWithoutRun('The build compiles cleanly with no errors.', undefined)).toBeNull();
  });
});

describe('detectUngroundedWorksClaim (runtime-exercise guard)', () => {
  it('fires on a "wired in" claim with no runtime probe recorded', () => {
    const ledger = new ClaimLedger();
    // Only static checks ran (typecheck + unit tests). No curl/HTTP probe.
    const claim = 'The AI-assisted prompt generation feature is now wired in.';
    expect(detectUngroundedWorksClaim(claim, ledger)).toBe(true);
  });

  it('fires on a "verified working end-to-end" claim with only static checks', () => {
    const ledger = new ClaimLedger();
    const claim = 'Typecheck and all 31 tests pass. The endpoint is verified working end-to-end.';
    expect(detectUngroundedWorksClaim(claim, ledger)).toBe(true);
  });

  it('does NOT fire once a live runtime probe was recorded', () => {
    const ledger = new ClaimLedger();
    ledger.markRuntimeExercised();
    const claim = 'The endpoint is wired in and verified working after I curled it.';
    expect(detectUngroundedWorksClaim(claim, ledger)).toBe(false);
  });

  it('does NOT fire on a plain "I added X" work claim without a works-verb', () => {
    const ledger = new ClaimLedger();
    const claim = 'I added a new /api/prompts/generate endpoint and the validation middleware.';
    expect(detectUngroundedWorksClaim(claim, ledger)).toBe(false);
  });

  it('does NOT fire on "implemented; not yet runtime-verified" (honest hedging)', () => {
    const ledger = new ClaimLedger();
    const claim = 'The integration is implemented but not yet runtime-verified — typecheck passes.';
    expect(detectUngroundedWorksClaim(claim, ledger)).toBe(false);
  });

  it('session-scoped ledger credits a read in a prior turn (no false ungrounded flag)', () => {
    // Regression: claimLedger was recreated per turn, so a file read in turn N did
    // not credit a factual claim made in turn N+1 — the guard falsely flagged the
    // grounded claim as "ungrounded (no inspection this session)". The ledger must
    // persist on the shared context across turns. Simulate two turns sharing one
    // ledger (as model.ts now does via toolContext.claimLedger).
    const shared: { claimLedger?: ClaimLedger } = {};
    // Turn N: agent reads src/server.ts; ledger is created and recorded.
    const ledgerN = shared.claimLedger ?? new ClaimLedger();
    shared.claimLedger = ledgerN;
    ledgerN.record({ kind: 'read', base: 'src/server.ts', hit: true });
    // Turn N+1: a NEW turn reuses the persisted ledger (not a fresh one).
    const ledgerN1 = shared.claimLedger ?? new ClaimLedger();
    shared.claimLedger = ledgerN1;
    expect(ledgerN1).toBe(ledgerN); // same instance — reads survived
    // Claim about the read file must now be grounded, not flagged ungrounded.
    const claim = 'src/server.ts:290 contains a global error handler middleware.';
    expect(detectUngroundedClaim(claim, ledgerN1)).toBe(null);
  });
});
