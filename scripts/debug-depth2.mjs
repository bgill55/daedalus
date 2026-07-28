import fs from 'fs';
const src = fs.readFileSync('src/commands.ts', 'utf-8');
const lines = src.split('\n');
let depth = 0;
let inArray = false;

for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i].trim();
  if (trimmed === 'export const commandsList: Command[] = [') { inArray = true; continue; }
  if (!inArray) continue;
  if (trimmed === '];') { inArray = false; continue; }

  let prevDepth = depth;
  let inString = false, inTemplate = false, stringChar = '';
  let braceCount = 0;
  for (let ci = 0; ci < trimmed.length; ci++) {
    const ch = trimmed[ci];
    if (inTemplate) { if (ch === '`') inTemplate = false; continue; }
    if (inString) { if (ch === stringChar) inString = false; continue; }
    if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
    if (ch === '`') { inTemplate = true; continue; }
    if (ch === '{') { depth++; braceCount++; }
    if (ch === '}') { depth--; braceCount--; }
  }

  const depthChange = depth - prevDepth;
  // Show everything between L2440 and L2465
  if (i >= 2440 && i <= 2464) {
    const inStr = inString ? ` STR(${stringChar})` : '';
    const inTmpl = inTemplate ? ' TMPL' : '';
    const status = depthChange !== 0 ? `***` : '';
    console.log(`L${i}: depth ${prevDepth}→${depth} (Δ${depthChange>=0?'+':''}${depthChange})${inStr}${inTmpl} ${status} | ${trimmed.slice(0, 120)}`);
  }
}
