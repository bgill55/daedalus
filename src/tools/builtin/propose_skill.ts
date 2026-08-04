import pc from 'picocolors';
import { ToolContext, ToolResult } from '../../types.js';
import { proposeSkillDraft } from '../../skills/index.js';

// The agent uses this to capture a reusable playbook it just discovered (a problem
// it solved that is likely to recur). The proposal is stored as an INACTIVE draft;
// it only becomes a real skill after the user approves it via the /skills command.
// This keeps the trusted-dir-only safety model: the agent can suggest, never activate.
export async function proposeSkill(
  args: { name: string; description: string; trigger: string; body: string },
  _context: ToolContext,
): Promise<ToolResult> {
  const { name, description, trigger, body } = args;
  if (!name || !body) {
    return {
      toolCallId: '',
      name: 'propose_skill',
      success: false,
      content: '',
      error: 'name and body are required to propose a skill.',
    };
  }
  try {
    const file = proposeSkillDraft({
      name,
      description: description || '',
      trigger: trigger || '',
      safety: 'instructions',
      body,
    });
    return {
      toolCallId: '',
      name: 'propose_skill',
      success: true,
      content:
        `${pc.green('✔')} Proposed skill "${name}" as a draft.\n` +
        `It is INACTIVE until you approve it. Review and enable it with the ${pc.cyan('/skills')} command.`,
    };
  } catch (err) {
    return {
      toolCallId: '',
      name: 'propose_skill',
      success: false,
      content: '',
      error: `Failed to write skill draft: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
