# 🧠 $\Sigma$-Mem ($\Sigma$-Memory): Reliable Multi-Agent Memory Engine

Daedalus features an embedded, local-first **$\Sigma$-Mem ($\Sigma$-Memory)** engine that solves the "context pollution" problem in multi-agent systems. Rather than storing flat, unverified chat transcripts, $\Sigma$-Mem scores, rewards, decays, and prunes sub-agent knowledge based on **verification feedback** (compilation, linting, unit test results, and SpecFirst contract assertions).

<p align="center">
  <img src="images/sigma_mem_infographic.jpg" alt="Σ-Mem: The Labyrinth of Reliable Memory Infographic" width="100%"/>
</p>

---

## 💡 The Core Problem: Flat Memory vs. $\Sigma$-Mem

In traditional multi-agent systems:
- **Flat Memory**: Retains all conversation turns — including hallucinated APIs, syntax errors, and failed attempts — equal to correct code. Over long autonomous tasks, the context window fills with noise, causing performance decay.
- **$\Sigma$-Mem Solution**: Evaluates memory snippets dynamically. Knowledge that contributes to **passing build checks** is rewarded with higher reliability scores ($\Sigma$-score), while knowledge associated with failed attempts decays and gets automatically pruned.

---

## ⚙️ How $\Sigma$-Mem Works

```mermaid
graph TD
    SubAgent["Sub-Agent Output (Coder / Debugger / Spec)"] --> BuildCheck["Build & Spec Verification Check"]
    
    BuildCheck -- "PASS: npx tsc / npm test" --> Reward["Reward Σ-Score (+0.10)<br/>Save Verified Pattern"]
    BuildCheck -- "FAIL: Compilation Error or Rollback" --> Decay["Penalize Σ-Score (30% Decay)<br/>Σ_new = ROUND(Σ_old * 0.70, 4)"]
    
    Reward --> SQLiteStore[("SQLite Store (sigma_memories table)")]
    Decay --> SQLiteStore
    
    SQLiteStore -- "Auto-Prune (Σ < 0.20)" --> Pruned["Purged from DB"]
    SQLiteStore -- "High Reliability (Σ >= 0.60)" --> PromptInject["Selective Context Injection into Sub-Agent System Prompts"]
```

---

## 📊 Reliability Scoring Math

Every memory item maintains a floating-point score $\Sigma \in [0.0, 1.0]$, initialized at **$0.70$**.

### 1. Reward Function (Build Verification Success)
When code produced using a memory item passes verification:
$$\Sigma_{new} = \text{ROUND}(\min(1.0, \Sigma_{old} + 0.10), 4)$$

### 2. Penalty Function (Build Verification Failure / Patch Rollback)
When code produced using a memory item fails build verification:
$$\Sigma_{new} = \text{ROUND}(\max(0.0, \Sigma_{old} \times 0.70), 4)$$

### 3. Auto-Pruning Threshold
Any memory item whose score falls below the threshold is automatically purged from the SQLite database:
$$\text{Purge if } \Sigma < 0.20$$

---

## 🗄️ SQLite Database Schema

$\Sigma$-Mem runs 100% locally inside `.daedalus/sessions/<session_id>.sqlite` without requiring external vector databases or Redis servers:

```sql
CREATE TABLE IF NOT EXISTS sigma_memories (
  id TEXT PRIMARY KEY,
  agent_role TEXT NOT NULL,       -- 'coder' | 'debugger' | 'reviewer' | 'planner'
  category TEXT NOT NULL,         -- 'code_pattern' | 'fix_resolution' | 'schema_contract' | 'build_rule'
  tags TEXT NOT NULL,              -- JSON array of file paths / keywords
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  sigma_score REAL NOT NULL DEFAULT 0.70,
  usefulness_count INTEGER DEFAULT 0,
  decay_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sigma_score ON sigma_memories(sigma_score DESC);
```

---

## 💻 CLI Commands & Usage

Inspect active $\Sigma$-Memories, scores, and decay counts directly in your terminal:

```bash
# View active memories with default minimum score threshold (>= 0.50)
/sigma

# Alias for /sigma
/memory

# Filter memories by a custom minimum Σ-Score threshold (e.g., >= 0.70)
/sigma 0.70
```

### Example Terminal Output

```text
=== 🧠 Σ-MEM (RELIABILITY-SCORED AGENT KNOWLEDGE) ===
  [Σ-Score: 90%] [CODER] SVG layout protection rule
    Used: 3 | Decays: 0 | Content: Always set max-width: 24px on raw svg tags...

  [Σ-Score: 80%] [DEBUGGER] Express static path resolution
    Used: 2 | Decays: 0 | Content: Use path.join(process.cwd(), 'public')...
===================================================
```
