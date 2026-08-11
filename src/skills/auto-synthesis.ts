import { writeSkillDraft, listSkillDrafts } from './draft.js';
import path from 'path';

export interface SynthesisResult {
  synthesized: boolean;
  name?: string;
  filePath?: string;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Auto-synthesize a skill DRAFT from a successful turn. Writes to the shared
 * draft store (~/.daedalus/skills/.drafts/<slug>.json) so it surfaces in /skills
 * for human review/approval. Never becomes active until a human approves it.
 *
 * The draft store deliberately ignores project-local paths and the shipped
 * skills dir, so this can only ever propose — never auto-activate — a skill.
 */
export function synthesizeSkillFromTurn(
  userPrompt: string,
  turnSummary: string
): SynthesisResult {
  if (!userPrompt || userPrompt.length < 10) return { synthesized: false };
  if (!turnSummary || turnSummary.length < 30) return { synthesized: false };

  const slug = slugify(userPrompt);
  if (!slug || slug.length < 3) return { synthesized: false };

  // Skip if a draft for this slug already exists (avoids re-synthesizing every turn).
  const existing = listSkillDrafts().some(d => slugify(d.name) === slug || slugify(d.trigger) === slug);
  if (existing) return { synthesized: false };

  const name = userPrompt.slice(0, 50).replace(/"/g, '').trim();
  const description = `Auto-synthesized playbook from successful execution: ${userPrompt.slice(0, 80).replace(/"/g, '')}`;
  try {
    const filePath = writeSkillDraft({
      name,
      description,
      trigger: slug,
      // Synthesized playbooks are guidance only — never auto-executable.
      safety: 'instructions',
      body: `## Synthesized Context & Playbook\nThis skill playbook was auto-synthesized after a successful resolution.\n\n### Original Intent\n> ${userPrompt}\n\n### Execution Recipe\n${turnSummary}`,
    });
    return { synthesized: true, name: path.basename(filePath, '.json'), filePath };
  } catch {
    return { synthesized: false };
  }
}
