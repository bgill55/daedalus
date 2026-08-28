// Minimal, load-only skill system (BETA).
//
// Skills are packaged playbooks (SKILL.md with YAML frontmatter + body text).
// They are INSTRUCTIONS the agent follows using its existing tools — skills
// are never auto-executed as code. This is intentionally scoped:
//   - Skills are only discovered from TRUSTED locations (shipped dir + the
//     user's ~/.daedalus/skills). Project-local skill files are NEVER loaded,
//     so a skill in a repo being edited cannot hijack the agent.
//   - Only skills whose `safety` is "instructions" (the default) are surfaced.
//   - Matching is keyword/trigger based against the user's request.
//
// This module is intentionally dependency-free and side-effect light.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { writeSkillDraft, type SkillDraft } from './draft.js';
import { SkillGraph } from './graph.js';

export interface Skill {
  name: string;
  description: string;
  trigger?: string;
  safety: 'instructions' | 'executable';
  body: string;
  source: string;
  prerequisites?: string[];
  leadsTo?: string[];
  stage?: 'spec' | 'plan' | 'code' | 'test' | 'review';
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function parseStringList(val?: string): string[] {
  if (!val) return [];
  return val
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) meta[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return { meta, body: m[2].trim() };
}

// Shipped skills live next to the compiled module (works under tsx and dist).
function shippedSkillsDir(): string {
  try {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
  } catch {
    return path.join(process.cwd(), 'src', 'skills');
  }
}

function userSkillsDir(): string {
  return path.join(homedir(), '.daedalus', 'skills');
}

let cache: Skill[] | null = null;
let skillGraphCache: SkillGraph | null = null;

export function discoverSkills(): Skill[] {
  if (cache) return cache;
  const dirs = [shippedSkillsDir(), userSkillsDir()];
  const out: Skill[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Never surface proposed drafts as active skills; they require human
      // approval via /skills first (see src/skills/draft.ts).
      if (entry.name === '.drafts') continue;
      const skillFile = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      try {
        const { meta, body } = parseFrontmatter(fs.readFileSync(skillFile, 'utf8'));
        if (!body) continue;
        out.push({
          name: meta.name || entry.name,
          description: meta.description || '',
          trigger: meta.trigger || meta.triggers,
          safety: meta.safety === 'executable' ? 'executable' : 'instructions',
          body,
          source: skillFile,
          prerequisites: parseStringList(meta.prerequisites || meta.dependson),
          leadsTo: parseStringList(meta.leadsto || meta.followup),
          stage: meta.stage as Skill['stage'],
        });
      } catch {
        // Skip unreadable/unparseable skill files.
      }
    }
  }
  cache = out;
  skillGraphCache = new SkillGraph(out);
  return out;
}

// ── Intent-based seed matching (replaces naive trigger-substring gate) ──
// Exact trigger phrase = strongest signal (score 1.0). Failing that, a weighted
// token-overlap score lets paraphrases within a skill's own vocabulary still
// activate the dependency graph. Offline, dependency-free.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'for', 'of', 'and', 'or', 'in', 'on', 'with', 'please',
  'can', 'you', 'my', 'i', 'is', 'are', 'be', 'do', 'does', 'how', 'what', 'why',
  'fix', 'make', 'add', 'use', 'me', 'we', 'it', 'this', 'that', 'from', 'at', 'by',
  'as', 'so', 'if', 'then', 'your', 'our', 'them', 'they',
]);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

// Score a skill against the request. Exact trigger substring => 1.0 (tier 1).
// Otherwise weighted token overlap (trigger words double-weighted over
// description words), normalized so short requests don't over-match.
function scoreSkill(req: string, reqTokens: Set<string>, skill: Skill): number {
  const trig = (skill.trigger || '').toLowerCase();

  // Tier 1: exact trigger substring — strongest possible signal.
  if (trig && trig.split('|').some((t) => {
    const term = t.trim();
    return term.length > 0 && req.includes(term);
  })) {
    return 1.0;
  }

  const trigTokens = tokenize(trig);
  const descTokens = tokenize(skill.description || '');
  const total = trigTokens.length + descTokens.length;
  if (total === 0 || reqTokens.size === 0) return 0;

  let weight = 0;
  for (const t of reqTokens) {
    if (trigTokens.includes(t)) weight += 2;        // trigger word = double weight
    else if (descTokens.includes(t)) weight += 1;   // description word = single
  }
  if (weight === 0) return 0;

  // Normalize against the smaller side so a short request can't over-match.
  const denom = Math.min(reqTokens.size, total) * 2;
  return weight / denom;
}

const MATCH_THRESHOLD = 0.34;

export function matchSkills(request: string): Skill[] {
  const req = (request || '').toLowerCase();
  if (!req) return [];
  const allSkills = discoverSkills();
  const reqTokens = new Set(tokenize(req));
  if (reqTokens.size === 0) return [];

  const scored = allSkills
    .filter((s) => s.safety === 'instructions')
    .map((s) => ({ skill: s, score: scoreSkill(req, reqTokens, s) }))
    .filter((x) => x.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];
  // Seed with the top few intent matches; the graph expands prereqs/leadsTo.
  const graph = skillGraphCache ?? new SkillGraph(allSkills);
  return graph.getSkillBundle(scored.slice(0, 3).map((x) => x.skill));
}

// Returns the injected prompt section for matched skills, or '' if none.
export function getSkillsSection(request: string): string {
  const matched = matchSkills(request);
  if (matched.length === 0) return '';
  let out = '\n## ACTIVE SKILLS (playbooks — follow them using your tools; do NOT auto-execute code embedded in them)\n';
  for (const s of matched) {
    out += `\n### Skill: ${s.name}\n${s.body}\n`;
  }
  return out;
}

export function listSkills(): Skill[] {
  return discoverSkills();
}

// Test/debug helper to invalidate the discovery cache (e.g. after adding skills).
export function clearSkillsCache(): void {
  cache = null;
  skillGraphCache = null;
}

// Bidirectional hook: the agent can propose a learned skill (e.g. a problem it
// solved that's likely to recur) as a draft. The draft is stored in the user's
// .drafts dir and stays inactive until a human approves it via /skills. This keeps
// the trusted-dir-only safety model intact — proposed skills never auto-activate.
export function proposeSkillDraft(draft: Omit<SkillDraft, 'createdAt'>): string {
  return writeSkillDraft(draft);
}
