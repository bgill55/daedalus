import { describe, it, expect } from 'vitest';
import { commandsList } from '../commands.js';

describe('/mcp explore (Sprint 4)', () => {
  it('registers /mcp in commandsList with explore help text', () => {
    const mcpCmd = commandsList.find(c => c.name === '/mcp');
    expect(mcpCmd).toBeDefined();
    expect(mcpCmd?.helpText).toContain('explore');
  });
});
