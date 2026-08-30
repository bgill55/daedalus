import { describe, it, expect } from 'vitest';
import { commandsList, HELP_CATEGORY_NAMES } from './index.js';

describe('command registration documentation guard', () => {
  it('every registered command is listed in the /help category map (no silent "Other")', () => {
    const categorized = new Set<string>(
      Object.values(HELP_CATEGORY_NAMES).flat()
    );

    const uncategorized = commandsList
      .map((c) => c.name.replace('/', ''))
      .filter((name) => !categorized.has(name));

    // A command not present here silently falls into the /help "Other" bucket and
    // is effectively undocumented in the man page. Adding a command must register
    // it in HELP_CATEGORY_NAMES (mirror the daedalus-slash-command-docify flow).
    expect(uncategorized).toEqual([]);
  });
});
