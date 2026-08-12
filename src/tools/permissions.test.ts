import { describe, it, expect } from 'vitest';
import { checkToolPermission } from './permissions.js';

describe('Tool Permissions', () => {
  it('allows all tools by default when policies are auto', () => {
    expect(checkToolPermission('terminal').allowed).toBe(true);
    expect(checkToolPermission('write_file').allowed).toBe(true);
    expect(checkToolPermission('read_file').allowed).toBe(true);
  });

  it('blocks terminal tool when policy is set to ask', () => {
    const res = checkToolPermission('terminal', { terminal: 'ask' });
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('[PERMISSION DENIED]');
  });

  it('blocks file mutation tools when policy is set to ask', () => {
    const res = checkToolPermission('patch', { files: 'ask' });
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('[PERMISSION DENIED]');
  });
});
