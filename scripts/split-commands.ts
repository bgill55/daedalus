import fs from 'fs';

const src = fs.readFileSync('src/commands.ts', 'utf-8');
const lines = src.split('\n');

// Find command object boundaries by tracking brace depth
interface CommandBlock { name: string; startLine: number; endLine: number }

const blocks: CommandBlock[] = [];
let depth = 0;
let blockStart = -1;
let currentName = '';
let inArray = false;

for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i].trim();

  if (trimmed === "export const commandsList: Command[] = [") {
    inArray = true;
    continue;
  }

  if (!inArray) continue;

  if (trimmed === '];' && depth === 0) {
    inArray = false;
    continue;
  }

  // Count braces while skipping those inside strings/template literals
  let inString = false;
  let inTemplate = false;
  let stringChar = '';
  for (let ci = 0; ci < trimmed.length; ci++) {
    const ch = trimmed[ci];
    if (inTemplate) {
      if (ch === '`') inTemplate = false;
      continue;
    }
    if (inString) {
      if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
    if (ch === '`') { inTemplate = true; continue; }
    if (ch === '{') depth++;
    if (ch === '}') depth--;
  }

  if (trimmed.startsWith('{') && depth === 1 && blockStart === -1) {
    blockStart = i;
  }

  if (trimmed.match(/name:\s*'([^']+)'/)) {
    currentName = trimmed.match(/name:\s*'([^']+)'/)![1];
  }

  if (depth === 0 && blockStart >= 0) {
    blocks.push({ name: currentName, startLine: blockStart, endLine: i });
    blockStart = -1;
    currentName = '';
  }
}

// Define groups
const groups: Record<string, string[]> = {
  context: ['/add', '/remove', '/context', '/paste', '/clear', '/system', '/memory', '/fact', '/convention', '/extract', '/summarize', '/profile', '/style', '/lite', '/session', '/undo', '/history', '/exit'],
  agents: ['/spawn', 'delegate_task', '/tasks', '/task', '/orchestrate', '/ensemble', '/spec', '/autopilot', '/mcp', '/onboard', '/tui', '/image', '/preview', '/help'],
  dev: ['/test', '/commit', '/branch', '/pr', '/debug', '/watch', '/index', '/find', '/refs', '/def', '/changelog', '/models', '/config', '/doctor', '/stats', '/health', '/project'],
};

// Headers for each group file
const headers: Record<string, string> = {
  context: `// Context, memory, profile, session & history commands
import fs from 'fs';
import path from 'path';
import pc from 'picocolors';

import { getTurns } from '../session/sqlite.js';
import { getSessionTodos } from '../tools/builtin/todo.js';
import { saveProfile } from '../profile.js';
import { extractAndSave } from '../extraction.js';
import { printUserTurn, turnSeparator } from '../formatting.js';
import { getClipboardText, getClipboardImage } from '../clipboard.js';
import { createSessionBranch, checkoutSessionBranch, listSessionBranches, mergeSessionBranch } from '../session/branching.js';

import type { Command } from './types.js';

export const contextCommands: Command[] = [`,
  agents: `// Agent orchestration, MCP, setup & utility commands
import fs from 'fs';
import path from 'path';
import pc from 'picocolors';

import { executeToolCalls } from '../tools/executor.js';
import { spawnBackgroundAgent } from '../agents/background.js';
import { handleSpecCommand, getGitRepoInfo } from '../agents/loop.js';
import { printUserTurn, turnSeparator } from '../formatting.js';
import { getSessionTodos } from '../tools/builtin/todo.js';

import type { ToolCall } from '../types.js';
import type { Command } from './types.js';

export const agentCommands: Command[] = [`,
  dev: `// Dev tools, codebase, diagnostics & config commands
import fs from 'fs';
import path from 'path';
import pc from 'picocolors';

import { executeToolCalls } from '../tools/executor.js';
import { discoverLocalServers, saveConfig } from '../config/index.js';
import { getSessionTodos } from '../tools/builtin/todo.js';
import { handleSpecCommand } from '../agents/loop.js';

import type { DaedalusConfig } from '../config/index.js';
import type { Command } from './types.js';

export const devCommands: Command[] = [`,
};

const footers: Record<string, string> = {
  context: `]`,
  agents: `]`,
  dev: `]`,
};

// Write each group file
for (const [group, names] of Object.entries(groups)) {
  const header = headers[group];
  const footer = footers[group];
  const bodyLines: string[] = [];

  for (const block of blocks) {
    if (names.includes(block.name)) {
      for (let l = block.startLine; l <= block.endLine; l++) {
        bodyLines.push(lines[l]);
      }
    }
  }

  const content = header + '\n' + bodyLines.join('\n') + '\n' + footer + '\n';
  fs.writeFileSync(`src/commands/${group}.ts`, content, 'utf-8');
  console.log(`Wrote src/commands/${group}.ts (${content.length} chars, ${bodyLines.length} command lines)`);
}

// Verify all commands are accounted for
const assigned = new Set(Object.values(groups).flat());
const unassigned = blocks.filter(b => !assigned.has(b.name));
if (unassigned.length > 0) {
  console.log('\nWARNING: Unassigned commands:', unassigned.map(b => b.name));
} else {
  console.log('\nAll commands assigned to groups ✓');
}
