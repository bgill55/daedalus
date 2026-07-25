import dotenv from 'dotenv';

dotenv.config();

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

function extractChangelog(body) {
  if (!body) return [];
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') || line.startsWith('* '))
    .map((line) => line.replace(/^[-*]\s+/, ''));
}

function createEmbed({ tag, title, body, url }) {
  const changelogItems = extractChangelog(body);
  const npmPackage = process.env.npm_package_name || 'your-package';
  const repo = process.env.GITHUB_REPOSITORY || 'owner/repo';

  const descriptionLines = [];
  descriptionLines.push(`**Version:** ${tag}`);
  if (changelogItems.length) {
    descriptionLines.push('');
    descriptionLines.push(...changelogItems.map((item) => `• ${item}`));
  }

  return {
    title,
    description: descriptionLines.join('\n'),
    url,
    color: 0x00ffff, // cyan
    timestamp: new Date().toISOString(),
    footer: { text: `Released from ${repo}` },
    fields: [
      {
        name: 'NPM',
        value: `[${npmPackage} on npm](https://www.npmjs.com/package/${npmPackage})`,
        inline: true,
      },
      {
        name: 'GitHub',
        value: `[Repository](${url})`,
        inline: true,
      },
    ],
  };
}

async function main() {
  const { tag, title, body, url } = parseArgs();
  if (!tag || !title || !body || !url) {
    console.error('❌ Missing required arguments. Expected --tag, --title, --body, --url');
    process.exit(1);
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('❌ DISCORD_WEBHOOK_URL not defined in environment.');
    process.exit(1);
  }

  const embed = createEmbed({ tag, title, body, url });
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
