// Sigma-Mem (Σ-Memory) Engine for Daedalus
// Implements weighted, verification-backed memory scoring for multi-agent teams

import Database from 'better-sqlite3';
import crypto from 'crypto';
import {
  saveSigmaMemory,
  getSigmaMemories,
  getSigmaMemoryByHash,
  updateSigmaScore,
  pruneLowSigmaMemories,
  SqliteSigmaMemory,
} from './sqlite.js';
import { maskSecrets } from '../security/secret-detector.js';

export function computeSigmaContentHash(agentRole: string, category: string, summary: string): string {
  return crypto.createHash('sha256').update(`${agentRole}|${category}|${summary}`).digest('hex');
}

function parseTags(tags: string): string[] {
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.map((t) => String(t).toLowerCase()) : [];
  } catch {
    return [];
  }
}

export interface SigmaRecordOptions {
  agentRole: string;
  category: 'code_pattern' | 'fix_resolution' | 'schema_contract' | 'build_rule';
  tags: string[];
  summary: string;
  content: string;
  initialScore?: number;
}

export class SigmaMemEngine {
  /** Record a newly verified memory item (upserts on content hash to avoid duplicates) */
  public static recordVerifiedKnowledge(
    db: Database.Database,
    opts: SigmaRecordOptions
  ): SqliteSigmaMemory {
    const now = Date.now();
    const contentHash = computeSigmaContentHash(opts.agentRole, opts.category, opts.summary);
    const safeContent = maskSecrets(opts.content);
    const safeSummary = maskSecrets(opts.summary);
    const existing = getSigmaMemoryByHash(db, contentHash);
    if (existing) {
      const refreshed: SqliteSigmaMemory = {
        ...existing,
        tags: JSON.stringify(opts.tags || []),
        summary: safeSummary,
        content: safeContent,
        sigma_score: Math.round(Math.min(1.0, existing.sigma_score + 0.05) * 10000) / 10000,
        usefulness_count: existing.usefulness_count + 1,
        updated_at: now,
      };
      saveSigmaMemory(db, refreshed);
      return refreshed;
    }

    const id = `sig_${crypto.randomBytes(6).toString('hex')}`;
    const mem: SqliteSigmaMemory = {
      id,
      agent_role: opts.agentRole,
      category: opts.category,
      tags: JSON.stringify(opts.tags || []),
      summary: safeSummary,
      content: safeContent,
      content_hash: contentHash,
      sigma_score: opts.initialScore ?? 0.70,
      usefulness_count: 1,
      decay_count: 0,
      created_at: now,
      updated_at: now,
    };

    saveSigmaMemory(db, mem);
    return mem;
  }

  /** Boost scores for memory IDs involved in a successful task verification pass */
  public static rewardSuccessfulPass(db: Database.Database, memoryIds: string[]): void {
    for (const id of memoryIds) {
      updateSigmaScore(db, id, 0.10, true);
    }
  }

  /** Decay scores for memory IDs involved in a failed verification or patch rollback */
  public static penalizeFailedAttempt(db: Database.Database, memoryIds: string[]): void {
    for (const id of memoryIds) {
      updateSigmaScore(db, id, 0.70, false); // Multiplies score by 0.70 (30% decay)
    }
    // Auto-prune any memories that drop below threshold
    pruneLowSigmaMemories(db, 0.20);
  }

  /** Retrieve top high-scoring Σ-Memories formatted as a system prompt block */
  public static getPromptContext(
    db: Database.Database,
    filterRole?: string,
    minScore: number = 0.60,
    limit: number = 6,
    matchTags?: string[]
  ): { prompt: string; activeMemoryIds: string[] } {
    const poolSize = matchTags && matchTags.length > 0 ? Math.max(limit * 4, 50) : limit * 2;
    const rawMemories = getSigmaMemories(db, minScore, poolSize);

    // Filter by role if specified, or fallback to top global memories
    const filtered = filterRole
      ? rawMemories.filter((m) => m.agent_role === filterRole || m.category === 'build_rule')
      : rawMemories;

    const selected =
      matchTags && matchTags.length > 0
        ? SigmaMemEngine.rankByTagOverlap(filtered, matchTags).slice(0, limit)
        : filtered.slice(0, limit);
    if (selected.length === 0) {
      return { prompt: '', activeMemoryIds: [] };
    }

    const lines = selected.map((m) => {
      const scorePct = Math.round(m.sigma_score * 100);
      return `• [Σ-Score: ${scorePct}%] [${m.agent_role.toUpperCase()}] ${m.summary}\n  ${m.content.trim()}`;
    });

    const prompt = `\n--- Σ-Mem Verified Team Memory (Reliability-Scored Knowledge) ---\n${lines.join('\n\n')}\n--- End Σ-Mem ---\n`;
    const activeMemoryIds = selected.map((m) => m.id);

    return { prompt, activeMemoryIds };
  }

  private static rankByTagOverlap(memories: SqliteSigmaMemory[], matchTags: string[]): SqliteSigmaMemory[] {
    const normalized = matchTags.map((t) => t.toLowerCase());
    const countOverlap = (m: SqliteSigmaMemory): number => {
      const tags = parseTags(m.tags);
      return tags.reduce((acc, t) => (normalized.includes(t) ? acc + 1 : acc), 0);
    };

    const overlapping = memories
      .map((m) => ({ m, overlap: countOverlap(m) }))
      .filter((x) => x.overlap > 0)
      .sort((a, b) =>
        b.overlap - a.overlap ||
        b.m.sigma_score - a.m.sigma_score ||
        b.m.usefulness_count - a.m.usefulness_count ||
        b.m.updated_at - a.m.updated_at
      )
      .map((x) => x.m);

    const nonOverlapping = memories
      .filter((m) => countOverlap(m) === 0)
      .sort((a, b) =>
        b.sigma_score - a.sigma_score ||
        b.usefulness_count - a.usefulness_count ||
        b.updated_at - a.updated_at
      );

    return [...overlapping, ...nonOverlapping];
  }

  /** Background maintenance: prunes low-sigma memories (score < 1.0) and decays stale ones */
  public static consolidateAndPruneMemories(db: Database.Database, threshold = 1.0): number {
    return pruneLowSigmaMemories(db, threshold);
  }
}
