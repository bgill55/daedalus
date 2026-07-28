import fs from 'fs';
import { execSync } from 'child_process';

const content = execSync('git show HEAD:src/commands.ts', { encoding: 'utf-8' });
const lines = content.split('\n');

function findBlock(lines, startIdx) {
  const result = [lines[startIdx]];
  let depth = 1;
  let inString = false;
  let inTemplate = false;
  let stringChar = '';

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    result.push(line);
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
      if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
      if (ch === '`') { inTemplate = true; continue; }
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }
    if (depth === 0) return result;
  }
  return result;
}

const commands = { '/onboard': 2337, '/tui': 2452, '/image': 2465, '/preview': 2643, '/exit': 2726 };
let agentsContent = fs.readFileSync('src/commands/agents.ts', 'utf-8');
agentsContent = agentsContent.replace(/\n\]\s*$/, ',');

for (const [name, start] of Object.entries(commands)) {
  const block = findBlock(lines, start);
  agentsContent += '\n' + block.join('\n') + ',';
  console.log('Recovered:', name, '(' + block.length + ' lines)');
}

agentsContent += '\n]';
fs.writeFileSync('src/commands/agents.ts', agentsContent, 'utf-8');
console.log('Done');
