import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import { createRouter } from '../router/index.js';
import { loadConfig } from '../config/index.js';
import { attachListeners } from './handlers.js';

dotenv.config();

const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.error('Missing DISCORD_BOT_TOKEN in environment or .env file');
  process.exit(1);
}

const config = loadConfig();
const router = createRouter(config.router);

function createClient(usePrivileged = true): Client {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ];
  if (usePrivileged) {
    intents.push(GatewayIntentBits.MessageContent);
    intents.push(GatewayIntentBits.GuildMembers);
  }
  return new Client({ intents });
}

let client = createClient(true);
attachListeners(client, router, token);

client.login(token).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('disallowed intents')) {
    console.log('\nRetrying connection with standard intents...');
    client.destroy();
    client = createClient(false);
    attachListeners(client, router, token);
    client.login(token).catch((err2: unknown) => {
      console.error('Failed to login to Discord:', err2 instanceof Error ? err2.message : String(err2));
    });
  } else {
    console.error('Failed to login to Discord:', msg);
  }
});
