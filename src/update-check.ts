import fs from 'fs';
import path from 'path';
import pc from 'picocolors';

function parseVersion(v: string): number[] {
  return v.replace(/^v/, '').split('.').map(Number);
}

function isNewerVersion(latest: string, current: string): boolean {
  const l = parseVersion(latest);
  const c = parseVersion(current);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const lv = l[i] || 0;
    const cv = c[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

export async function checkForUpdates(version: string, cachePath: string): Promise<void> {
  try {
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (Date.now() - cached.timestamp < 86_400_000) {
        if (cached.latest && isNewerVersion(cached.latest, version)) {
          console.log(pc.cyan(`\n  Upgrade available: ${pc.bold(cached.latest)} (you have ${version})`));
          console.log(pc.dim(`  Run ${pc.cyan('npm update -g daedalus-cli')} to upgrade`));
        }
        return;
      }
    }

    const res = await fetch('https://registry.npmjs.org/daedalus-cli/latest');
    if (!res.ok) return;
    const data: any = await res.json();
    const latest = data.version;

    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ latest, timestamp: Date.now() }), 'utf8');

    if (isNewerVersion(latest, version)) {
      console.log(pc.cyan(`\n  Upgrade available: ${pc.bold(latest)} (you have ${version})`));
      console.log(pc.dim(`  Run ${pc.cyan('npm update -g daedalus-cli')} to upgrade`));
    }
  } catch {
    // Network failure, stale cache, etc. — silently ignore
  }
}
