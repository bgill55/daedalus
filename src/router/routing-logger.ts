// Structured routing-decision log for free-tier supply-chain observability.
// Appends JSONL to the routing log and rotates when it exceeds the size cap, so
// a user can audit why a model was (or was not) selected without enabling
// DAEDALUS_DEBUG.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RouteLogEntry } from '../types.js';

const MAX_BYTES = 1024 * 1024;

function logDir(): string {
  return process.env.DAEDALUS_ROUTING_LOG_DIR
    ? path.resolve(process.env.DAEDALUS_ROUTING_LOG_DIR)
    : path.join(os.homedir(), '.daedalus');
}

function logPath(): string {
  return path.join(logDir(), 'routing.log');
}

export function getRoutingLogPath(): string {
  return logPath();
}

function isRouteLogEntry(value: unknown): value is RouteLogEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.ts === 'string' &&
    typeof v.model === 'string' &&
    typeof v.endpoint === 'string' &&
    typeof v.modelId === 'string' &&
    typeof v.reason === 'string' &&
    Array.isArray(v.skipped)
  );
}

function ensureDir(): void {
  const dir = logDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function rotateIfNeeded(): void {
  try {
    const lp = logPath();
    if (fs.existsSync(lp) && fs.statSync(lp).size > MAX_BYTES) {
      const backup = `${lp}.1`;
      if (fs.existsSync(backup)) fs.rmSync(backup);
      fs.renameSync(lp, backup);
    }
  } catch {
    // Best-effort rotation; never block routing on a log failure.
  }
}

// Fire-and-forget async write so routing latency is never impacted by disk I/O.
// Errors are swallowed — logging must never break routing.
let pendingWrite: Promise<void> = Promise.resolve();
export function logRouteDecision(entry: RouteLogEntry): void {
  pendingWrite = pendingWrite
    .then(() => {
      ensureDir();
      rotateIfNeeded();
      const lp = logPath();
      const line = JSON.stringify(entry) + '\n';
      return fs.promises.appendFile(lp, line);
    })
    .catch(() => {});
}

// Await any in-flight writes — used by tests for deterministic assertions.
export function flushRouteLog(): Promise<void> {
  return pendingWrite;
}

export function getRecentRouteDecisions(limit = 20): RouteLogEntry[] {
  try {
    const lp = logPath();
    if (!fs.existsSync(lp)) return [];
    const lines = fs.readFileSync(lp, 'utf8').trim().split('\n').filter(Boolean);
    const parsed = lines
      .map(l => {
        try {
          const obj = JSON.parse(l);
          if (!isRouteLogEntry(obj)) return null;
          // Tolerate legacy/malformed skipped entries by normalizing to [].
          const skipped = obj.skipped.filter(
            (s: unknown) => typeof s === 'object' && s !== null &&
              typeof (s as Record<string, unknown>).model === 'string',
          );
          return { ...obj, skipped };
        } catch {
          return null;
        }
      })
      .filter((e): e is RouteLogEntry => e !== null);
    return parsed.slice(-limit);
  } catch {
    return [];
  }
}
