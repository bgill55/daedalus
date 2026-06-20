import { manage } from '../tools/builtin/delegation.js';
import type { ToolContext } from '../types.js';

export interface BackgroundJob {
  id: number;
  role: string;
  goal: string;
  status: 'running' | 'completed' | 'failed' | 'killed';
  result?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  abortController: AbortController;
}

export const backgroundJobs = new Map<number, BackgroundJob>();
export const pendingNotifications: string[] = [];
let jobCounter = 0;

export function spawnBackgroundAgent(
  role: string,
  goal: string,
  contextStr: string,
  toolContext: ToolContext
): number {
  const id = ++jobCounter;
  const abortController = new AbortController();

  const job: BackgroundJob = {
    id,
    role,
    goal,
    status: 'running',
    startedAt: Date.now(),
    abortController,
  };

  backgroundJobs.set(id, job);

  const jobContext: ToolContext = {
    ...toolContext,
    get abortSignal() { return abortController.signal; }
  };

  (async () => {
    try {
      const result = await manage({ goal, context: contextStr, role }, jobContext);

      if (job.status === 'killed') return;

      if (result.success) {
        job.status = 'completed';
        job.result = result.content;
        pendingNotifications.push(
          `[NOTIF] Background task #${id} (${role}) completed successfully! Use /task ${id} to view results.`
        );
      } else {
        job.status = 'failed';
        job.error = result.error || 'Unknown failure';
        pendingNotifications.push(
          `[NOTIF] Background task #${id} (${role}) failed: ${job.error}`
        );
      }
    } catch (err: any) {
      if (job.status === 'killed') return;

      job.status = 'failed';
      job.error = err.message || 'Exception occurred';
      pendingNotifications.push(
        `[NOTIF] Background task #${id} (${role}) failed with exception: ${job.error}`
      );
    } finally {
      job.finishedAt = Date.now();
    }
  })();

  return id;
}

export function killBackgroundAgent(id: number): boolean {
  const job = backgroundJobs.get(id);
  if (!job || job.status !== 'running') return false;

  job.status = 'killed';
  job.abortController.abort();
  job.finishedAt = Date.now();
  job.error = 'Killed by user';

  pendingNotifications.push(`[NOTIF] Background task #${id} (${job.role}) was cancelled by user.`);
  return true;
}
