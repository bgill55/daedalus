import fs from 'fs';
const src = fs.readFileSync('src/commands.ts', 'utf-8');
const lines = src.split('\n');
let depth = 0;
let blockStart = -1;
let currentName = '';
let inArray = false;
const blocks = [];

for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i].trim();
  if (trimmed === 'export const commandsList: Command[] = [') { inArray = true; continue; }
  if (!inArray) continue;
  if (trimmed === '];') { inArray = false; continue; }

  let inString = false, inTemplate = false, stringChar = '';
  for (let ci = 0; ci < trimmed.length; ci++) {
    const ch = trimmed[ci];
    if (inTemplate) { if (ch === '`') inTemplate = false; continue; }
    if (inString) { if (ch === stringChar) inString = false; continue; }
    if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
    if (ch === '`') { inTemplate = true; continue; }
    if (ch === '{') depth++;
    if (ch === '}') depth--;
  }

  if (trimmed.startsWith('{') && depth === 1 && blockStart === -1) blockStart = i;
  const m = trimmed.match(/name:\s*'([^']+)'/);
  if (m) currentName = m[1];
  if (depth === 0 && blockStart >= 0) {
    blocks.push({ name: currentName, startLine: blockStart, endLine: i, lineCount: i - blockStart + 1 });
    blockStart = -1;
    currentName = '';
  }
}

console.log('Total blocks:', blocks.length);
for (const b of blocks) {
  console.log(`${b.name}: lines ${b.startLine}-${b.endLine} (${b.lineCount} lines)`);
}
