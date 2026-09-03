// Copies static assets (skills playbooks, webui html/css/js) into dist/
// so they are bundled in npm packages and standalone distributions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const srcSkills = path.join(root, '..', 'src', 'skills');
const distSkills = path.join(root, '..', 'dist', 'skills');

const srcWebuiPublic = path.join(root, '..', 'src', 'webui', 'public');
const distWebuiPublic = path.join(root, '..', 'dist', 'webui', 'public');

function copySkillDir(entries) {
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(srcSkills, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const destDir = path.join(distSkills, entry.name);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(skillFile, path.join(destDir, 'SKILL.md'));
  }
}

if (fs.existsSync(srcSkills)) {
  fs.mkdirSync(distSkills, { recursive: true });
  copySkillDir(fs.readdirSync(srcSkills, { withFileTypes: true }));
  console.log('copy-assets: shipped skill playbooks copied to dist/skills');
}

if (fs.existsSync(srcWebuiPublic)) {
  fs.mkdirSync(distWebuiPublic, { recursive: true });
  for (const file of fs.readdirSync(srcWebuiPublic)) {
    const src = path.join(srcWebuiPublic, file);
    const dest = path.join(distWebuiPublic, file);
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, dest);
    }
  }
  console.log('copy-assets: webui public static assets copied to dist/webui/public');
}
