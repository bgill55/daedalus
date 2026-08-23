import { describe, it, expect } from 'vitest';
import { commandsList } from './index.js';

describe('command registry integrity', () => {
  it('has exactly ONE /session command (no shadowed duplicate)', () => {
    const sessionCmds = commandsList.filter((c) => c.name === '/session');
    expect(sessionCmds.length).toBe(1);
    const cmd = sessionCmds[0];
    expect(typeof cmd.execute).toBe('function');
    // The surviving command must document + handle rename (the dedup must not
    // drop the rename subcommand that only the second (deleted) definition had).
    expect(cmd.helpText ?? '').toMatch(/rename/i);
  });

  it('every command has an execute handler and a helpText', () => {
    const broken = commandsList.filter((c) => typeof c.execute !== 'function' || !c.helpText);
    expect(broken.map((c) => c.name)).toEqual([]);
  });
});
