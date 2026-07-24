import { Client, GatewayIntentBits, Events, EmbedBuilder } from 'discord.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const token = process.env.DISCORD_BOT_TOKEN;
const CHANGELOG_CHANNEL_ID = '1530119579056210043';

if (!token) {
  console.error('Missing DISCORD_BOT_TOKEN in .env file');
  process.exit(1);
}

// Accept custom version & notes from CLI arguments
const versionArg = process.argv[2];
const notesArg = process.argv[3];

let version = versionArg;
let notes = notesArg ? notesArg.replace(/\\n/g, '\n') : '';

if (!version || !notes) {
  try {
    const pkgPath = path.resolve('package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    version = version || `v${pkg.version}`;
  } catch {
    version = version || 'v1.58.0';
  }

  if (!notes) {
    notes = `- Integrated Daedalus AI Discord Bot & Slash Commands (/ask, /roast, /excuse)\n` +
            `- Added GitHub star prompts to startup banner & README\n` +
            `- Performance and router stability enhancements`;
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Connected to Discord as ${c.user.tag}`);

  try {
    const channel = await c.channels.fetch(CHANGELOG_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      console.error(`Channel ${CHANGELOG_CHANNEL_ID} not found or not text-based.`);
      process.exit(1);
    }

    const embed = new EmbedBuilder()
      .setTitle(`🚀 Daedalus Release ${version}`)
      .setURL('https://github.com/bgill55/daedalus')
      .setColor('#0EA5E9')
      .setDescription(notes)
      .addFields(
        { name: '📦 NPM Package', value: '`npm i -g daedalus-cli@latest`', inline: true },
        { name: '⭐ GitHub Repo', value: '[bgill55/daedalus](https://github.com/bgill55/daedalus)', inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Daedalus Release Engine' });

    if ('send' in channel) {
      await channel.send({ embeds: [embed] });
      console.log(`✅ Successfully posted changelog for ${version} to Discord channel #${CHANGELOG_CHANNEL_ID}!`);
    }
  } catch (err: any) {
    console.error('Failed to post changelog:', err.message);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(token).catch((err) => {
  console.error('Login failed:', err.message);
  process.exit(1);
});
