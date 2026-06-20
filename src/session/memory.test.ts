import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  loadMemory,
  saveMemory,
  addFact,
  setConvention,
  getMemoryAsPrompt,
  ProjectMemory,
} from './memory.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daedalus-memory-test-'));
}

describe('Project memory', () => {
  let tmpDir: string;
  let memoryPath: string;
  const projectHash = 'testhash123';

  beforeEach(() => {
    tmpDir = makeTempDir();
    memoryPath = path.join(tmpDir, 'memory.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadMemory returns empty memory when no file exists', () => {
    const mem = loadMemory(memoryPath, projectHash);
    expect(mem.projectHash).toBe(projectHash);
    expect(mem.facts).toEqual([]);
    expect(mem.conventions).toEqual({});
  });

  it('loadMemory returns empty memory for corrupt file', () => {
    fs.writeFileSync(memoryPath, '{ broken json', 'utf8');
    const mem = loadMemory(memoryPath, projectHash);
    expect(mem.facts).toEqual([]);
  });

  it('loadMemory reads existing memory file', () => {
    const existing: ProjectMemory = {
      projectHash,
      facts: [{ key: 'framework', value: 'vitest', source: 'user', created: 100 }],
      conventions: { 'no comments': 'true' },
      updated_at: 100,
    };
    saveMemory(memoryPath, existing);

    const loaded = loadMemory(memoryPath, projectHash);
    expect(loaded.facts).toHaveLength(1);
    expect(loaded.facts[0].key).toBe('framework');
    expect(loaded.conventions['no comments']).toBe('true');
  });

  it('addFact creates a new fact', () => {
    addFact(memoryPath, projectHash, 'test-framework', 'vitest', 'user');
    const mem = loadMemory(memoryPath, projectHash);
    expect(mem.facts).toHaveLength(1);
    expect(mem.facts[0].key).toBe('test-framework');
    expect(mem.facts[0].value).toBe('vitest');
    expect(mem.facts[0].source).toBe('user');
  });

  it('addFact updates existing fact with same key', () => {
    addFact(memoryPath, projectHash, 'key', 'old', 'user');
    addFact(memoryPath, projectHash, 'key', 'new', 'agent');
    const mem = loadMemory(memoryPath, projectHash);
    expect(mem.facts).toHaveLength(1);
    expect(mem.facts[0].value).toBe('new');
    expect(mem.facts[0].source).toBe('agent');
  });

  it('addFact accumulates multiple facts', () => {
    addFact(memoryPath, projectHash, 'a', '1', 'user');
    addFact(memoryPath, projectHash, 'b', '2', 'agent');
    addFact(memoryPath, projectHash, 'c', '3', 'user');
    const mem = loadMemory(memoryPath, projectHash);
    expect(mem.facts).toHaveLength(3);
  });

  it('setConvention creates or updates a convention', () => {
    setConvention(memoryPath, projectHash, 'style', 'no comments');
    setConvention(memoryPath, projectHash, 'lint', 'strict');
    const mem = loadMemory(memoryPath, projectHash);
    expect(mem.conventions.style).toBe('no comments');
    expect(mem.conventions.lint).toBe('strict');
  });

  it('setConvention overwrites existing convention', () => {
    setConvention(memoryPath, projectHash, 'style', 'tabs');
    setConvention(memoryPath, projectHash, 'style', 'spaces');
    const mem = loadMemory(memoryPath, projectHash);
    expect(mem.conventions.style).toBe('spaces');
  });

  it('getMemoryAsPrompt returns empty string for empty memory', () => {
    const prompt = getMemoryAsPrompt(memoryPath, projectHash);
    expect(prompt).toBe('');
  });

  it('getMemoryAsPrompt includes conventions and facts', () => {
    setConvention(memoryPath, projectHash, 'style', 'no comments');
    addFact(memoryPath, projectHash, 'framework', 'vitest', 'agent');
    const prompt = getMemoryAsPrompt(memoryPath, projectHash);
    expect(prompt).toContain('no comments');
    expect(prompt).toContain('vitest');
    expect(prompt).toContain('PROJECT CONTEXT');
  });

  it('getMemoryAsPrompt includes only conventions when no facts', () => {
    setConvention(memoryPath, projectHash, 'lint', 'strict');
    const prompt = getMemoryAsPrompt(memoryPath, projectHash);
    expect(prompt).toContain('strict');
    expect(prompt).toContain('Conventions');
    expect(prompt).not.toContain('Facts');
  });

});
