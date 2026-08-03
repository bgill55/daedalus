import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logRouteDecision, getRecentRouteDecisions, flushRouteLog } from './routing-logger.js';

describe('routing-logger', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-routing-log-'));
    process.env.DAEDALUS_ROUTING_LOG_DIR = dir;
  });

  afterEach(() => {
    delete process.env.DAEDALUS_ROUTING_LOG_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('appends JSONL entries and reads them back most-recent-last', async () => {
    logRouteDecision({ ts: '2026-01-01T00:00:00Z', model: 'a', endpoint: 'e1', modelId: 'm1', reason: 'r1', skipped: [] });
    logRouteDecision({ ts: '2026-01-01T00:00:01Z', model: 'b', endpoint: 'e2', modelId: 'm2', reason: 'r2', skipped: [{ model: 'x', endpoint: 'ex', reason: 'blacklisted' }] });
    await flushRouteLog();

    const entries = getRecentRouteDecisions(10);
    expect(entries).toHaveLength(2);
    expect(entries[0].model).toBe('a');
    expect(entries[1].model).toBe('b');
    expect(entries[1].skipped[0].reason).toBe('blacklisted');
  });

  it('respects the limit and returns the most recent entries', async () => {
    for (let i = 0; i < 25; i++) {
      logRouteDecision({ ts: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`, model: `m${i}`, endpoint: 'e', modelId: 'm', reason: 'r', skipped: [] });
    }
    await flushRouteLog();
    const entries = getRecentRouteDecisions(10);
    expect(entries).toHaveLength(10);
    expect(entries[9].model).toBe('m24');
  });

  it('returns an empty array when no log exists', () => {
    expect(getRecentRouteDecisions()).toEqual([]);
  });

  it('drops entries that do not match the schema', async () => {
    logRouteDecision({ ts: '2026-01-01T00:00:00Z', model: 'a', endpoint: 'e1', modelId: 'm1', reason: 'r1', skipped: [] });
    const fs2 = fs;
    fs2.appendFileSync(path.join(dir, 'routing.log'), `${JSON.stringify({ model: 'bad' })}\n`);
    await flushRouteLog();

    const entries = getRecentRouteDecisions(10);
    expect(entries).toHaveLength(1);
    expect(entries[0].model).toBe('a');
  });
});
