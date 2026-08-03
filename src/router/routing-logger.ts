// Structured routing-decision log for free-tier supply-chain observability.
// Appends JSONL to ~/.daedalus/routing.log and rotates when it exceeds the
// size cap, so a user can audit why a model was (or was not) selected without
// enabling DAEDALUS_DEBUG.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_BYTES = 1024 * 1024;

function logDir(): string {
  return process.env.DAEDALUS_ROUTING_LOG_DIR
    ? path.resolve(process.env.DAEDALUS_ROUTING_LOG_DIR)
    : path.join(os.homedir(), '.daedalus');
}

function logPath(): string {
  return path.join(logDir(), 'routing.log');
}

export interface RouteLogEntry {
  ts: string;
  model: string;
  endpoint: string;
  modelId: string;
  reason: string;
  skipped: Array<{ model: string; endpoint: string; reason: string }>;
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

export function logRouteDecision(entry: RouteLogEntry): void {
  try {
    ensureDir();
    rotateIfNeeded();
    fs.appendFileSync(logPath(), JSON.stringify(entry) + '\n');
  } catch {
    // Logging must never break routing.
  }
}

export function getRecentRouteDecisions(limit = 20): RouteLogEntry[] {
  try {
    const lp = logPath();
    if (!fs.existsSync(lp)) return [];
    const lines = fs.readFileSync(lp, 'utf8').trim().split('\n').filter(Boolean);
    const parsed = lines.map(l => {
      try { return JSON.parse(l) as RouteLogEntry; } catch { return null; }
    }).filter((e): e is RouteLogEntry => e !== null);
    return parsed.slice(-limit);
  } catch {
    return [];
  }
}
