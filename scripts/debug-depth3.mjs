import fs from 'fs';
const src = fs.readFileSync('src/commands.ts', 'utf-8');
const lines = src.split('\n');
let depth = 0;
let inArray = false;

for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i].trim();
  
  if (trimmed === 'export const commandsList: Command[] = [') { inArray = true; console.log(`L${i}: inArray=true`); continue; }
  if (!inArray) continue;
  if (trimmed === '];') { console.log(`L${i}: inArray=false, depth=${depth}`); inArray = false; continue; }

  let prevDepth = depth;
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

  // Show lines 2440-2465 or any with depth anomalies
  if ((i >= 2440 && i <= 2470) || (prevDepth !== depth && i > 2335)) {
    const inStr = inString ? ` STR:'${stringChar}'` : '';
    const inTmpl = inTemplate ? ' TMPL' : '';
    const status = depth !== prevDepth ? '***' : '';
    if (depth !== prevDepth || i >= 2440) {
      console.log(`L${i}: depth ${prevDepth}→${depth} (Δ${depth-prevDepth>=0?'+':''}${depth-prevDepth})${inStr}${inTmpl} ${status} | ${trimmed.slice(0, 120)}`);
    }
  }
}
