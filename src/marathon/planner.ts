import { LocalRouter } from '../router/index.js';
import { ChatMessage, messageText } from '../types.js';
import { MarathonMilestone } from './types.js';

export function buildMacroPlanningPrompt(macroGoal: string, projectContext: string = ''): string {
  return `You are Metis, the master architect and planner for the Daedalus Marathon Engine.
Your task is to decompose the following high-level project vision into an ordered sequence of 3 to 12 atomic, verifiable milestones.

## Project Vision:
${macroGoal}

## Project Context:
${projectContext || '(New project or clean workspace)'}

## Requirements for each Milestone:
1. Atomic & Focused: Changes 1 to 5 files maximum per milestone.
2. Ordered by Dependency: Foundation/Schema first, then Business Logic/APIs, then UI/Polish/Integration.
3. Verifiable: Must have explicit, measurable acceptance criteria.
4. Output Format: Pure JSON array of milestone objects with NO conversational wrapper:

[
  {
    "id": "m-1",
    "title": "Short title",
    "description": "Clear explanation of what is built in this milestone",
    "targetFiles": ["path/to/file1.ts", "path/to/file2.ts"],
    "acceptanceCriteria": [
      "Explicit testable requirement 1",
      "Explicit testable requirement 2"
    ],
    "verifyCommand": "npm test"
  }
]`;
}

export function parseMilestonesJson(raw: string): MarathonMilestone[] {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/```\s*$/, '');
  }

  try {
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr) || arr.length === 0) {
      return [];
    }

    return arr.map((item, index) => {
      const id = String(item.id || `m-${index + 1}`).toLowerCase();
      const title = String(item.title || `Milestone ${index + 1}`);
      const description = String(item.description || title);
      const targetFiles = Array.isArray(item.targetFiles) ? item.targetFiles.map(String) : [];
      const acceptanceCriteria = Array.isArray(item.acceptanceCriteria) && item.acceptanceCriteria.length > 0
        ? item.acceptanceCriteria.map(String)
        : ['Code compiles cleanly and tests pass'];
      const verifyCommand = item.verifyCommand ? String(item.verifyCommand) : undefined;

      const milestone: MarathonMilestone = {
        id,
        title,
        description,
        targetFiles,
        acceptanceCriteria,
        verifyCommand,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
      };
      return milestone;
    });
  } catch {
    return [];
  }
}

export async function planMarathonRoadmap(
  macroGoal: string,
  opts: {
    router: LocalRouter;
    modelOverride?: string;
    projectContext?: string;
  }
): Promise<MarathonMilestone[]> {
  const prompt = buildMacroPlanningPrompt(macroGoal, opts.projectContext);
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are Metis. Output pure JSON milestone array only.' },
    { role: 'user', content: prompt },
  ];

  try {
    const res = await opts.router.chat.completions.create({
      model: opts.modelOverride || 'intelligence',
      complexity: 'complex',
      messages,
      temperature: 0.2,
      max_tokens: 2500,
    });

    const text = messageText(res.choices?.[0]?.message?.content ?? '');
    const milestones = parseMilestonesJson(text);
    if (milestones.length > 0) {
      return milestones;
    }
  } catch {
    // Fallback on failure
  }

  // Fallback default milestone if model generation fails
  return [
    {
      id: 'm-1',
      title: 'Initial Implementation',
      description: `Implement core foundation for: ${macroGoal}`,
      targetFiles: [],
      acceptanceCriteria: ['Project builds without compiler errors', 'Basic unit tests pass'],
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
    },
  ];
}