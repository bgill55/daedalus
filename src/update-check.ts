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

export function checkChangelogOnUpgrade(currentVersion: string, configDir: string, changelogPath: string): void {
  const versionFilePath = path.join(configDir, 'version.json');
  let lastRunVersion: string | null = null;

  if (fs.existsSync(versionFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(versionFilePath, 'utf8'));
      lastRunVersion = data.lastRunVersion || null;
    } catch {
      // Ignore JSON parse errors
    }
  }

  if (lastRunVersion && lastRunVersion !== currentVersion) {
    console.log(pc.cyan(`\n  Welcome to Daedalus version v${pc.bold(currentVersion)} (upgraded from v${lastRunVersion})!`));
    
    if (fs.existsSync(changelogPath)) {
      try {
        const content = fs.readFileSync(changelogPath, 'utf8');
        const lines = content.split('\n');
        const displayLines: string[] = [];
        let headerCount = 0;

        for (const line of lines) {
          const isHeader = line.startsWith('# ') || line.startsWith('## ');
          if (isHeader) {
            headerCount++;
            if (headerCount > 1) {
              break;
            }
          }
          if (headerCount === 1) {
            displayLines.push(line);
          }
        }

        if (displayLines.length > 0) {
          console.log(pc.bold('\n--- What\'s New in this Version ---'));
          console.log(displayLines.join('\n').trim());
          console.log(pc.bold('----------------------------------\n'));
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(versionFilePath, JSON.stringify({ lastRunVersion: currentVersion }), 'utf8');
  } catch {
    // Ignore write errors
  }
}

