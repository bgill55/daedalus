import pc from 'picocolors';

export interface PromptHint {
  category: string;
  tip: string;
  example: string;
  // Optional stack tags (see classifyStack in src/config/stack.ts). When set,
  // the hint is only eligible for projects whose detected stack intersects
  // this list. Hints without `stacks` are always eligible (generic fallback).
  stacks?: string[];
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
  // Stack-specific hints — only shown when the detected project matches.
  {
    category: 'React / Next.js',
    tip: 'Scaffold a route and keep data fetching in a server component; push interactivity into a small "use client" leaf.',
    example: 'Add a /dashboard route that loads stats server-side and streams them into a client chart',
    stacks: ['react', 'next'],
  },
  {
    category: 'Vue / Svelte',
    tip: 'Co-locate component state and keep the store as the single source of truth for shared data.',
    example: 'Add a Pinia/Svelte store for cart state and wire it into the product list component',
    stacks: ['vue', 'svelte'],
  },
  {
    category: 'Python',
    tip: 'Pair every bug report with a failing test so the fix is verifiable. Use /enhance to draft the case.',
    example: '/enhance reproduce the CSV parse crash as a pytest then fix it',
    stacks: ['python'],
  },
  {
    category: 'Rust',
    tip: 'Ask for a panic-safe change that keeps public API signatures intact and compiles under cargo clippy.',
    example: 'Refactor the parser to use Result instead of unwrap while keeping the public API stable',
    stacks: ['rust'],
  },
  {
    category: 'Go',
    tip: 'Keep interfaces small and let the compiler enforce errors; ask for table-driven tests.',
    example: 'Add a Validate method to the Config struct with table-driven tests for each bad case',
    stacks: ['go'],
  },
  {
    category: 'TypeScript',
    tip: 'Prefer typed Zod schemas at boundaries over scattered casts; let the compiler catch shape drift.',
    example: 'Add a Zod schema for the /login payload and validate it before calling the service',
    stacks: ['typescript'],
  },
];

/**
 * Return a random prompt hint, biased toward the project's detected stack when
 * `stackTags` is supplied. Hints whose `stacks` intersect the project are
 * preferred; if none match, a generic hint is returned so the user always gets
 * a tip. Never calls an LLM or touches the filesystem — safe for first-turn use.
 */
export function getRandomPromptHint(stackTags?: Iterable<string>): string {
  let pool = PROMPT_HINTS;
  if (stackTags) {
    const tags = new Set(stackTags);
    if (tags.size > 0) {
      const matched = PROMPT_HINTS.filter(
        (h) => !h.stacks || h.stacks.some((s) => tags.has(s))
      );
      // Prefer stack-matched hints, but fall back to the full pool if the
      // project matched no specific hint (keeps a tip on screen every time).
      if (matched.some((h) => h.stacks)) pool = matched;
    }
  }
  const h = pool[Math.floor(Math.random() * pool.length)];
  return `${pc.cyan('💡 Tip')} ${pc.dim(`[${h.category}]:`)} ${h.tip}\n   ${pc.dim('Try:')} ${pc.yellow(`"${h.example}"`)}`;
}
