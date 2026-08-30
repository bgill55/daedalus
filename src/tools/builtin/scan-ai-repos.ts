import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ToolContext, ToolResult } from '../../types.js';
import { initIndexDb, searchSymbols, getIndexedFileCount } from '../../indexing/fts.js';
import { indexCodebase } from '../../indexing/indexer.js';
import type Database from 'better-sqlite3';

const DEFAULT_TOP = 10;
const DEFAULT_QUERY = 'topic:ai stars:>1000';

interface Repo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  topics: string[];
}

/** Search GitHub for top AI repositories. Token from env only — never reads .env. */
async function searchGitHubRepos(
  query: string,
  token: string | undefined,
  perPage = 100
): Promise<Repo[]> {
  const params = new URLSearchParams({ q: query, per_page: String(perPage), page: '1' });
  const url = `https://api.github.com/search/repositories?${params.toString()}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'daedalus-scan-ai-repos',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub search failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { items?: unknown[] };
  return (data.items ?? []).map((it) => {
    const r = it as Record<string, unknown>;
    return {
      full_name: String(r.full_name),
      html_url: String(r.html_url),
      description: (r.description as string | null) ?? null,
      stargazers_count: Number(r.stargazers_count ?? 0),
      language: (r.language as string | null) ?? null,
      topics: Array.isArray(r.topics) ? (r.topics as string[]) : [],
    };
  });
}

/** Take the top-N repos by stars (stable sort). */
function takeTop(repos: Repo[], n: number): Repo[] {
  return [...repos].sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, n);
}

/**
 * Analyze the current project's FTS index for each repo's notable signals and
 * produce FILE-SPECIFIC suggestions (where a pattern is present, partial, or
 * missing) — not generic templates. Works from the index, so it functions
 * whether Daedalus is run from source or installed via npm (no raw src/ needed).
 */
// Capability keywords worth checking for in a coding-agent project. Repo
// topics are authoritative; description nouns are noisy, so only these curated
// terms are extracted from descriptions.
const CAPABILITY_KEYWORDS = [
  'cli', 'agent', 'agents', 'mcp', 'rag', 'workflow', 'workflows',
  'router', 'routing', 'plugin', 'plugins', 'tool', 'tools', 'memory',
  'orchestrat', 'automate', 'automation', 'scaffold', 'self-host',
  'local', 'inference', 'embedding', 'vector', 'vision', 'voice',
  'multimodal', 'reasoning', 'index', 'retrieval', 'function-calling',
];

/**
 * Analyze the current project's FTS index for each repo's notable signals and
 * produce FILE-SPECIFIC suggestions (where a pattern is present, partial, or
 * missing) — not generic templates. Works from the index, so it functions
 * whether Daedalus is run from source or installed via npm (no raw src/ needed).
 */
function analyzeAgainstProject(
  repos: Repo[],
  context: ToolContext,
  db: Database.Database
): { repo: Repo; findings: string[] }[] {
  const out: { repo: Repo; findings: string[] }[] = [];
  for (const repo of repos) {
    // Signals: repo topics (authoritative) + curated capability keywords from
    // description. Filter BOTH to the capability vocabulary so brand/noise topics
    // (e.g. "lobster", "molty") don't become false "missing" suggestions.
    const desc = (repo.description ?? '').toLowerCase();
    const kw = CAPABILITY_KEYWORDS.filter((k) => desc.includes(k));
    const topicSignals = repo.topics.map((t) => t.toLowerCase()).filter((t) => CAPABILITY_KEYWORDS.includes(t));
    const signals = [...new Set([...topicSignals, ...kw])];
    const findings: string[] = [];
    for (const sig of signals.slice(0, 5)) {
      const clean = sig.replace(/[^a-z0-9]/gi, '');
      if (clean.length < 3) continue;
      let foundPath: string | undefined;
      try {
        // Match symbol names OR file paths so module-level capabilities
        // (e.g. src/agents/, src/tools/mcp/) are detected, not just symbols.
        const symHits = searchSymbols(db, clean, context.projectHash, 3) as unknown as {
          file_path: string;
          name: string;
          kind: string;
        }[];
        if (symHits.length > 0) {
          foundPath = `${symHits[0].file_path} (${symHits[0].kind} ${symHits[0].name})`;
        } else {
          const pathHits = db
            .prepare('SELECT DISTINCT file_path FROM symbols WHERE project_hash = ? AND file_path LIKE ? LIMIT 3')
            .all(context.projectHash, `%${clean}%`) as { file_path: string }[];
          if (pathHits.length > 0) foundPath = pathHits[0].file_path;
        }
      } catch {
        foundPath = undefined;
      }
      if (foundPath) {
        findings.push(
          `• "${sig}" — ALREADY PRESENT in ${foundPath}. Consider deepening vs. ${repo.full_name}.`
        );
      } else {
        findings.push(
          `• "${sig}" — NOT in this project. ${repo.full_name} (${repo.html_url}) implements it; candidate for porting.`
        );
      }
    }
    if (findings.length === 0) {
      findings.push('• No directly-mappable capability signals; review architecture holistically.');
    }
    out.push({ repo, findings });
  }
  return out;
}

function formatReport(
  top: number,
  analyzed: { repo: Repo; findings: string[] }[]
): string {
  const lines: string[] = [];
  lines.push(`# AI-Repo Scan — top ${analyzed.length} repositories`);
  lines.push('');
  for (const { repo, findings } of analyzed) {
    lines.push(`## ${repo.full_name}  (${repo.stargazers_count.toLocaleString()} ★, ${repo.language ?? 'n/a'})`);
    lines.push(`URL: ${repo.html_url}`);
    if (repo.description) lines.push(`Description: ${repo.description}`);
    lines.push('Findings vs. this project:');
    for (const f of findings) lines.push(`  ${f}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Create a GitHub issue via gh (uses gh's own credential, not GITHUB_TOKEN). */
function createGitHubIssue(repo: string, title: string, body: string): { url: string; number: number } {
  const tmp = path.join(os.tmpdir(), `daedalus-scan-${Date.now()}.md`);
  fs.writeFileSync(tmp, body, 'utf-8');
  const ghEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'GITHUB_TOKEN' || k === 'GH_TOKEN') continue;
    ghEnv[k] = v;
  }
  const out = execFileSync('gh', ['issue', 'create', '--repo', repo, '--title', title, '--body-file', tmp], {
    encoding: 'utf-8',
    env: ghEnv,
  }).trim();
  const urlMatch = out.match(/https?:\/\/github\.com\/[^\s]+/);
  const url = urlMatch ? urlMatch[0] : out;
  const numMatch = url.match(/\/issues\/(\d+)/);
  return { url, number: numMatch ? Number(numMatch[1]) : 0 };
}

function deriveRepoFromGit(projectRoot: string): string | undefined {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
    return m ? `${m[1]}/${m[2]}` : undefined;
  } catch {
    return undefined;
  }
}

export async function scanAiRepos(
  args: { top?: number; query?: string; issue?: boolean; repo?: string },
  context: ToolContext
): Promise<ToolResult> {
  const top = Math.min(Math.max(Number(args.top) || DEFAULT_TOP, 1), 20);
  const query = args.query?.trim() || DEFAULT_QUERY;
  const token = process.env.GITHUB_TOKEN || undefined;

  let repos: Repo[];
  try {
    repos = await searchGitHubRepos(query, token);
  } catch (err) {
    return {
      toolCallId: '',
      name: 'scan_ai_repos',
      success: false,
      content: '',
      error: `GitHub scan failed: ${(err instanceof Error ? err.message : String(err))}`,
    };
  }

  const selected = takeTop(repos, top);

  const db: Database.Database = context.indexDb ?? initIndexDb(
    path.join(os.homedir(), '.daedalus', 'indexing', `${context.projectHash}.sqlite`)
  );
  // Ensure the project is indexed so the analysis reflects real code, not an
  // empty table. Cheap no-op when files are already hashed.
  try {
    if (getIndexedFileCount(db, context.projectHash) === 0) {
      await indexCodebase(db, context.projectRoot, context.projectHash, {});
    }
  } catch {
    // Analysis still runs against whatever symbols exist; best-effort index.
  }

  const analyzed = analyzeAgainstProject(selected, context, db);
  const report = formatReport(top, analyzed);
  const header = `AI-Repo Scan (project: ${context.projectRoot})\n\n`;
  const full = header + report;

  let issueUrl = '';
  if (args.issue) {
    let target = args.repo?.trim();
    if (!target) target = deriveRepoFromGit(context.projectRoot);
    if (!target) target = 'bgill55/daedalus';
    try {
      const issue = createGitHubIssue(target, `AI-repo scan: top-${top} patterns & suggestions`, full);
      issueUrl = `\n\nIssue created: ${issue.url}`;
    } catch (err) {
      return {
        toolCallId: '',
        name: 'scan_ai_repos',
        success: false,
        content: full,
        error: `Scan succeeded but issue creation failed: ${(err instanceof Error ? err.message : String(err))}`,
      };
    }
  }

  return {
    toolCallId: '',
    name: 'scan_ai_repos',
    success: true,
    content: full + issueUrl,
  };
}
