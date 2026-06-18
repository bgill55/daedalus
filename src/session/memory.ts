// Project memory for Daedalus — facts, conventions, and persistent context

import fs from 'fs';
import path from 'path';

export interface Fact {
  key: string;
  value: string;
  source: 'user' | 'agent';
  created: number;
}

export interface ProjectMemory {
  projectHash: string;
  facts: Fact[];
  conventions: Record<string, string>;
  updated_at: number;
}

/** Load project memory from JSON file */
export function loadMemory(memoryPath: string, projectHash: string): ProjectMemory {
  const dir = path.dirname(memoryPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(memoryPath)) {
    return {
      projectHash,
      facts: [],
      conventions: {},
      updated_at: Date.now(),
    };
  }

  try {
    const data = JSON.parse(fs.readFileSync(memoryPath, 'utf8')) as ProjectMemory;
    return data;
  } catch {
    return {
      projectHash,
      facts: [],
      conventions: {},
      updated_at: Date.now(),
    };
  }
}

/** Save project memory to JSON file */
export function saveMemory(memoryPath: string, memory: ProjectMemory): void {
  const dir = path.dirname(memoryPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(memoryPath, JSON.stringify(memory, null, 2), 'utf8');
}

/** Add a fact to the project memory */
export function addFact(memoryPath: string, projectHash: string, key: string, value: string, source: 'user' | 'agent' = 'agent'): void {
  const mem = loadMemory(memoryPath, projectHash);
  const existingIndex = mem.facts.findIndex(f => f.key === key);

  const newFact: Fact = {
    key,
    value,
    source,
    created: Date.now(),
  };

  if (existingIndex >= 0) {
    mem.facts[existingIndex] = newFact;
  } else {
    mem.facts.push(newFact);
  }

  mem.updated_at = Date.now();
  saveMemory(memoryPath, mem);
}

/** Set a project coding convention */
export function setConvention(memoryPath: string, projectHash: string, key: string, value: string): void {
  const mem = loadMemory(memoryPath, projectHash);
  mem.conventions[key] = value;
  mem.updated_at = Date.now();
  saveMemory(memoryPath, mem);
}

/** Generate a system prompt fragment describing project facts and conventions */
export function getMemoryAsPrompt(memoryPath: string, projectHash: string): string {
  const mem = loadMemory(memoryPath, projectHash);
  if (mem.facts.length === 0 && Object.keys(mem.conventions).length === 0) {
    return '';
  }

  let prompt = '\n--- PROJECT CONTEXT & CONVENTIONS ---\n';

  if (Object.keys(mem.conventions).length > 0) {
    prompt += 'Project Coding Conventions:\n';
    for (const [key, val] of Object.entries(mem.conventions)) {
      prompt += `- ${key}: ${val}\n`;
    }
    prompt += '\n';
  }

  if (mem.facts.length > 0) {
    prompt += 'Project Facts:\n';
    for (const f of mem.facts) {
      prompt += `- ${f.key}: ${f.value} (source: ${f.source})\n`;
    }
  }

  prompt += '-------------------------------------\n';
  return prompt;
}
