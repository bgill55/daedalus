// Sigma-Mem (Σ-Memory) Engine for Daedalus
// Implements weighted, verification-backed memory scoring for multi-agent teams

import Database from 'better-sqlite3';
import crypto from 'crypto';
import {
  saveSigmaMemory,
  getSigmaMemories,
  updateSigmaScore,
  pruneLowSigmaMemories,
  SqliteSigmaMemory,
} from './sqlite.js';

export interface SigmaRecordOptions {
  agentRole: string;
  category: 'code_pattern' | 'fix_resolution' | 'schema_contract' | 'build_rule';
  tags: string[];
  summary: string;
  content: string;
  initialScore?: number;
}

export class SigmaMemEngine {
  /** Record a newly verified memory item */
  public static recordVerifiedKnowledge(
    db: Database.Database,
    opts: SigmaRecordOptions
  ): SqliteSigmaMemory {
    const now = Date.now();
    const id = `sig_${crypto.randomBytes(6).toString('hex')}`;
    const mem: SqliteSigmaMemory = {
      id,
      agent_role: opts.agentRole,
      category: opts.category,
      tags: JSON.stringify(opts.tags || []),
      summary: opts.summary,
      content: opts.content,
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
    limit: number = 6
  ): { prompt: string; activeMemoryIds: string[] } {
    const rawMemories = getSigmaMemories(db, minScore, limit * 2);

    // Filter by role if specified, or fallback to top global memories
    const filtered = filterRole
      ? rawMemories.filter((m) => m.agent_role === filterRole || m.category === 'build_rule')
      : rawMemories;

    const selected = filtered.slice(0, limit);
    if (selected.length === 0) {
      return { prompt: '', activeMemoryIds: [] };
    }

    const lines = selected.map((m) => {
      const scorePct = Math.round(m.sigma_score * 100);
      return `• [Σ-Score: ${scorePct}%] [${m.agent_role.toUpperCase()}] ${m.summary}\n  ${m.content.trim()}`;
    });

    const prompt = `\n--- 🧠 Σ-Mem Verified Team Memory (Reliability-Scored Knowledge) ---\n${lines.join('\n\n')}\n--- End Σ-Mem ---\n`;
    const activeMemoryIds = selected.map((m) => m.id);

    return { prompt, activeMemoryIds };
  }
}
