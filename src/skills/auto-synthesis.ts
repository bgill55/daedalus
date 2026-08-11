import fs from 'fs';
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
    .slice(0, 40);
}

export function synthesizeSkillFromTurn(
  userPrompt: string,
  turnSummary: string,
  projectRoot: string
): SynthesisResult {
  if (!userPrompt || userPrompt.length < 10) return { synthesized: false };
  if (!turnSummary || turnSummary.length < 30) return { synthesized: false };

  const slug = slugify(userPrompt);
  if (!slug || slug.length < 3) return { synthesized: false };

  const skillsDir = path.join(projectRoot, '.daedalus', 'skills');
  const draftsDir = path.join(skillsDir, 'drafts', slug);
  const activeDir = path.join(skillsDir, slug);

  // Skip if skill already exists (either active or draft)
  if (fs.existsSync(activeDir) || fs.existsSync(draftsDir)) {
    return { synthesized: false };
  }

  const skillContent = `---
name: "${userPrompt.slice(0, 50).replace(/"/g, '\\"')}"
description: "Auto-synthesized playbook from successful execution: ${userPrompt.slice(0, 80).replace(/"/g, '\\"')}"
triggers:
  - "${slug}"
---

# ${userPrompt.slice(0, 50)}

## Synthesized Context & Playbook
This skill playbook was auto-synthesized after a successful resolution.

### Original Intent
> ${userPrompt}

### Execution Recipe
${turnSummary}
`;

  try {
    fs.mkdirSync(draftsDir, { recursive: true });
    const targetFile = path.join(draftsDir, 'SKILL.md');
    fs.writeFileSync(targetFile, skillContent, 'utf8');
    return {
      synthesized: true,
      name: slug,
      filePath: targetFile,
    };
  } catch {
    return { synthesized: false };
  }
}
