import { describe, it, expect } from 'vitest';
import { listMcpBundles, getMcpBundle, MCP_BUNDLES } from './bundles.js';

describe('MCP Bundles', () => {
  it('lists available preset bundles', () => {
    const bundles = listMcpBundles();
    expect(bundles.length).toBeGreaterThanOrEqual(5);
    const names = bundles.map(b => b.name);
    expect(names).toContain('web-dev');
    expect(names).toContain('cloud');
    expect(names).toContain('data-science');
    expect(names).toContain('full-stack');
    expect(names).toContain('dev-ops');
  });

  it('retrieves bundle by name (case-insensitive)', () => {
    const web = getMcpBundle('WEB-DEV');
    expect(web).toBeDefined();
    expect(web?.servers).toHaveLength(2);
    expect(web?.servers[0].name).toBe('github');
  });

  it('returns undefined for non-existent bundle', () => {
    const unknown = getMcpBundle('non-existent');
    expect(unknown).toBeUndefined();
  });
});
