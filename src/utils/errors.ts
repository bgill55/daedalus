// Shared error-message helper, used across agent/orchestration/command code.
// Previously duplicated in several files; centralized here to avoid drift.

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
