// Canonical secret detector — single source of truth for identifying and
// masking credentials across Daedalus (logs, model context, JSONL export,
// session memory, and the pre-commit leak guard).
//
// Two consumers must stay in sync: the masker (display/export) and the leak
// scanner (git guard). Both go through this module so a pattern added here
// protects every surface at once.

import { loadConfig } from '../config/index.js';
import { execSync } from 'child_process';

// Order matters: more specific prefixes first so sk-proj-… matches the
// OpenAI project-key rule rather than the generic sk- rule.
const SECRET_PATTERNS: RegExp[] = [
  // GitHub personal access tokens (classic + fine-grained)
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  // GitHub fine-grained PATs (github_pat_ prefix)
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // OpenAI
  /\bsk-(proj|ant)-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  // Anthropic
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\b(anthropic|claude)-[A-Za-z0-9_-]{20,}\b/g,
  // Stripe
  /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}\b/g,
  // Google API / service-account
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  // Slack
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  // AWS
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Generic high-entropy bearer / basic creds
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g,
  /\bBasic\s+[A-Za-z0-9+/=]{20,}\b/g,
  // Private key blocks
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
  // npm / package-registry tokens
  /\bnpm_[A-Za-z0-9]{36,}\b/g,
  // OneCLI / gateway access tokens (proxy-auth style)
  /\b(oc|onecli)_[A-Za-z0-9_-]{24,}\b/g,
];

export const REDACTED_SECRET = '[REDACTED_SECRET]';

function maskingEnabled(): boolean {
  try {
    return loadConfig().security?.redactSecrets !== false;
  } catch {
    return true;
  }
}

/**
 * Replace every detected credential in `text` with `[REDACTED_SECRET]`.
 * Returns the input unchanged when redaction is disabled in config.
 */
export function maskSecrets(text: string): string {
  if (!text || !maskingEnabled()) return text;
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, REDACTED_SECRET);
  }
  return out;
}

/** True when `text` contains at least one recognizable credential. */
export function findSecrets(text: string): boolean {
  if (!text) return false;
  return SECRET_PATTERNS.some((re) => re.test(text));
}

/**
 * Scan a git diff (unified, as `git diff`/`git diff --cached` emits) for
 * credentials in added/changed lines. Returns the offending lines (trimmed)
 * for surfacing in a refusal message.
 */
export function scanDiffForSecrets(diff: string): string[] {
  if (!diff) return [];
  const hits: string[] = [];
  for (const raw of diff.split('\n')) {
    // Only consider added/changed lines; context and removed lines are
    // out of scope (the agent may be reading an existing secret file, not
    // introducing one).
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    const line = raw.slice(1).trim();
    if (line && findSecrets(line)) {
      hits.push(line.length > 200 ? `${line.slice(0, 200)}…` : line);
    }
  }
  return hits;
}

/**
 * Collect staged (or working-tree) diff from `cwd` and report any credential
 * lines. Used by the pre-commit guard to block accidental secret commits.
 * Returns [] when not a git repo or on any spawn failure (fail open — the
 * commit is allowed; this is a guard, not an auth boundary).
 */
export function scanStagedDiffForSecrets(cwd: string): string[] {
  try {
    const diff = execSync('git diff --cached --no-color', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
      windowsHide: true,
    });
    return scanDiffForSecrets(diff);
  } catch {
    return [];
  }
}
