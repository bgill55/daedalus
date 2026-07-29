import fs from 'fs';
import path from 'path';
import pc from 'picocolors';

export interface BadgeOptions {
  label?: string;
  message?: string;
  color?: string;
  logo?: string;
  link?: string;
  write?: boolean;
}

export function generateStandardBadges(projectRoot: string): string[] {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return [];
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const name = pkg.name || 'daedalus';
    const version = pkg.version || '1.0.0';
    const license = pkg.license || 'MIT';
    const nodeEng = pkg.engines?.node || '>=20';

    const badges: string[] = [
      `[![npm version](https://img.shields.io/badge/npm-v${version}-blue)](https://www.npmjs.com/package/${name})`,
      `[![license](https://img.shields.io/badge/license-${encodeURIComponent(license)}-green)](https://github.com/bgill55/${name})`,
      `[![node engine](https://img.shields.io/badge/node-${encodeURIComponent(nodeEng)}-brightgreen)](https://nodejs.org)`,
    ];

    return badges;
  } catch {
    return [];
  }
}

export function generateCustomBadge(opts: BadgeOptions): string {
  const label = opts.label || 'badge';
  const message = opts.message || 'active';
  const color = opts.color || 'blue';
  const logoParam = opts.logo ? `?logo=${encodeURIComponent(opts.logo)}` : '';
  const url = `https://img.shields.io/badge/${encodeURIComponent(label)}-${encodeURIComponent(message)}-${encodeURIComponent(color)}${logoParam}`;
  const targetLink = opts.link || '#';

  return `[![${label}]( ${url} )](${targetLink})`.replace('( ', '(').replace(' )', ')');
}

export async function handleBadgeCommand(args: string, projectRoot: string = process.cwd()): Promise<void> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const isCustom = parts.includes('custom') || parts.includes('--custom');
  const shouldWrite = parts.includes('--write') || parts.includes('-w');

  let outputBadges: string[] = [];

  if (isCustom) {
    // Parse custom arguments: /badge custom <label> <message> [color] [logo] [link]
    const customArgs = parts.filter(p => p !== 'custom' && p !== '--custom' && p !== '--write' && p !== '-w');
    const label = customArgs[0] || 'daedalus';
    const message = customArgs[1] || 'awesome';
    const color = customArgs[2] || 'blue';
    const logo = customArgs[3];
    const link = customArgs[4];

    const badge = generateCustomBadge({ label, message, color, logo, link });
    outputBadges.push(badge);
  } else {
    outputBadges = generateStandardBadges(projectRoot);
    if (outputBadges.length === 0) {
      outputBadges.push(generateCustomBadge({ label: 'daedalus', message: 'cli', color: 'violet' }));
    }
  }

  const markdownSnippet = outputBadges.join(' ');

  console.log(pc.bold('\n--- Daedalus Shields.io Badge Generator ---'));
  console.log(pc.cyan('\nMarkdown Snippet:'));
  console.log(pc.green(markdownSnippet));
  console.log(pc.dim('\nHTML / Rendered Preview:'));
  for (const b of outputBadges) {
    console.log(`  • ${b}`);
  }

  if (shouldWrite) {
    const readmePath = path.join(projectRoot, 'README.md');
    if (fs.existsSync(readmePath)) {
      let content = fs.readFileSync(readmePath, 'utf8');
      content = `${markdownSnippet}\n\n${content}`;
      fs.writeFileSync(readmePath, content, 'utf8');
      console.log(pc.green('\n[OK] Automatically prepended badges to README.md'));
    }
  }
}
