import fs from 'fs';
import { execSync } from 'child_process';

const content = execSync('git show HEAD:src/commands.ts', { encoding: 'utf-8' });
const lines = content.split('\n');

// Extract command blocks by tracking depth, but skip braces inside strings/templates
interface Block { name: string; lines: string[] }

const blocks: Block[] = [];
let depth = 0;
let blockLines: string[] = [];
let currentName = '';
let inBlock = false;
let inArray = false;

for (const line of lines) {
  const trimmed = line.trim();

  if (trimmed === "export const commandsList: Command[] = [") {
    inArray = true;
    continue;
  }
  if (trimmed === '];') {
    if (inBlock) {
      blockLines.push(line);
      blocks.push({ name: currentName, lines: blockLines });
    }
    inArray = false;
    break;
  }
  if (!inArray) continue;

  // Detect start of a command object
  if (/^\s*\{\s*$/.test(line) && depth === 0) {
    inBlock = true;
    blockLines = [line];
    depth = 1;
    currentName = '';
    continue;
  }

  if (inBlock) {
    blockLines.push(line);

    // Count non-string braces only
    let inString = false;
    let inTemplate = false;
    let stringChar = '';
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];
      const prev = ci > 0 ? line[ci - 1] : '';

      if (inTemplate) {
        if (ch === '`' && prev !== '\\') inTemplate = false;
        continue;
      }
      if (inString) {
        if (ch === stringChar && prev !== '\\') inString = false;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
        continue;
      }
      if (ch === '`') {
        inTemplate = true;
        continue;
      }
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }

    if (depth === 0) {
      blocks.push({ name: currentName, lines: blockLines });
      inBlock = false;
      blockLines = [];
    }
  }

  if (inBlock && !currentName) {
    const m = line.match(/name:\s*'([^']+)'/);
    if (m) currentName = m[1];
  }
}

const wantedNames = ['/onboard', '/tui', '/image', '/preview', '/exit'];
const missingBlocks = blocks.filter(b => wantedNames.includes(b.name));
console.log(`Found ${missingBlocks.length} missing commands:`, missingBlocks.map(b => b.name));

if (missingBlocks.length === 0) {
  console.log('All blocks found:', blocks.map(b => b.name).join(', '));
  process.exit(1);
}

const agentsPath = 'src/commands/agents.ts';
let agentsContent = fs.readFileSync(agentsPath, 'utf-8');
agentsContent = agentsContent.replace(/\n\]\s*$/, ',');

for (const block of missingBlocks) {
  agentsContent += '\n' + block.lines.join('\n') + ',';
}

agentsContent += '\n]';
fs.writeFileSync(agentsPath, agentsContent, 'utf-8');
console.log('Appended missing commands to agents.ts');
