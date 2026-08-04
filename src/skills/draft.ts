// Skill draft store — the "agent -> user" half of the bidirectional skill loop.
//
// The shipped skill system is load-only and trusted-dir-only (src/skills + the
// user's ~/.daedalus/skills). To make it bidirectional without weakening that
// safety model, the agent can PROPOSE a learned skill as a *draft*. Drafts live
// in ~/.daedalus/skills/.drafts/, which discoverSkills() deliberately ignores, so
// a proposed skill never becomes active until a human approves it via /skills.
//
// Nothing here ever writes to the shipped skills dir or to a project-local path.

import fs from 'fs';
import path from 'path';
import { homedir } from 'os';

export interface SkillDraft {
  name: string;
  description: string;
  trigger: string;
  safety: 'instructions' | 'executable';
  body: string;
  createdAt: string;
}

function userSkillsDir(): string {
  return path.join(homedir(), '.daedalus', 'skills');
}

function draftsDir(): string {
  return path.join(userSkillsDir(), '.drafts');
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'unnamed';
}

/** Persist a proposed skill as a draft JSON file. Returns the draft file path. */
export function writeSkillDraft(draft: Omit<SkillDraft, 'createdAt'>): string {
  const dir = draftsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slugify(draft.name)}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...draft, createdAt: new Date().toISOString() }, null, 2), 'utf8');
  return file;
}

/** List all pending skill drafts. */
export function listSkillDrafts(): SkillDraft[] {
  const dir = draftsDir();
  if (!fs.existsSync(dir)) return [];
  const out: SkillDraft[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8'));
      if (parsed && typeof parsed.name === 'string' && typeof parsed.body === 'string') {
        out.push(parsed as SkillDraft);
      }
    } catch {
      // Skip unreadable draft files.
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

function draftPath(name: string): string {
  return path.join(draftsDir(), `${slugify(name)}.json`);
}

/**
 * Approve a draft: move it into the user's trusted skills dir as an active
 * SKILL.md. Returns the path of the created skill, or null if the draft is gone.
 */
export function acceptSkillDraft(name: string): string | null {
  const src = draftPath(name);
  if (!fs.existsSync(src)) return null;
  const draft = JSON.parse(fs.readFileSync(src, 'utf8')) as SkillDraft;
  const skillDir = path.join(userSkillsDir(), slugify(draft.name));
  fs.mkdirSync(skillDir, { recursive: true });
  const skillFile = path.join(skillDir, 'SKILL.md');
  const safety = draft.safety === 'executable' ? 'executable' : 'instructions';
  const frontmatter = [
    '---',
    `name: ${draft.name}`,
    `description: ${draft.description}`,
    `trigger: ${draft.trigger}`,
    `safety: ${safety}`,
    '---',
    '',
  ].join('\n');
  fs.writeFileSync(skillFile, frontmatter + draft.body.trim() + '\n', 'utf8');
  fs.rmSync(src);
  return skillFile;
}

/** Discard a draft. Returns true if a draft was removed. */
export function discardSkillDraft(name: string): boolean {
  const src = draftPath(name);
  if (!fs.existsSync(src)) return false;
  fs.rmSync(src);
  return true;
}
