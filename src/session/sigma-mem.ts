// Sigma-Mem (Σ-Memory) Engine for Daedalus
// Implements weighted, verification-backed memory scoring for multi-agent teams

import Database from 'better-sqlite3';
import crypto from 'crypto';
import {
  saveSigmaMemory,
  getSigmaMemories,
  getSigmaMemoryByHash,
  updateSigmaScore,
  markMemoriesUsed,
  initProjectMemDb,
  pruneLowSigmaMemories,
  getTopFailureCritiques,
  setCritique,
  verifiedPassRate,
  SqliteSigmaMemory,
} from './sqlite.js';
import { getProjectHash } from '../project-hash.js';
import { maskSecrets } from '../security/secret-detector.js';
import { roleLabel } from '../agents/roles.js';

export function computeSigmaContentHash(agentRole: string, category: string, summary: string, content: string): string {
  return crypto.createHash('sha256').update(`${agentRole}|${category}|${summary}|${content}`).digest('hex');
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
  // Optional critique: a steering note describing a known failure mode for this
  // knowledge (CritICL-inspired). Stored on the memory and surfaced in the
  // AVOID block so the agent is steered AWAY from verified mistakes. Never moves
  // sigma_score.
  critique?: string;
}

export class SigmaMemEngine {
  /** Record a newly verified memory item (upserts on content hash to avoid duplicates) */
  public static recordVerifiedKnowledge(
    db: Database.Database,
    opts: SigmaRecordOptions
  ): SqliteSigmaMemory {
    const now = Date.now();
    const contentHash = computeSigmaContentHash(opts.agentRole, opts.category, opts.summary, opts.content);
    const safeContent = maskSecrets(opts.content);
    const safeSummary = maskSecrets(opts.summary);
    const existing = getSigmaMemoryByHash(db, contentHash);
    if (existing) {
      const refreshed: SqliteSigmaMemory = {
        ...existing,
        tags: JSON.stringify(opts.tags || []),
        summary: safeSummary,
        content: safeContent,
        // NOTE: sigma_score is intentionally NOT bumped on upsert. Reliability must
        // rise only via rewardSuccessfulPass (verified pass) and fall via
        // penalizeFailedAttempt (verified failure) — never from mere reuse/recording.
        // Re-recording a memory (e.g. from a failed-but-retried task) used to inflate
        // sigma_score by +0.05 here, letting a broken memory climb to 100% on frequency
        // alone. usefulness_count still increments as a retrieval tiebreaker only.
        // verified_pass/verified_fail are CARRIED FORWARD (not reset) — re-recording is
        // a re-observation, not a new outcome, so the verified history must persist.
        sigma_score: existing.sigma_score,
        usefulness_count: existing.usefulness_count + 1,
        verified_pass: existing.verified_pass,
        verified_fail: existing.verified_fail,
        // critique is CARRIED FORWARD on re-record (a re-observation doesn't erase
        // the known failure-mode steering note). It is only set/overwritten via
        // penalizeFailedAttempt when a fresh failure reason is supplied.
        critique: existing.critique,
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
      verified_pass: 0,
      verified_fail: 0,
      critique: opts.critique ? maskSecrets(opts.critique) : '',
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
  public static penalizeFailedAttempt(db: Database.Database, memoryIds: string[], reason?: string): void {
    for (const id of memoryIds) {
      updateSigmaScore(db, id, 0.70, false); // Multiplies score by 0.70 (30% decay)
      // CritICL-inspired: capture the failure as a steering critique so the agent is
      // steered AWAY from this verified mistake next time. Writing a critique NEVER
      // moves sigma_score — it only enriches the AVOID block. A later reason overrides
      // the prior one (most recent failure is the most relevant steering note).
      if (reason && reason.trim()) {
        setCritique(db, id, maskSecrets(reason.trim()));
      }
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
    // CritICL-inspired AVOID block: surface the top verified failure modes as
    // steering critiques so the agent is steered AWAY from known, verified mistakes
    // (not just down-weighted). This READS only and never touches sigma_score. It is
    // bounded (top 3 by failure count) and only includes memories that actually failed
    // verification AND carry a critique, so stale/noise critiques can't flood the prompt.
    // Queried INDEPENDENTLY of `selected` — a freshly-penalized memory (often below
    // minScore right after a failure) must still reach the agent while the mistake is
    // fresh, which is exactly when the steering matters most.
    const avoid = getTopFailureCritiques(db, 3);
    if (selected.length === 0 && avoid.length === 0) {
      return { prompt: '', activeMemoryIds: [] };
    }

    const lines = selected.map((m) => {
      const scorePct = Math.round(m.sigma_score * 100);
      let verdict = '';
      if (m.verified_pass > 0 || m.verified_fail > 0) {
        const rate = Math.round(verifiedPassRate(m) * 100);
        verdict = ` [verified: ${m.verified_pass}✓/${m.verified_fail}✗ · ${rate}%]`;
      }
      return `• [Σ-Score: ${scorePct}%] [${roleLabel(m.agent_role).toUpperCase()}] ${m.summary}${verdict}\n  ${m.content.trim()}`;
    });

    let prompt = selected.length > 0
      ? `\n--- Σ-Mem Verified Team Memory (Reliability-Scored Knowledge) ---\n${lines.join('\n\n')}\n--- End Σ-Mem ---\n`
      : '';

    if (avoid.length > 0) {
      const avoidLines = avoid.map((m) => {
        const role = roleLabel(m.agent_role).toUpperCase();
        return `• [AVOID · ${role} · ${m.verified_fail}✗] ${m.summary}\n  ${m.critique.trim()}`;
      });
      prompt += `\n--- Σ-Mem Failure Mode Critiques (AVOID — learned from verified failures) ---\n${avoidLines.join('\n\n')}\n--- End AVOID ---\n`;
    }

    const activeMemoryIds = selected.map((m) => m.id);

    return { prompt, activeMemoryIds };
  }

  /**
   * Record that the memories returned by getPromptContext were actually
   * injected into an agent's context (recall). Reinforces their reliability
   * score so frequently-recalled knowledge rises and the ranking learns from
   * usage. Safe to call with an empty id list.
   */
  public static markMemoriesUsed(db: Database.Database, ids: string[]): void {
    markMemoriesUsed(db, ids);
  }

  /**
   * Resolve the project-level Σ-Mem DB for injection, tolerating a
   * sessionManager whose projectMemDb handle is unset (e.g. an autonomous run
   * whose session was (re)created without opening it). Falls back to opening
   * the project-mem DB for the given root so retrieval/injection always works
   * for a real project. Returns undefined only when no project root is known.
   */
  public static resolveProjectMemDb(sessionManager: { projectMemDb?: Database.Database; projectRoot?: string } | undefined, projectRoot?: string): Database.Database | undefined {
    if (sessionManager?.projectMemDb) return sessionManager.projectMemDb;
    const root = projectRoot || sessionManager?.projectRoot;
    if (!root) return undefined;
    return initProjectMemDb(getProjectHash(root));
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
        verifiedPassRate(b.m) - verifiedPassRate(a.m) ||
        b.m.usefulness_count - a.m.usefulness_count ||
        b.m.updated_at - a.m.updated_at
      )
      .map((x) => x.m);

    const nonOverlapping = memories
      .filter((m) => countOverlap(m) === 0)
      .sort((a, b) =>
        b.sigma_score - a.sigma_score ||
        verifiedPassRate(b) - verifiedPassRate(a) ||
        b.usefulness_count - a.usefulness_count ||
        b.updated_at - a.updated_at
      );

    return [...overlapping, ...nonOverlapping];
  }

  /** Background maintenance: prunes low-sigma memories and decays stale ones */
  public static consolidateAndPruneMemories(db: Database.Database, threshold = 0.20): number {
    return pruneLowSigmaMemories(db, threshold);
  }
}
