import { describe, it, expect, vi, afterEach } from 'vitest';
import { routeTask, setRouteRouterClient, looksMultiPhase } from './route.js';
import type { ToolContext } from '../../types.js';

const mockContext: ToolContext = {
  sessionId: 'test-session',
  projectRoot: process.cwd(),
  projectHash: 'testhash',
  activeFiles: new Map(),
  agentRole: 'coder',
  abortSignal: new AbortController().signal,
  autoApplyEdits: 'all',
  patchHistory: [],
} as ToolContext;

// A router that returns a single no-tool-call completion, so the sub-agent
// "completes" immediately. Records how many concurrent create() calls are live.
function makeRouter() {
  let maxConcurrent = 0;
  let active = 0;
  const create = vi.fn().mockImplementation(async () => {
    active++;
    maxConcurrent = Math.max(maxConcurrent, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return { choices: [{ message: { content: 'done', tool_calls: null } }] };
  });
  return { create, getMaxConcurrent: () => maxConcurrent };
}

afterEach(() => {
  vi.restoreAllMocks();
  setRouteRouterClient(null as any);
});

describe('route_task (single-agent auto-routing)', () => {
  it('rejects calls without confirmed: true (permission gate)', async () => {
    const router = makeRouter();
    setRouteRouterClient({ chat: { completions: { create: router.create } } } as any);

    const res = await routeTask(
      { tasks: [{ role: 'coder', goal: 'do x' }], confirmed: false },
      mockContext,
    );
    expect(res.success).toBe(false);
    expect(res.content).toContain('[ROUTE]');
    expect(router.create).not.toHaveBeenCalled();
  });

  it('rejects when router client is not initialized', async () => {
    setRouteRouterClient(null as any);
    const res = await routeTask(
      { tasks: [{ role: 'coder', goal: 'do x' }], confirmed: true },
      mockContext,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('not initialized');
  });

  it('rejects when no tasks are provided', async () => {
    const router = makeRouter();
    setRouteRouterClient({ chat: { completions: { create: router.create } } } as any);
    const res = await routeTask({ tasks: [], confirmed: true }, mockContext);
    expect(res.success).toBe(false);
    expect(res.error).toContain('No tasks');
  });

  it('fans out independent sub-tasks in parallel and returns a consolidated summary', async () => {
    const router = makeRouter();
    setRouteRouterClient({ chat: { completions: { create: router.create } } } as any);

    const res = await routeTask(
      {
        tasks: [
          { role: 'researcher', goal: 'research X' },
          { role: 'planner', goal: 'plan Y' },
          { role: 'coder', goal: 'implement Z' },
        ],
        confirmed: true,
      },
      mockContext,
    );

    expect(res.success).toBe(true);
    expect(router.create).toHaveBeenCalledTimes(3);
    // All three sub-agents ran concurrently (in-flight at the same moment).
    expect(router.getMaxConcurrent()).toBeGreaterThanOrEqual(3);
    expect(res.content).toContain('[ROUTED]');
    expect(res.content).toContain('Completed 3/3');
  });

  it('reports partial failure without throwing when a sub-task rejects', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: 'ok', tool_calls: null } }] })
      .mockRejectedValueOnce(new Error('sub-agent exploded'));
    setRouteRouterClient({ chat: { completions: { create } } } as any);

    const res = await routeTask(
      {
        tasks: [
          { role: 'coder', goal: 'good' },
          { role: 'coder', goal: 'bad' },
        ],
        confirmed: true,
      },
      mockContext,
    );

    expect(res.success).toBe(false);
    expect(res.content).toContain('Completed 1/2');
    expect(res.content).toContain('[FAILED]');
  });
});

describe('looksMultiPhase heuristic', () => {
  it('flags a large multi-phase request', () => {
    expect(looksMultiPhase('Implement a full-stack auth system and add tests for the API')).toBe(true);
    expect(looksMultiPhase('Research the best approach and then build the parser module')).toBe(true);
    expect(looksMultiPhase('Plan the architecture and implement multiple modules with documentation')).toBe(true);
  });

  it('does NOT flag a single-file fix or short request', () => {
    expect(looksMultiPhase('fix the bug in src/foo.ts')).toBe(false);
    expect(looksMultiPhase('rename variable x to y')).toBe(false);
    expect(looksMultiPhase('add a test')).toBe(false); // action verb but no second phase
    expect(looksMultiPhase('short')).toBe(false); // under length threshold
  });

  it('does NOT flag a pure question', () => {
    expect(looksMultiPhase('How does the router pick a model?')).toBe(false);
  });

  it('is case-insensitive and trims', () => {
    expect(looksMultiPhase('  BUILD the CLI and write docs  ')).toBe(true);
  });
});
