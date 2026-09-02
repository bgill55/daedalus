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
  isIdeationOrProposalTask,
  isCasualOrInformationalTask,
  isReviewDeliverable,
  isReviewWithoutSourceInspection,
  claimedTestCountWithoutRun,
  isNegativeExistenceClaim,
  detectUngroundedWorksClaim,
  isUncitedArchClaim,
  uncitedArchClaimWarning,
  validateCitations,
  citationValidationWarning,
  collectCitationClaims,
  buildJudgePrompt,
  parseJudgeResponse,
  judgeClaimWarning,
  validateProseReferences,
  proseRefWarning,
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

  it('detectFalseCompletion: false with natural intermediate status phrases like moving on to', () => {
    const todos = [todo('completed'), todo('pending')];
    const text = 'Progress update:\n1. Fixed bug in suggestions.ts\n2. Updated ranking.ts\nMoving on to remaining tasks.';
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

  it('does NOT flag a list of proposed improvements or recommendations', () => {
    const suggestions =
      'Here are 3-5 improvements I would prioritize:\n' +
      '1. SSE Reconnection: When connection drops, reconnect automatically with backoff.\n' +
      '2. LSP Cache Invalidation: Invalidate symbols when files are updated on disk.\n' +
      '3. Memory Indexing: Improved index ranking for semantic queries.';
    expect(isUnsubstantiatedProgressReport(suggestions)).toBe(false);
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

  it('does NOT flag a hypothetical proposal naming a future file (e.g. capability.json)', () => {
    const ledger = new ClaimLedger();
    const proposal =
      'Agent Capability Contracts (proposed) — Each agent role would declare a capability.json (tools, file patterns, max turns).';
    expect(detectUngroundedClaim(proposal, ledger)).toBeNull();
  });

  it('does NOT flag suggestions proposing to add/create new files', () => {
    const ledger = new ClaimLedger();
    expect(detectUngroundedClaim('We could add a router.ts to handle dispatching.', ledger)).toBeNull();
    expect(detectUngroundedClaim('I propose creating config.json for user preferences.', ledger)).toBeNull();
    expect(detectUngroundedClaim('Feature idea: auth.ts handles OAuth tokens.', ledger)).toBeNull();
    expect(detectUngroundedClaim('For example, schema.prisma defines the user model.', ledger)).toBeNull();
  });

  it('does NOT flag files that do not exist in the project when fileExists is provided', () => {
    const ledger = new ClaimLedger();
    const fileExists = (p: string) => p.includes('existing.ts');
    // capability.json does not exist in the repo
    expect(detectUngroundedClaim('capability.json declares agent tools.', ledger, fileExists)).toBeNull();
    // existing.ts exists in the repo but was never observed -> flagged
    expect(detectUngroundedClaim('existing.ts defines the connection pool.', ledger, fileExists)).toBe('existing.ts');
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

describe('isReviewTask / isReviewDeliverable / isIdeationOrProposalTask', () => {
  it('detects a review request', () => {
    expect(isReviewTask('can you check out this project and give me your thoughts.')).toBe(true);
    expect(isReviewTask('review this codebase and tell me what you think')).toBe(true);
    expect(isReviewTask('hey how are you today')).toBe(false);
  });

  it('detects ideation / proposal requests and overrides review task classification', () => {
    const upgradePrompt = 'can you look at the project and point out some worth upgrades/features that are Daedalus worthy';
    expect(isIdeationOrProposalTask(upgradePrompt)).toBe(true);
    expect(isReviewTask(upgradePrompt)).toBe(false); // review is overridden because user asked for upgrades/features

    expect(isIdeationOrProposalTask('brainstorm 5 ideas for agent contracts')).toBe(true);
    expect(isIdeationOrProposalTask('reprint the list since I lost it')).toBe(true);
    expect(isIdeationOrProposalTask('what features should we add next?')).toBe(true);
    expect(
      isIdeationOrProposalTask(
        'lol, look at your source code aka this project, and come up with 3-5 improvements you would like to see or have at you disposal.'
      )
    ).toBe(true);
    expect(
      isReviewTask(
        'lol, look at your source code aka this project, and come up with 3-5 improvements you would like to see or have at you disposal.'
      )
    ).toBe(false);
    expect(isIdeationOrProposalTask('fix the bug in router.ts')).toBe(false);
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

describe('isCasualOrInformationalTask', () => {
  it('identifies casual and informational sharing prompts', () => {
    expect(isCasualOrInformationalTask('ok here was what shipped and live')).toBe(true);
    expect(isCasualOrInformationalTask('i was just showing you what i added and upgraded.')).toBe(true);
    expect(isCasualOrInformationalTask('just chatting with you')).toBe(true);
    expect(isCasualOrInformationalTask('hey daedalus, check this out')).toBe(true);
    expect(isCasualOrInformationalTask('FYI here is what we did')).toBe(true);
  });

  it('does not classify action tasks as casual', () => {
    expect(isCasualOrInformationalTask('fix the broken type error in model.ts')).toBe(false);
    expect(isCasualOrInformationalTask('run the tests and verify')).toBe(false);
  });
});

describe('claimedTestCountWithoutRun', () => {
  it('fires when agent claims "9 tests passing" with no real run', () => {
    expect(claimedTestCountWithoutRun('The project has 9 tests passing.', undefined)).toBe('9');
  });

  it('fires when agent claims "all 16 tests passing" with no real run', () => {
    expect(claimedTestCountWithoutRun('All 16 tests passing.', undefined)).toBe('16');
  });

  it('captures comma-formatted numbers like "1,641 passed" accurately', () => {
    expect(claimedTestCountWithoutRun('Suite finished with 1,641 passed.', undefined)).toBe('1,641');
  });

  it('does NOT fire when userTask is casual or informational', () => {
    expect(
      claimedTestCountWithoutRun(
        'The release shows 1,641 passed.',
        undefined,
        'ok here was what shipped and live'
      )
    ).toBeNull();
    expect(
      claimedTestCountWithoutRun(
        '1,641 tests passed in that build',
        undefined,
        'i was just showing you what i added and upgraded.'
      )
    ).toBeNull();
  });

  it('does NOT fire when the user message already contains the test count', () => {
    expect(
      claimedTestCountWithoutRun(
        'The 1,641 tests passing count is impressive.',
        undefined,
        'Here is the log: 1,641 passed'
      )
    ).toBeNull();
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

describe('Uncited architectural-claim guard (audit-hallucination hardening)', () => {
  const review = [
    '## Module Organization',
    'The codebase is split into logical top-level folders: agents, config, router, session.',
    'Each layer owns a single responsibility and the boundaries are explicit.',
    '## Type Safety',
    'Strongly-typed tool contracts prevent ad-hoc interfaces across the project.',
    'The configuration schema validates the entire runtime object at startup.',
    '## Error Handling',
    'Centralized error formatting gives a single source of truth for thrown values.',
    'Graceful shutdown hooks restore terminal state and stop health checks.',
    '## Extensibility',
    'The tool plug-in model lets new capabilities be added without touching core logic.',
    '## Overall Assessment',
    'Daedalus exhibits a well-structured, maintainable architecture with clear separation of concerns.',
  ].join('\n');

  it('flags a review deliverable that asserts structure with NO file:line citation', () => {
    expect(isUncitedArchClaim(review)).not.toBeNull();
  });

  it('does NOT flag a review deliverable that cites at least one source location', () => {
    const cited = review + '\nThe REPL wires everything in src/index.ts:250 via createRepl().';
    expect(isUncitedArchClaim(cited)).toBeNull();
  });

  it('does NOT flag a short non-review text (normal coding turn)', () => {
    expect(isUncitedArchClaim('Fixed the build. The module is now well-structured.')).toBeNull();
  });

  it('does NOT flag a review that makes no structural assertions', () => {
    const bland = '## Notes\nThe project is large.\nThere are many files.\nIt would take time to review fully.';
    expect(isUncitedArchClaim(bland)).toBeNull();
  });

  it('warns with a SYSTEM-level message naming the flagged term', () => {
    const w = uncitedArchClaimWarning('well-structured');
    expect(w).toContain('well-structured');
    expect(w).toContain('file:line');
  });
});

describe('Citation validator (layer-1 audit hardening)', () => {
  // Fake file store keyed by path; each value is the file's lines.
  const files: Record<string, string[]> = {
    'src/agents/orchestrator.ts': [
      '// line 1',
      'export const BUILTIN_TOOLS = [];',          // line 2
      'function startLoopDaemon() {}',             // line 3
      'const router = createRouter();',            // line 4
    ],
    'src/config/index.ts': [
      '// header',
      'export const ConfigSchema = z.object({});', // line 2
    ],
  };
  const readLines = (file: string, from: number, to: number): string[] | null => {
    const all = files[file];
    if (!all) return null;
    if (from < 1 || from > all.length) return [];
    return all.slice(from - 1, to);
  };

  it('passes when a cited file:line anchors a real symbol', () => {
    const report = 'Modular tooling: src/agents/orchestrator.ts:2 wires BUILTIN_TOOLS.';
    expect(validateCitations(report, { readLines })).toEqual([]);
  });

  it('flags a citation to a non-existent file', () => {
    const report = 'X is at src/missing/file.ts:5.';
    const fails = validateCitations(report, { readLines });
    expect(fails).toHaveLength(1);
    expect(fails[0].reason).toBe('file-not-found');
  });

  it('flags a line number out of range', () => {
    const report = 'Y at src/config/index.ts:99.';
    const fails = validateCitations(report, { readLines });
    expect(fails).toHaveLength(1);
    expect(fails[0].reason).toBe('line-out-of-range');
  });

  it('flags when the claimed symbol is on a different line than the cited one', () => {
    // BUILTIN_TOOLS exists in the file (line 2) but the citation points at line 4 (router),
    // where BUILTIN_TOOLS does not appear — a fabricated anchor.
    const report = 'Builtin tools are wired at src/agents/orchestrator.ts:4 via BUILTIN_TOOLS.';
    const fails = validateCitations(report, { readLines });
    expect(fails.length).toBeGreaterThanOrEqual(1);
    expect(fails[0].reason).toBe('symbol-missing');
    expect(fails[0].claimedSymbols).toContain('BUILTIN_TOOLS');
  });

  it('does not flag when no citations appear', () => {
    expect(validateCitations('Just prose, no anchors.', { readLines })).toEqual([]);
  });

  it('produces a readable warning listing each failed anchor', () => {
    const w = citationValidationWarning([
      { file: 'a.ts', line: 5, reason: 'file-not-found', claimedSymbols: [] },
      { file: 'b.ts', line: 9, reason: 'symbol-missing', claimedSymbols: ['Foo'] },
    ]);
    expect(w).toContain('a.ts:5');
    expect(w).toContain('b.ts:9');
    expect(w).toContain('Foo');
  });
});

describe('Layer-2 semantic judge (audit hardening)', () => {
  const files: Record<string, string[]> = {
    'src/config/index.ts': [
      '// header',
      'export const ConfigSchema = z.object({ apiKey: z.string() });', // line 2
    ],
    'src/agents/orchestrator.ts': [
      '// header',
      'function startLoopDaemon() {}', // line 2
      'const router = createRouter();', // line 3
    ],
  };
  const readLines = (file: string, from: number, to: number): string[] | null => {
    const all = files[file];
    if (!all) return null;
    if (from < 1 || from > all.length) return [];
    return all.slice(from - 1, to);
  };
  const fileExists = (file: string): boolean => file in files || `${file}.test.ts` in files;

  it('collects citation claims with their code region', () => {
    const report = 'Config validates keys: src/config/index.ts:2 uses Zod.';
    const claims = collectCitationClaims(report, { readLines });
    expect(claims).toHaveLength(1);
    expect(claims[0].file).toBe('src/config/index.ts');
    expect(claims[0].line).toBe(2);
    expect(claims[0].codeRegion).toContain('ConfigSchema');
  });

  it('buildJudgePrompt embeds claim text and cited code', () => {
    const report = 'Config validates keys: src/config/index.ts:2 uses Zod.';
    const claims = collectCitationClaims(report, { readLines });
    const prompt = buildJudgePrompt(claims);
    expect(prompt).toContain('src/config/index.ts:2');
    expect(prompt).toContain('ConfigSchema');
    expect(prompt).toContain('CLAIM 1');
  });

  it('parseJudgeResponse maps verdicts back by index', () => {
    const report = 'A: src/config/index.ts:2. B: src/agents/orchestrator.ts:3.';
    const claims = collectCitationClaims(report, { readLines });
    const raw = '[{"claim":1,"supported":true,"reason":"ok"},{"claim":2,"supported":false,"reason":"wrong"}]';
    const verdicts = parseJudgeResponse(raw, claims);
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0].supported).toBe(true);
    expect(verdicts[1].supported).toBe(false);
    expect(verdicts[1].reason).toBe('wrong');
  });

  it('parseJudgeResponse degrades gracefully on garbage', () => {
    const claims = collectCitationClaims('X: src/config/index.ts:2.', { readLines });
    expect(parseJudgeResponse('not json at all', claims)).toEqual([]);
    expect(parseJudgeResponse('[]', claims)).toEqual([]);
  });

  it('judgeClaimWarning lists unsupported claims', () => {
    const w = judgeClaimWarning([
      { file: 'src/config/index.ts', line: 2, supported: false, reason: 'schema is empty' },
    ]);
    expect(w).toContain('src/config/index.ts:2');
    expect(w).toContain('schema is empty');
  });
});

describe('Layer-1b prose file-reference validator (audit hardening)', () => {
  const files: Record<string, string[]> = {
    'src/config/index.ts': ['// header'],
    'src/indexing/watcher.ts': ['// header'],
    'src/indexing/watcher.test.ts': ['// sibling test exists'],
  };
  const readLines = (file: string, from: number, to: number): string[] | null => {
    const all = files[file];
    if (!all) return null;
    if (from < 1 || from > all.length) return [];
    return all.slice(from - 1, to);
  };
  const fileExists = (file: string): boolean => file in files;

  it('flags a referenced file that does not exist', () => {
    const report = 'The module src/does/not/exist.ts handles parsing.';
    const checks = validateProseReferences(report, { readLines, fileExists });
    expect(checks).toHaveLength(1);
    expect(checks[0].file).toBe('src/does/not/exist.ts');
    expect(checks[0].reason).toBe('file-not-found');
  });

  it('passes a referenced file that exists', () => {
    const report = 'The module src/indexing/watcher.ts watches the index.';
    const checks = validateProseReferences(report, { readLines, fileExists });
    expect(checks).toHaveLength(0);
  });

  it('flags a "no test file exists" claim when a sibling test is present', () => {
    const report =
      'Index watcher (watcher.ts) is untested — no src/indexing/watcher.test.ts file exists for it.';
    const checks = validateProseReferences(report, { readLines, fileExists });
    expect(checks.some((c) => c.reason === 'false-negative-claim')).toBe(true);
    expect(checks[0].file).toBe('src/indexing/watcher.test.ts');
  });

  it('does not flag when no negative-existence claim is made', () => {
    const report = 'Index watcher (watcher.ts) has a colocated test file watcher.test.ts.';
    const checks = validateProseReferences(report, { readLines, fileExists });
    expect(checks).toHaveLength(0);
  });

  it('proseRefWarning formats the checks', () => {
    const w = proseRefWarning([
      { file: 'src/indexing/watcher.test.ts', reason: 'false-negative-claim', detail: 'report claims no test file exists, but src/indexing/watcher.test.ts is present' },
    ]);
    expect(w).toContain('src/indexing/watcher.test.ts');
    expect(w).toContain('no test file exists');
  });
});

