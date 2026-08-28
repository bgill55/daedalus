import type { Skill } from './index.js';

export interface SkillGraphNode {
  skill: Skill;
  prerequisites: string[];
  leadsTo: string[];
  stage?: 'spec' | 'plan' | 'code' | 'test' | 'review';
}

function normalizeKey(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export class SkillGraph {
  private nodes = new Map<string, SkillGraphNode>();

  constructor(skills: Skill[] = []) {
    this.buildGraph(skills);
  }

  public buildGraph(skills: Skill[]): void {
    this.nodes.clear();
    for (const skill of skills) {
      const key = normalizeKey(skill.name);
      const prereqs = (skill.prerequisites ?? []).map(normalizeKey).filter(Boolean);
      const leads = (skill.leadsTo ?? []).map(normalizeKey).filter(Boolean);
      this.nodes.set(key, {
        skill,
        prerequisites: prereqs,
        leadsTo: leads,
        stage: skill.stage,
      });
    }
  }

  public getNode(name: string): SkillGraphNode | undefined {
    return this.nodes.get(normalizeKey(name));
  }

  /**
   * Expand matched skills into a topologically ordered causal bundle.
   * Includes essential prerequisites and recommended downstream steps up to maxBundleSize.
   */
  public getSkillBundle(initialMatches: Skill[], maxBundleSize = 4): Skill[] {
    if (initialMatches.length === 0) return [];
    if (this.nodes.size === 0) return initialMatches.slice(0, maxBundleSize);

    const activeKeys = new Set<string>();
    const queue: string[] = [];

    for (const match of initialMatches) {
      const k = normalizeKey(match.name);
      if (!activeKeys.has(k)) {
        activeKeys.add(k);
        queue.push(k);
      }
    }

    // 1. Expand prerequisites first (hard requirements)
    for (let i = 0; i < queue.length; i++) {
      const curr = this.nodes.get(queue[i]);
      if (curr) {
        for (const prereq of curr.prerequisites) {
          if (!activeKeys.has(prereq) && this.nodes.has(prereq) && activeKeys.size < maxBundleSize) {
            activeKeys.add(prereq);
            queue.push(prereq);
          }
        }
      }
    }

    // 2. Expand downstream recommendations (leadsTo) if budget remains
    for (let i = 0; i < queue.length && activeKeys.size < maxBundleSize; i++) {
      const curr = this.nodes.get(queue[i]);
      if (curr) {
        for (const next of curr.leadsTo) {
          if (!activeKeys.has(next) && this.nodes.has(next) && activeKeys.size < maxBundleSize) {
            activeKeys.add(next);
            queue.push(next);
          }
        }
      }
    }

    // 3. Topological sort over the active subgraph
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const key of activeKeys) {
      inDegree.set(key, 0);
      adjacency.set(key, []);
    }

    for (const key of activeKeys) {
      const node = this.nodes.get(key);
      if (!node) continue;

      for (const prereq of node.prerequisites) {
        if (activeKeys.has(prereq)) {
          adjacency.get(prereq)?.push(key);
          inDegree.set(key, (inDegree.get(key) ?? 0) + 1);
        }
      }

      for (const next of node.leadsTo) {
        if (activeKeys.has(next)) {
          adjacency.get(key)?.push(next);
          inDegree.set(next, (inDegree.get(next) ?? 0) + 1);
        }
      }
    }

    const sortQueue: string[] = [];
    for (const [key, deg] of inDegree.entries()) {
      if (deg === 0) sortQueue.push(key);
    }

    const orderedKeys: string[] = [];
    while (sortQueue.length > 0) {
      const curr = sortQueue.shift()!;
      orderedKeys.push(curr);

      for (const neighbor of adjacency.get(curr) ?? []) {
        const remaining = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, remaining);
        if (remaining === 0) {
          sortQueue.push(neighbor);
        }
      }
    }

    // If there were cycles, append any remaining active keys
    for (const key of activeKeys) {
      if (!orderedKeys.includes(key)) {
        orderedKeys.push(key);
      }
    }

    const result: Skill[] = [];
    for (const key of orderedKeys) {
      const node = this.nodes.get(key);
      if (node) result.push(node.skill);
    }

    return result.slice(0, maxBundleSize);
  }
}
