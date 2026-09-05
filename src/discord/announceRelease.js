import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

// Load only Daedalus's own env (~/.daedalus/.env); never the cwd .env.
dotenv.config({ path: path.join(os.homedir(), '.daedalus', '.env'), quiet: true });

/**
 * Simple CLI argument parser for `--key value` pairs.
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        result[key] = value;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

function extractChangelog(body, tag) {
  let lines = [];

  if (body) {
    lines = body.split('\n');
  }

  // Auto-extract from CHANGELOG.md if body is missing or empty
  if (lines.length === 0 || !lines.some(l => l.trim().startsWith('- ') || l.trim().startsWith('* '))) {
    try {
      const changelogPath = path.resolve(process.cwd(), 'CHANGELOG.md');
      if (fs.existsSync(changelogPath)) {
        const content = fs.readFileSync(changelogPath, 'utf8');
        const cleanTag = (tag || '').replace(/^v/, '');
        const escapedTag = cleanTag.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        const regex = new RegExp(`#+ \\[?${escapedTag}[\\s\\S]*?(?=(?:\\n#+ [ \\[0-9]|$))`, 'i');
        const match = content.match(regex);
        if (match) {
          lines = match[0].split('\n');
        }
      }
    } catch {
      // Ignore fallback errors
    }
  }

  return lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') || line.startsWith('* '))
    .map((line) => line.replace(/^[-*]\s+/, ''));
}

function createEmbed({ tag, title, body, url }) {
  const changelogItems = extractChangelog(body, tag);
  let npmPackage = process.env.npm_package_name || 'daedalus-cli';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    if (pkg.name) npmPackage = pkg.name;
  } catch {
    // Fallback
  }
  const repo = process.env.GITHUB_REPOSITORY || 'bgill55/daedalus';

  const descriptionLines = [];
  descriptionLines.push(`🚀 **Daedalus Release ${tag}**\n`);
  if (changelogItems.length) {
    descriptionLines.push(...changelogItems.map((item) => `• ${item}`));
  } else {
    descriptionLines.push('• General performance improvements and bug fixes.');
  }

  return {
    title,
    description: descriptionLines.join('\n'),
    url,
    color: 0xf5c358,
    timestamp: new Date().toISOString(),
    footer: { text: `Daedalus Release Engine • ${repo}` },
    fields: [
      {
        name: '📦 NPM Package',
        value: `\`npm i -g ${npmPackage}@latest\``,
        inline: true,
      },
      {
        name: '⭐ GitHub Repo',
        value: `[${repo}](${url})`,
        inline: true,
      },
    ],
  };
}

async function main() {
  const { tag, title, body, url } = parseArgs();
  if (typeof tag !== 'string' || typeof title !== 'string' || typeof url !== 'string') {
    console.error('❌ Missing or invalid required arguments. Expected string values for --tag, --title, --url');
    process.exit(1);
  }

  const safeBody = typeof body === 'string' ? body : '';

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('❌ DISCORD_WEBHOOK_URL not defined in environment.');
    process.exit(1);
  }

  const embed = createEmbed({ tag, title, body: safeBody, url });
  const payload = { embeds: [embed] };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Discord responded ${response.status}: ${text}`);
    }
    console.log('✅ Release announcement posted to Discord.');
  } catch (err) {
    console.error('❌ Failed to post to Discord:', err);
    process.exit(1);
  }
}

main();
