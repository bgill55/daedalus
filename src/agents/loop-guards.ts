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

  constructor(private threshold = DEFAULT_STALL_THRESHOLD) {}

  /**
   * Record a read tool result. Returns true once the SAME file has been read
   * `threshold` times and the turn has not written any file in between (which would
   * reset the stall — repeated reads while actively iterating on a patch are fine).
   * `filePath` should be the normalized path from the read_file result's resolved path.
   */
  registerRead(filePath: string | undefined): boolean {
    if (this.anyWrite) return false;
    if (!filePath) return false;
    const next = (this.counts.get(filePath) ?? 0) + 1;
    this.counts.set(filePath, next);
    return next >= this.threshold;
  }

  /** A successful file write breaks the stall assumption for the rest of the turn. */
  registerWrite(): void {
    this.anyWrite = true;
    this.counts.clear();
  }

  get readCount(): number {
    let max = 0;
    for (const v of this.counts.values()) max = Math.max(max, v);
    return max;
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

export const __test = { BUILD_OR_TEST_RE, GREEN_BUILD_RE };
