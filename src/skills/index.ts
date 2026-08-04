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

export interface Skill {
  name: string;
  description: string;
  trigger?: string;
  safety: 'instructions' | 'executable';
  body: string;
  source: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

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
        });
      } catch {
        // Skip unreadable/unparseable skill files.
      }
    }
  }
  cache = out;
  return out;
}

export function matchSkills(request: string): Skill[] {
  const req = (request || '').toLowerCase();
  if (!req) return [];
  return discoverSkills().filter((s) => {
    if (s.safety !== 'instructions') return false; // beta: instructions-only
    const trig = (s.trigger || '').toLowerCase();
    if (!trig) return false;
    return trig.split('|').some((t) => {
      const term = t.trim();
      return term.length > 0 && req.includes(term);
    });
  });
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
}
