import { describe, it, expect } from 'vitest';
import { BoundedMap } from '../utils/bounded-map.js';

describe('BoundedMap', () => {
  it('respects maxSize when inserting items', () => {
    const map = new BoundedMap<string, number>(3);
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);

    expect(map.size).toBe(3);
    expect(map.get('a')).toBe(1);

    map.set('d', 4);

    expect(map.size).toBe(3);
    expect(map.has('a')).toBe(false);
    expect(map.get('b')).toBe(2);
    expect(map.get('c')).toBe(3);
    expect(map.get('d')).toBe(4);
  });

  it('evicts excess initial entries when constructed with entries > maxSize', () => {
    const entries: [string, number][] = [
      ['k1', 10],
      ['k2', 20],
      ['k3', 30],
      ['k4', 40],
    ];
    const map = new BoundedMap<string, number>(2, entries);

    expect(map.size).toBe(2);
    expect(map.has('k1')).toBe(false);
    expect(map.has('k2')).toBe(false);
    expect(map.get('k3')).toBe(30);
    expect(map.get('k4')).toBe(40);
  });

  it('handles re-inserting an existing key without unexpected eviction', () => {
    const map = new BoundedMap<string, number>(2);
    map.set('x', 1);
    map.set('y', 2);
    map.set('x', 99);

    expect(map.size).toBe(2);
    expect(map.get('x')).toBe(99);
    expect(map.get('y')).toBe(2);
  });
});
