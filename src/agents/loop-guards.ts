// Loop-guard helpers shared by the single-agent turn loop (model.ts). These catch
// two wasteful patterns observed in real sessions:
//
//  1. Idle re-read stall — the agent spends a long turn re-reading the same file
//     (often after discovering the "fix" was already present) without making any edit.
//     At trivial-token cost it wastes minutes of wall-clock and model budget. We detect
//     a single file read many times with no intervening write and short-circuit the turn.
//
//  2. Post-circuit-breaker verification claim — after a `npm run build && npm run test`
//     command trips the circuit breaker (no progress), the turn sometimes still reports
//     "Build passes / Tests green" without a fresh, successful run. We record that the
//     breaker fired and block a green build/test claim until a real success is observed.

const DEFAULT_STALL_THRESHOLD = 15;

export class ReadStallDetector {
  private counts = new Map<string, number>();
  private anyWrite = false;
  // Tracks a TIGHT re-read loop: the same file read repeatedly with no other tool in
  // between. Alternating reads (a.ts -> b.ts -> a.ts) or reads interleaved with real work
  // do NOT count as a stall — only an unbroken same-file read streak does.
  private lastReadFile: string | undefined;
  private consecutiveSameFile = 0;

  constructor(private threshold = DEFAULT_STALL_THRESHOLD) {}

  /**
   * Record a read tool result. Returns true once the SAME file has been read
   * `threshold` times CONSECUTIVELY (no other tool between reads) and the turn has not
   * written any file (a write breaks the stall assumption). This isolates the real
   * "fix was already present — re-reading the same file forever" pathology from normal
   * multi-file review or budget-exhaustion loops that alternate files.
   */
  registerRead(filePath: string | undefined): boolean {
    if (this.anyWrite) return false;
    if (!filePath) return false;
    if (filePath === this.lastReadFile) {
      this.consecutiveSameFile += 1;
    } else {
      this.lastReadFile = filePath;
      this.consecutiveSameFile = 1;
    }
    const prev = this.counts.get(filePath) ?? 0;
    this.counts.set(filePath, prev + 1);
    return this.consecutiveSameFile >= this.threshold;
  }

  /** A successful file write breaks the stall assumption for the rest of the turn. */
  registerWrite(): void {
    this.anyWrite = true;
    this.counts.clear();
    this.consecutiveSameFile = 0;
    this.lastReadFile = undefined;
  }

  get readCount(): number {
    let max = 0;
    for (const v of this.counts.values()) max = Math.max(max, v);
    return max;
  }

  /** True once the same file has been read `threshold` times consecutively with no write. */
  get stalled(): boolean {
    return !this.anyWrite && this.consecutiveSameFile >= this.threshold;
  }
}

const BUILD_OR_TEST_RE =
  /\b(npm run (build|test|lint)|pnpm (run )?(build|test|lint)|yarn (build|test|lint)|tsc(\s+--noEmit)?|vitest|jest|npm test)\b/i;

const GREEN_BUILD_RE =
  /\b(build (passes|is (clean|green)|succeeded)|tests? (pass(es|ing|ed)?|green)|(clean|green) (build|tests)|9\/\d passing|\d+\/\d+ (passing|tests? passed)|✅|passes|green|clean)\b/i;

/**
 * True if `text` asserts a green build/test/lint outcome. Used to block such claims when
 * the verify command just tripped the circuit breaker without a real successful run.
 * Fires when the text names a verify command (npm/vitest/tsc/...) OR explicitly references
 * the build/test/lint being green.
 */
export function isGreenBuildTestClaim(text: string): boolean {
  const namesVerify = BUILD_OR_TEST_RE.test(text) || /\b(build|tests?|lint(ing)?)\b/i.test(text);
  return namesVerify && GREEN_BUILD_RE.test(text);
}

/** True when `text` reports that a verify command (build/test/lint) was run successfully. */
export function isVerifyRunReport(text: string): boolean {
  return BUILD_OR_TEST_RE.test(text) && /\b(pass|passed|clean|green|✅|0 errors|succeed)/i.test(text);
}

/**
 * Detects a fabricated test-count claim in a summary. The executor sometimes reports
 * "All N tests passing" / "X/Y passing" with a number that was NEVER produced by an actual
 * verify run this session (e.g. inventing "3 greet + 9 validation.test.ts" = 21 tests when
 * no such files exist). Returns a correction message if `text` asserts a specific passing
 * count that disagrees with `lastActualPassCount` (the last real `npm test` output), else null.
 *
 * A claim is only flagged when it names a concrete count AND we have a real observed count
 * to compare against (so legitimate "tests green" without a number is never blocked).
 */
export function fabricatedTestCountCorrection(text: string, lastActualPassCount: number | undefined): string | null {
  if (lastActualPassCount === undefined) return null; // nothing to compare against
  const claimMatch = text.match(/(\d+)\s*\/\s*\d+\s*(?:passing|passed)|all\s+(\d+)\s+tests?\s+passing|(\d+)\s+tests?\s+pass(?:ing|ed)|(\d+)\s*(?:passed|passing)/i);
  if (!claimMatch) return null;
  const claimed = parseInt(claimMatch[1] ?? claimMatch[2] ?? claimMatch[3] ?? claimMatch[4] ?? '', 10);
  if (Number.isNaN(claimed)) return null;
  if (claimed === lastActualPassCount) return null; // matches reality
  return `[VERIFY] Your summary claims ${claimed} tests passing, but the last actual \`npm test\` run reported ${lastActualPassCount} passing. Do not fabricate test counts — report the real number from the tool output (${lastActualPassCount}).`;
}

export const __test = { BUILD_OR_TEST_RE, GREEN_BUILD_RE, fabricatedTestCountCorrection };

// Divergence detector: catches the "agent loses focus and re-emits identical output"
// pathology. In a failing run the agent can, after a tool failure, simply restate a
// prior deliverable (e.g. re-print the same review) instead of making progress. We hash
// each assistant block and flag when the current block is near-identical to one already
// produced this turn budget — that is a spin, not work. The loop then forces the agent to
// either change the repo or report the blocker honestly.
const DIVERGENCE_WINDOW = 6;
const DIVERGENCE_SIMILARITY = 0.9;

function shingles(text: string, size = 4): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const set = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) {
    set.add(words.slice(i, i + size).join(' '));
  }
  // Short blocks (< size words) still compare by their single token set so trivial
  // repeats ("Done.") are caught, not ignored.
  if (set.size === 0 && words.length > 0) set.add(words.join(' '));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return a.size === b.size ? 1 : 0;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export class DivergenceDetector {
  private blocks: string[] = [];

  /**
   * Register an assistant block. Returns true when the new block is near-identical
   * (>= DIVERGENCE_SIMILARITY Jaccard over word-shingles) to any of the last
   * DIVERGENCE_WINDOW blocks — a sign the agent is re-stating completed work.
   */
  register(text: string): boolean {
    const norm = (text || '').trim();
    if (norm.length < 40) return false; // ignore tiny blocks (acknowledgements, etc.)
    const sh = shingles(norm);
    let best = 0;
    const recent = this.blocks.slice(-DIVERGENCE_WINDOW);
    for (const prev of recent) {
      const sim = jaccard(sh, shingles(prev));
      if (sim > best) best = sim;
    }
    this.blocks.push(norm);
    if (this.blocks.length > DIVERGENCE_WINDOW * 2) {
      this.blocks = this.blocks.slice(-DIVERGENCE_WINDOW * 2);
    }
    return best >= DIVERGENCE_SIMILARITY;
  }

  reset(): void {
    this.blocks = [];
  }
}

// Stale-read recovery: when a write tool (patch/write_file) fails because the file was
// modified since the agent last read it (the "STALE READ" / old-string-not-found case),
// blindly retrying the same patch wastes turns. Detect the stale-read error and return the
// path so the loop can auto-read the current content and inject it, giving the next attempt
// fresh bytes instead of another blind retry.
const STALE_READ_RE =
  /stale read|was modified after you last read it|old string not found|did not match|no match|the string to (replace|find) was not found|patch did not apply/i;

export function isStaleReadFailure(toolName: string, errorText: string): { stale: boolean; path?: string } {
  const writeTools = ['patch', 'write_file'];
  if (!writeTools.includes(toolName)) return { stale: false };
  const text = errorText || '';
  if (!STALE_READ_RE.test(text)) return { stale: false };
  // Try to extract the file path from the error. Accepts either a full path
  // (C:/repo/src/x.ts or /repo/src/x.ts) or a bare filename (package.json).
  // Longer extensions are listed first so e.g. ".json" is not partial-matched by ".js".
  const pathMatch = text.match(
    /(?:[A-Za-z]:)?[\\/][\w.\-//\\]+\.(?:json|tsx|jsx|cjs|mjs|ts|js|py|go|rs|java|cs|rb|php|md|css|html)|\b[\w.\-]+\.(?:json|tsx|jsx|cjs|mjs|ts|js|py|go|rs|java|cs|rb|php|md|css|html)/i,
  );
  return { stale: true, path: pathMatch ? pathMatch[0] : undefined };
}

export const __test_helpers = { shingles, jaccard, DIVERGENCE_SIMILARITY, DIVERGENCE_WINDOW };
