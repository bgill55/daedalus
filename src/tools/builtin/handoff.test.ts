import { describe, it, expect, beforeEach } from 'vitest';
import { handoffTask, setContextVariable, getContextVariable, VALID_AGENT_ROLES } from './handoff.js';
import { ToolContext } from '../../types.js';

describe('Sub-Agent Handoffs and Context Variables', () => {
  let mockContext: ToolContext;

  beforeEach(() => {
    mockContext = {
      sessionId: 'test-session',
      projectRoot: '/test',
      projectHash: 'hash123',
      activeFiles: new Map(),
      agentRole: 'coder',
      abortSignal: new AbortController().signal,
    };
  });

  it('successfully hands off to valid target role and updates context variables', async () => {
    const result = await handoffTask(
      {
        target_role: 'reviewer',
        handoff_notes: 'Completed initial implementation of auth service. Please audit.',
        context_updates: { target_file: 'src/auth.ts', tests_passing: true },
      },
      mockContext
    );

    expect(result.success).toBe(true);
    expect(mockContext.agentRole).toBe('reviewer');
    expect(mockContext.contextVariables).toEqual({
      target_file: 'src/auth.ts',
      tests_passing: true,
    });
    expect(result.content).toContain('[HANDOFF] Successfully transferred control to the reviewer agent');
  });

  it('rejects invalid target roles', async () => {
    const result = await handoffTask(
      {
        target_role: 'superman',
        handoff_notes: 'Fly away',
      },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid target_role');
    expect(mockContext.agentRole).toBe('coder'); // Unchanged
  });

  it('sets and updates individual context variables', async () => {
    const res1 = await setContextVariable({ key: 'build_status', value: 'passing' }, mockContext);
    expect(res1.success).toBe(true);
    expect(mockContext.contextVariables?.build_status).toBe('passing');

    const res2 = await setContextVariable({ key: 'retry_count', value: 2 }, mockContext);
    expect(res2.success).toBe(true);
    expect(mockContext.contextVariables?.retry_count).toBe(2);
  });

  it('rejects empty key in setContextVariable', async () => {
    const res = await setContextVariable({ key: '', value: 'test' }, mockContext);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Missing required parameter: key');
  });

  it('reads back a stored context variable via get_context_variable', async () => {
    await setContextVariable({ key: 'pr_number', value: 42 }, mockContext);
    const res = await getContextVariable({ key: 'pr_number' }, mockContext);
    expect(res.success).toBe(true);
    expect(res.content).toContain('"pr_number" = 42');
  });

  it('reports an unset key without error in get_context_variable', async () => {
    const res = await getContextVariable({ key: 'does_not_exist' }, mockContext);
    expect(res.success).toBe(true);
    expect(res.content).toContain('No value set for "does_not_exist"');
  });

  it('only accepts valid agent roles', () => {
    for (const role of VALID_AGENT_ROLES) {
      expect(['planner', 'coder', 'reviewer', 'debugger', 'researcher']).toContain(role);
    }
  });
});
