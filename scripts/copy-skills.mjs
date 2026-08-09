// Copies SKILL.md files from src/skills into dist/skills so the shipped-skills
// feature works in published npm installs. tsc only emits .ts compiles, so the
// markdown playbooks must be copied explicitly. Cross-platform (Node only, no deps).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(root, '..', 'src', 'skills');
const outDir = path.join(root, '..', 'dist', 'skills');

function copySkillDir(entries) {
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(srcDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const destDir = path.join(outDir, entry.name);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(skillFile, path.join(destDir, 'SKILL.md'));
  }
}

if (!fs.existsSync(srcDir)) {
  console.log('copy-skills: no src/skills dir, skipping');
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
copySkillDir(fs.readdirSync(srcDir, { withFileTypes: true }));
console.log('copy-skills: shipped skill playbooks copied to dist/skills');
