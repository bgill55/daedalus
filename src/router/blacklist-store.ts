// SQLite-backed model blacklist with TTL expiry.
//
// The router previously kept the blacklist in an in-memory Map, which is lost
// on process restart and never expires. This store persists blacklisted models
// across restarts and applies a TTL (default 10 minutes) so a model that flapped
// once is automatically eligible again after the window — the "decay" half of the
// slow-guard. Storage is best-effort: if the DB cannot be opened the store falls
// back to in-memory only and never breaks routing.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export interface BlacklistEntry {
  endpoint: string;
  model: string;
  reason: string;
  at: number;
  expiresAt: number;
}

export interface BlacklistStoreOptions {
  dbDir?: string;
  ttlMs?: number;
  enabled?: boolean;
}

const keyOf = (endpoint: string, model: string): string => `${endpoint}|${model}`;

export class BlacklistStore {
  private db: Database.Database | null = null;
  private cache = new Map<string, BlacklistEntry>();
  private readonly ttlMs: number;
  private enabled: boolean;
  private readonly dbPath: string;
  private opened = false;

  constructor(opts: BlacklistStoreOptions = {}) {
    this.ttlMs = (opts.ttlMs ?? (Number(process.env.DAEDALUS_BLACKLIST_TTL_MS) || 0)) || DEFAULT_TTL_MS;
    this.enabled =
      opts.enabled ?? (process.env.DAEDALUS_BLACKLIST_PERSIST !== '0');
    const dir =
      opts.dbDir ??
      (process.env.DAEDALUS_BLACKLIST_DIR
        ? path.resolve(process.env.DAEDALUS_BLACKLIST_DIR)
        : path.join(os.homedir(), '.daedalus'));
    this.dbPath = path.join(dir, 'model-blacklist.db');
  }

  private ensureDb(): boolean {
    if (!this.enabled || this.opened) return this.db !== null;
    this.opened = true;
    try {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
      const db = new Database(this.dbPath);
      db.prepare(
        `CREATE TABLE IF NOT EXISTS model_blacklist (
          endpoint TEXT NOT NULL,
          model TEXT NOT NULL,
          reason TEXT NOT NULL,
          blacklisted_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          PRIMARY KEY (endpoint, model)
        )`,
      ).run();
      this.db = db;
      this.rehydrate();
      return true;
    } catch {
      this.db = null;
      this.enabled = false;
      return false;
    }
  }

  // Load persisted, non-expired rows into the in-memory cache on startup.
  private rehydrate(): void {
    if (!this.db) return;
    try {
      const now = Date.now();
      const rows = this.db
        .prepare('SELECT endpoint, model, reason, blacklisted_at, expires_at FROM model_blacklist')
        .all() as Array<{ endpoint: string; model: string; reason: string; blacklisted_at: number; expires_at: number }>;
      for (const r of rows) {
        if (r.expires_at > now) {
          this.cache.set(keyOf(r.endpoint, r.model), {
            endpoint: r.endpoint,
            model: r.model,
            reason: r.reason,
            at: r.blacklisted_at,
            expiresAt: r.expires_at,
          });
        } else {
          this.db.prepare('DELETE FROM model_blacklist WHERE endpoint = ? AND model = ?').run(r.endpoint, r.model);
        }
      }
    } catch {
      // Ignore rehydrate failures; cache stays empty and routing proceeds.
    }
  }

  add(endpoint: string, model: string, reason: string): void {
    const now = Date.now();
    const entry: BlacklistEntry = { endpoint, model, reason, at: now, expiresAt: now + this.ttlMs };
    this.cache.set(keyOf(endpoint, model), entry);
    if (this.ensureDb() && this.db) {
      try {
        this.db
          .prepare(
            `INSERT INTO model_blacklist (endpoint, model, reason, blacklisted_at, expires_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(endpoint, model) DO UPDATE SET
               reason = excluded.reason,
               blacklisted_at = excluded.blacklisted_at,
               expires_at = excluded.expires_at`,
          )
          .run(endpoint, model, reason, now, entry.expiresAt);
      } catch {
        // Persistence failure is non-fatal; cache already holds the entry.
      }
    }
  }

  // Returns whether the model is blacklisted. `expiredNow` is true when the
  // cached entry had expired on this call (so the caller can decay dependent
  // state, e.g. reset a latency baseline).
  isBlacklisted(endpoint: string, model: string): { blacklisted: boolean; expiredNow: boolean } {
    const key = keyOf(endpoint, model);
    const entry = this.cache.get(key);
    const now = Date.now();
    if (!entry) {
      if (this.ensureDb() && this.db) {
        try {
          const row = this.db
            .prepare('SELECT endpoint, model, reason, blacklisted_at, expires_at FROM model_blacklist WHERE endpoint = ? AND model = ?')
            .get(endpoint, model) as
            | { endpoint: string; model: string; reason: string; blacklisted_at: number; expires_at: number }
            | undefined;
          if (row && row.expires_at > now) {
            this.cache.set(key, {
              endpoint: row.endpoint,
              model: row.model,
              reason: row.reason,
              at: row.blacklisted_at,
              expiresAt: row.expires_at,
            });
            return { blacklisted: true, expiredNow: false };
          }
          if (row) this.removeRow(endpoint, model);
        } catch {
          // Ignore; treat as not blacklisted.
        }
      }
      return { blacklisted: false, expiredNow: false };
    }
    if (entry.expiresAt > now) return { blacklisted: true, expiredNow: false };
    // Expired — decay out of the blacklist.
    this.cache.delete(key);
    this.removeRow(endpoint, model);
    return { blacklisted: false, expiredNow: true };
  }

  private removeRow(endpoint: string, model: string): void {
    if (this.db) {
      try {
        this.db.prepare('DELETE FROM model_blacklist WHERE endpoint = ? AND model = ?').run(endpoint, model);
      } catch {
        // Non-fatal.
      }
    }
  }

  list(): BlacklistEntry[] {
    const now = Date.now();
    const active: BlacklistEntry[] = [];
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt > now) {
        active.push(entry);
      } else {
        this.cache.delete(key);
        const [endpoint, model] = key.split('|');
        this.removeRow(endpoint, model);
      }
    }
    return active;
  }

  clear(): void {
    this.cache.clear();
    if (this.ensureDb() && this.db) {
      try {
        this.db.prepare('DELETE FROM model_blacklist').run();
      } catch {
        // Non-fatal.
      }
    }
  }

  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Non-fatal.
      }
      this.db = null;
    }
    this.opened = false;
  }
}
