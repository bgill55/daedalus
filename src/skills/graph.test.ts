import { describe, it, expect } from 'vitest';
import { SkillGraph } from './graph.js';
import type { Skill } from './index.js';

function makeSkill(name: string, prereqs: string[] = [], leads: string[] = [], stage?: Skill['stage']): Skill {
  return {
    name,
    description: `${name} description`,
    trigger: name.toLowerCase(),
    safety: 'instructions',
    body: `Body for ${name}`,
    source: `/mock/${name}/SKILL.md`,
    prerequisites: prereqs,
    leadsTo: leads,
    stage,
  };
}

describe('SkillGraph', () => {
  it('builds an empty graph safely', () => {
    const graph = new SkillGraph([]);
    expect(graph.getSkillBundle([])).toEqual([]);
  });

  it('returns initial match directly when no dependencies exist', () => {
    const skillA = makeSkill('Linting');
    const graph = new SkillGraph([skillA]);
    const bundle = graph.getSkillBundle([skillA]);
    expect(bundle.map((s) => s.name)).toEqual(['Linting']);
  });

  it('expands prerequisites and orders them before the matched skill', () => {
    const spec = makeSkill('Spec Design');
    const tdd = makeSkill('TDD Implementation', ['Spec Design'], ['Test Verification']);
    const test = makeSkill('Test Verification');

    const graph = new SkillGraph([spec, tdd, test]);
    // Match only TDD Implementation
    const bundle = graph.getSkillBundle([tdd]);

    // Should pull Spec Design (prereq) and Test Verification (leadsTo), ordered chronologically
    expect(bundle.map((s) => s.name)).toEqual(['Spec Design', 'TDD Implementation', 'Test Verification']);
  });

  it('respects maxBundleSize and prioritizes prerequisites over leadsTo', () => {
    const s1 = makeSkill('Step 1');
    const s2 = makeSkill('Step 2', ['Step 1'], ['Step 3']);
    const s3 = makeSkill('Step 3', [], ['Step 4']);
    const s4 = makeSkill('Step 4');

    const graph = new SkillGraph([s1, s2, s3, s4]);
    const bundle = graph.getSkillBundle([s2], 2);

    expect(bundle.length).toBe(2);
    expect(bundle.map((s) => s.name)).toEqual(['Step 1', 'Step 2']);
  });

  it('handles cyclic dependencies gracefully without infinite loop', () => {
    const s1 = makeSkill('Cyclic A', ['Cyclic B']);
    const s2 = makeSkill('Cyclic B', ['Cyclic A']);

    const graph = new SkillGraph([s1, s2]);
    const bundle = graph.getSkillBundle([s1]);

    expect(bundle.length).toBe(2);
    expect(bundle.map((s) => s.name)).toContain('Cyclic A');
    expect(bundle.map((s) => s.name)).toContain('Cyclic B');
  });
});
