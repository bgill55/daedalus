import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getProjectHash, getIndexDbPath } from './indexing.js';
import type { ToolContext } from '../../types.js';

describe('Indexing tool helpers', () => {

  it('getProjectHash returns consistent 12-char hash', () => {
    const hash = getProjectHash('/some/project/path');
    expect(hash).toHaveLength(12);
  });

  it('getProjectHash is deterministic for same path', () => {
    const h1 = getProjectHash('/same/path');
    const h2 = getProjectHash('/same/path');
    expect(h1).toBe(h2);
  });

  it('getProjectHash differs for different paths', () => {
    const h1 = getProjectHash('/path/a');
    const h2 = getProjectHash('/path/b');
    expect(h1).not.toBe(h2);
  });

  it('getIndexDbPath returns path ending with .sqlite', () => {
    const result = getIndexDbPath('/some/project');
    expect(result.endsWith('.sqlite')).toBe(true);
    expect(result).toContain('.daedalus');
    expect(result).toContain('indexing');
  });

  it('getIndexDbPath includes project hash in filename', () => {
    const hash = getProjectHash('/my-project');
    const path = getIndexDbPath('/my-project');
    expect(path).toContain(hash);
  });

});
