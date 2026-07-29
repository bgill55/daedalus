import { describe, it, expect } from 'vitest';
import { getProjectHash } from '../../project-hash.js';
import { getIndexDbPath } from './indexing.js';

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

  it('get_call_graph returns formatted string or fallback message', async () => {
    const { get_call_graph } = await import('./indexing.js');
    const res = await get_call_graph({ symbol: 'UnknownSymbol' }, { projectRoot: process.cwd() } as any);
    expect(res.success).toBe(true);
    expect(res.content).toContain('No call graph data found');
  });

});
