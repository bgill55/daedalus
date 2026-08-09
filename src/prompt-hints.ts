import pc from 'picocolors';

export interface PromptHint {
  category: string;
  tip: string;
  example: string;
}

export const PROMPT_HINTS: PromptHint[] = [
  {
    category: 'Code Review',
    tip: 'Give explicit criteria like architecture, test coverage, and 3 key recommendations.',
    example: 'Review <folder>: summarize architecture, test gaps, and 3 key improvements.',
  },
  {
    category: 'Auto-Enhance',
    tip: 'Use /enhance to expand casual questions into structured engineering prompts.',
    example: '/enhance look at this project and tell me what you think',
  },
  {
    category: 'Debugging',
    tip: 'Include the exact error message or stack trace alongside the file path.',
    example: 'Fix error in src/server.ts: TypeError cannot read property of undefined on line 42',
  },
  {
    category: 'Feature Additions',
    tip: 'Specify input/output behavior and preferred dependencies or patterns.',
    example: 'Add JWT auth middleware in src/middleware/auth.ts using jsonwebtoken',
  },
  {
    category: 'Refactoring',
    tip: 'State what should remain unchanged (API contract, tests) while refactoring.',
    example: 'Refactor src/db.ts to use SQLite WAL mode while preserving all existing function signatures',
  },
];

export function getRandomPromptHint(): string {
  const index = Math.floor(Math.random() * PROMPT_HINTS.length);
  const h = PROMPT_HINTS[index];
  return `${pc.cyan('💡 Tip')} ${pc.dim(`[${h.category}]:`)} ${h.tip}\n   ${pc.dim('Try:')} ${pc.yellow(`"${h.example}"`)}`;
}
