import { describe, it, expect } from 'vitest';
import { commandsList } from '../commands.js';

describe('/watch Command (Sprint 3)', () => {
  it('registers /watch in commandsList', () => {
    const watchCmd = commandsList.find(c => c.name === '/watch');
    expect(watchCmd).toBeDefined();
    expect(watchCmd?.description).toContain('file-watcher');
  });
});
