import { describe, it, expect } from 'vitest';
import {
  isCompletionClaim,
  countIncompleteTodos,
  detectFalseCompletion,
  falseCompletionWarning,
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
