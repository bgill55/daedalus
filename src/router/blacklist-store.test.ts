import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BlacklistStore } from './blacklist-store.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-blacklist-'));
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('BlacklistStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
    process.env.DAEDALUS_BLACKLIST_DIR = dir;
  });

  afterEach(() => {
    delete process.env.DAEDALUS_BLACKLIST_DIR;
    delete process.env.DAEDALUS_BLACKLIST_PERSIST;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; DB file may still be locked on Windows
    }
  });

  it('blacklists an endpoint/model and reports it active', () => {
    const store = new BlacklistStore({ dbDir: dir, ttlMs: 1000 });
    store.add('http://e1/v1', 'm1', 'slow');
    expect(store.isBlacklisted('http://e1/v1', 'm1').blacklisted).toBe(true);
    const active = store.list();
    expect(active).toHaveLength(1);
    expect(active[0].reason).toBe('slow');
    store.close();
  });

  it('decays a model out of the blacklist after the TTL', async () => {
    const store = new BlacklistStore({ dbDir: dir, ttlMs: 30 });
    store.add('http://e1/v1', 'm1', 'slow');
    expect(store.isBlacklisted('http://e1/v1', 'm1').blacklisted).toBe(true);
    expect(store.isBlacklisted('http://e1/v1', 'm1').expiredNow).toBe(false);

    await sleep(50); // Let the TTL elapse.

    const late = store.isBlacklisted('http://e1/v1', 'm1');
    expect(late.blacklisted).toBe(false);
    expect(late.expiredNow).toBe(true);
    expect(store.list()).toHaveLength(0);
    store.close();
  });

  it('persists blacklist across store instances via SQLite', () => {
    const store1 = new BlacklistStore({ dbDir: dir, ttlMs: 60_000 });
    store1.add('http://e1/v1', 'm1', 'hard-failure');
    store1.add('http://e2/v1', 'm2', 'catalog-missing');
    store1.close();

    // A fresh process (new store, same dir, after closing the first) rehydrates.
    const store2 = new BlacklistStore({ dbDir: dir, ttlMs: 60_000 });
    expect(store2.isBlacklisted('http://e1/v1', 'm1').blacklisted).toBe(true);
    expect(store2.isBlacklisted('http://e2/v1', 'm2').blacklisted).toBe(true);
    expect(store2.list()).toHaveLength(2);
    store2.close();
  });

  it('removes expired rows from the DB on rehydrate', async () => {
    const store1 = new BlacklistStore({ dbDir: dir, ttlMs: 30 });
    store1.add('http://e1/v1', 'm1', 'slow');
    store1.close();

    // Let the TTL elapse, then force a fresh store to read the (now-expired) DB row.
    await sleep(50);
    const store2 = new BlacklistStore({ dbDir: dir, ttlMs: 30 });
    expect(store2.isBlacklisted('http://e1/v1', 'm1').blacklisted).toBe(false);
    expect(store2.list()).toHaveLength(0);
    store2.close();
  });

  it('clear() empties both cache and DB', () => {
    const store = new BlacklistStore({ dbDir: dir, ttlMs: 60_000 });
    store.add('http://e1/v1', 'm1', 'slow');
    store.clear();
    expect(store.isBlacklisted('http://e1/v1', 'm1').blacklisted).toBe(false);
    expect(store.list()).toHaveLength(0);
    store.close();
  });

  it('falls back to in-memory only when persistence is disabled', () => {
    delete process.env.DAEDALUS_BLACKLIST_DIR;
    const store = new BlacklistStore({ enabled: false, ttlMs: 1000 });
    store.add('http://e1/v1', 'm1', 'slow');
    expect(store.isBlacklisted('http://e1/v1', 'm1').blacklisted).toBe(true);
    // No DB file should be created when persistence is disabled.
    expect(fs.existsSync(path.join(dir, 'model-blacklist.db'))).toBe(false);
  });
});
