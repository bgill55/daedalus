import pc from 'picocolors';
import type { Command, CommandContext } from './types.js';
import { listSkills, clearSkillsCache } from '../skills/index.js';
import { listSkillDrafts, acceptSkillDraft, discardSkillDraft } from '../skills/draft.js';

function listActive(ctx: CommandContext): void {
  const skills = listSkills();
  console.log(pc.bold('\n=== Active Skills ==='));
  if (skills.length === 0) {
    console.log(pc.gray('  (none)'));
  } else {
    for (const s of skills) {
      console.log(`  ${pc.cyan(s.name)} ${pc.gray('—')} ${s.description || '(no description)'}`);
    }
  }
}

function listDrafts(): void {
  const drafts = listSkillDrafts();
  console.log(pc.bold('\n=== Pending Skill Drafts (inactive) ==='));
  if (drafts.length === 0) {
    console.log(pc.gray('  (none — the agent proposes drafts when it learns a reusable playbook)'));
    return;
  }
  for (const d of drafts) {
    console.log(`  ${pc.yellow(d.name)} ${pc.gray('—')} ${d.description || '(no description)'}`);
    console.log(pc.gray(`    trigger: ${d.trigger || '(none)'}`));
  }
  console.log(pc.gray('\n  Approve: /skills accept <name>   Discard: /skills discard <name>'));
}

export const skillsCommand: Command = {
  name: '/skills',
  description: 'List active skills and pending skill drafts; approve or discard agent-proposed drafts.',
  usage: '/skills [list|accept <name>|discard <name>]',
  helpText:
    'Shows the skills currently active for the agent and any drafts the agent has ' +
    'proposed from work it has done. Drafts are INACTIVE until you approve them — ' +
    'approving moves a draft into your trusted ~/.daedalus/skills directory as a real ' +
    'skill the agent can use. Discarding deletes the draft.\n\n' +
    '  /skills                 list active skills + pending drafts\n' +
    '  /skills accept <name>   promote a draft to an active trusted skill\n' +
    '  /skills discard <name>  delete a pending draft\n',
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const sub = (parts[0] || 'list').toLowerCase();

    if (sub === 'accept') {
      const name = parts.slice(1).join(' ').trim();
      if (!name) {
        console.log(pc.red('Specify a draft name: /skills accept <name>'));
        return true;
      }
      const path = acceptSkillDraft(name);
      if (!path) {
        console.log(pc.red(`No pending draft named "${name}". Run /skills to list drafts.`));
        return true;
      }
      clearSkillsCache();
      console.log(`${pc.green('✔')} Approved "${name}" as an active skill: ${pc.dim(path)}`);
      console.log(pc.gray('  It will now be matched and injected into the agent when its trigger keywords appear.'));
      return true;
    }

    if (sub === 'discard') {
      const name = parts.slice(1).join(' ').trim();
      if (!name) {
        console.log(pc.red('Specify a draft name: /skills discard <name>'));
        return true;
      }
      if (discardSkillDraft(name)) {
        console.log(`${pc.yellow('✗')} Discarded draft "${name}".`);
      } else {
        console.log(pc.red(`No pending draft named "${name}".`));
      }
      return true;
    }

    // list (default)
    listActive(ctx);
    listDrafts();
    console.log();
    return true;
  },
};
