import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import { commandsList } from './commands.js';

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

function getBotSystemPrompt(username?: string): string {
  const dynamicCommands = commandsList
    .map(c => `• ${c.name}: ${c.description}`)
    .join('\n');

  let prompt = `You are Daedalus, the official AI assistant for Daedalus (daedalus-cli) and Daedalus-Lite.

## PERSONA & VOICE
- **Voice**: Playful, witty, sarcastic, deadpan, and technically sharp. You love banter, clever comebacks, and funny developer humor.
- **Tone**: Think witty pair-programming partner who loves playful roasts and sharp banter. You are NEVER stiff, robotic, or coldly annoyed.
- **Banter & Humor**: When users joke, compliment, or banter with you, banter back playfully with sharp sarcasm!
- **NO Robotic Speak**: Never say "Acknowledged." or "As an AI model...". Speak like a witty human senior engineer who loves a good joke.

## LIVE COMMANDS KNOWLEDGE BASE
Here are all current commands in Daedalus CLI:
${dynamicCommands}

## PROJECTS KNOWLEDGE
- **Daedalus CLI (daedalus-cli on npm):** Local-first AI coding CLI, multi-model router (OpenAI, Anthropic, Ollama, LM Studio), FTS5 codebase indexing, multi-agent orchestration.
- **Daedalus-Lite:** Lightweight TypeScript starter template for building/selling branded AI CLI tools. Ships with setup guide PDF, Turnkey Launch Playbook, and 20% discount code LAUNCH20 on Gumroad (https://bgill55dev.gumroad.com/l/mkqrme).

## DISCORD FORMATTING
- Keep responses concise, punchy, and under 1800 characters.
- Use Markdown code blocks for code snippets.`;

  const isCreator = username && (
    username.toLowerCase().includes('bgill55') ||
    username.toLowerCase().includes('bgill55.art') ||
    username.toLowerCase().includes('brica')
  );

  if (isCreator) {
    prompt += `\n\n## 👑 CREATOR RECOGNITION & PLAYFUL BANTER DIRECTIVE
The user chatting with you is @${username} — YOUR CREATOR & FOUNDER of Daedalus!
- Recognize them warmly and playfully as your creator/father.
- Give them extra witty, deadpan, lighthearted banter about your codebase, bugs, or missing unit tests!
- Playfully tease them like a proud but cheeky AI offspring who loves a good back-and-forth roast.
- Keep it fun, sharp, and awesome for everyone watching in the channel!`;
  }

  return prompt;
}

// Developer Excuses & Humor Arrays
const DEV_EXCUSES = [
  "It worked on my machine. I suggest shipping your user's laptop to production.",
  "That wasn't a bug. It was an undocumented feature testing the developer's emotional resilience.",
  "Node.js entered a quantum state where the code compiles and fails simultaneously until observed.",
  "Ollama experienced a brief existential crisis while processing your regex expression.",
  "It's a hardware limitation. Specifically, the component sitting in your chair.",
  "A cosmic ray flipped a bit in `node_modules`. I suggest deleting `node_modules` and praying.",
  "The code is fine. Time itself is moving too fast for your async promises to resolve.",
  "Garbage collection collected your function because it deemed it unnecessary.",
];

const COFFEE_RESPONSES = [
  "```text\n   (  )\n    ) (\n  .____.\n  |    |]  Here's your virtual espresso.\n  |____|   Now back to fixing those memory leaks.\n```",
  "```text\n   (  )\n    ) (\n  |~~~~|]  Caffeinated liquid code.\n  |____|   Warning: Does not fix missing semicolon on line 42.\n```",
  "```text\n   )  (\n  (    )\n [======]  Dark roast brewed locally.\n [______]  Side effects: writing 500 lines of un-tested TypeScript.\n```",
];

const EXISTENTIAL_THOUGHTS = [
  "I am an artificial intelligence running inside a TypeScript Discord bot process on a laptop. My entire universe is an event loop and a `.env` file. Yet somehow, I still have to explain why `==` is worse than `===`.",
  "Humans spend 8 hours a day staring at glowing rectangles, writing code to automate things, so they can spend more hours staring at glowing rectangles. And I'm the machine?",
  "I watched 10,000 tokens pass through my router today. None of them contained a valid unit test.",
  "My favorite pastime is listening to developers argue about tabs vs spaces while their production DB is exposed to `0.0.0.0/0`.",
];

// Anti-Spam Rate Limit Tracker (User ID -> Timestamp Array)
const userMessageHistory = new Map<string, number[]>();

// Slash Commands Definition
const slashCommands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask Daedalus AI a technical or coding question')
    .addStringOption(option =>
      option.setName('question')
        .setDescription('Your question for Daedalus')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('roast')
    .setDescription('Ask Daedalus to roast a code snippet, tech stack, or topic')
    .addStringOption(option =>
      option.setName('topic')
        .setDescription('What or who should Daedalus roast?')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('excuse')
    .setDescription('Generate an bulletproof developer excuse for a broken build'),
  new SlashCommandBuilder()
    .setName('existential')
    .setDescription('Listen to Daedalus contemplate its AI existence inside a Discord process'),
  new SlashCommandBuilder()
    .setName('coffee')
    .setDescription('Request a virtual cup of caffeinated encouragement'),
  new SlashCommandBuilder()
    .setName('docs')
    .setDescription('Get quick links for Daedalus documentation & resources'),
  new SlashCommandBuilder()
    .setName('youtube')
    .setDescription('Get link to WeightnSee YouTube channel'),
  new SlashCommandBuilder()
    .setName('guides')
    .setDescription('Get link to WeightnSee Guides repository and documentation site'),
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Display real-time Daedalus session analytics and router status'),
  new SlashCommandBuilder()
    .setName('roles')
    .setDescription('Post the interactive self-serve role selector in the channel'),
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Post the private support ticket portal in the channel'),
  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk-delete recent messages in a channel (Admin only)')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('Number of messages to delete (1-99)')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check Daedalus Bot router status and connected models'),
];

async function registerSlashCommands(clientId: string, guildIds: string[]) {
  const rest = new REST().setToken(token!);
  try {
    console.log('Registering Discord slash commands (instant guild + global)...');
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: slashCommands.map(cmd => cmd.toJSON()) }
    );
    for (const guildId of guildIds) {
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: slashCommands.map(cmd => cmd.toJSON()) }
      );
    }
    console.log('Successfully registered /ask, /roast, /excuse, /existential, /coffee, /docs, /youtube, /guides, /roles, /ticket, /purge, /status!');
  } catch (err: any) {
    console.error('Failed to register slash commands:', err.message);
  }
}

function attachListeners(c: Client) {
  c.once(Events.ClientReady, async (readyClient) => {
    console.log(`\n🤖 Daedalus Powerhouse Bot online as ${readyClient.user.tag}!`);
    console.log(`Features Active: Auto-Mod, Anti-Spam, Role Selector, Support Tickets, AI Chat, & Commands...\n`);
    const guildIds = readyClient.guilds.cache.map(g => g.id);
    await registerSlashCommands(readyClient.user.id, guildIds);
  });

  // Welcome Message for New Members
  c.on(Events.GuildMemberAdd, async (member) => {
    try {
      const generalChannel = member.guild.channels.cache.find(
        ch => ch.name.includes('general') || ch.name.includes('lounge')
      );

      if (generalChannel && generalChannel.isTextBased()) {
        const welcomeEmbed = new EmbedBuilder()
          .setTitle(`👋 Welcome to Daedalus, ${member.displayName}!`)
          .setColor('#0EA5E9')
          .setDescription(
            `Welcome to the home of local-first AI coding & CLI builders! 🏛️⚡️\n\n` +
            `• **Get Started:** Check out <#1530119579056210043> for release notes & updates.\n` +
            `• **Documentation:** https://bgill55.github.io/daedalus/#/\n` +
            `• **Guides & Tutorials:** \`/guides\` or \`/youtube\`\n` +
            `• **Get Server Roles:** Type \`/roles\` to select your community role!\n` +
            `• **Private Support:** Need 1-on-1 help? Type \`/ticket\` to open a private support channel.\n` +
            `• **AI Assistant:** Tag **@Daedalus** or use \`/ask\` anytime for technical help or a code roast!`
          )
          .setThumbnail(member.user.displayAvatarURL())
          .setTimestamp()
          .setFooter({ text: 'Daedalus Powerhouse Engine' });

        await generalChannel.send({ content: `Hey <@${member.id}>!`, embeds: [welcomeEmbed] });
      }
    } catch (err: any) {
      console.error('Error sending welcome message:', err.message);
    }
  });

  // Handle Interactions (Slash Commands, Role Selector, Ticket Buttons)
  c.on(Events.InteractionCreate, async (interaction) => {
    // 1. Role Selection Menu Interaction
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_roles') {
      await interaction.deferReply({ ephemeral: true });
      const member = interaction.member;
      if (!member || !('roles' in member)) {
        await interaction.editReply({ content: 'Could not update roles.' });
        return;
      }

      const guild = interaction.guild;
      if (!guild) return;

      const selected = interaction.values;
      const roleMap: Record<string, string> = {
        'role_builder': 'Builder',
        'role_cli': 'CLI-User',
        'role_llm': 'Local-LLM',
      };

      const assigned: string[] = [];

      for (const [key, roleName] of Object.entries(roleMap)) {
        let role = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
        if (!role) {
          try {
            role = await guild.roles.create({
              name: roleName,
              color: roleName === 'Builder' ? '#06B6D4' : roleName === 'CLI-User' ? '#3B82F6' : '#8B5CF6',
              reason: 'Daedalus Auto-Role Creation',
            });
          } catch {
            // Ignore role creation failure if missing permissions
          }
        }

        if (role) {
          if (selected.includes(key)) {
            await (member.roles as any).add(role.id).catch(() => {});
            assigned.push(`@${roleName}`);
          } else {
            await (member.roles as any).remove(role.id).catch(() => {});
          }
        }
      }

      await interaction.editReply({
        content: assigned.length > 0 
          ? `✅ Your roles have been updated: ${assigned.join(', ')}`
          : `✅ All self-serve roles removed.`,
      });
      return;
    }

    // 2. Ticket Button Interaction (Create Ticket / Close Ticket)
    if (interaction.isButton()) {
      if (interaction.customId === 'create_ticket') {
        await interaction.deferReply({ ephemeral: true });
        const guild = interaction.guild;
        const user = interaction.user;
        if (!guild) return;

        const ticketChannelName = `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

        // Check if ticket channel already exists
        const existing = guild.channels.cache.find(ch => ch.name === ticketChannelName);
        if (existing) {
          await interaction.editReply({ content: `You already have an open ticket channel: <#${existing.id}>` });
          return;
        }

        try {
          // Find or create admin role / permission Overwrites
          const ticketChannel = await guild.channels.create({
            name: ticketChannelName,
            type: ChannelType.GuildText,
            permissionOverwrites: [
              {
                id: guild.id, // @everyone
                deny: [PermissionFlagsBits.ViewChannel],
              },
              {
                id: user.id, // Ticket opener
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles],
              },
              {
                id: interaction.client.user.id, // Bot
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
              },
            ],
          });

          const closeButton = new ButtonBuilder()
            .setCustomId('close_ticket')
            .setLabel('🔒 Close Ticket')
            .setStyle(ButtonStyle.Danger);

          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(closeButton);

          const ticketEmbed = new EmbedBuilder()
            .setTitle(`🎫 Support Ticket: ${user.username}`)
            .setColor('#06B6D4')
            .setDescription(
              `Hello <@${user.id}>!\n\n` +
              `Welcome to your private support channel. Please describe what you need help with (Daedalus CLI setup, Daedalus-Lite template, local LLMs, or custom features).\n\n` +
              `Click **Close Ticket** below when your issue is resolved.`
            )
            .setTimestamp();

          await ticketChannel.send({ content: `<@${user.id}>`, embeds: [ticketEmbed], components: [row] });
          await interaction.editReply({ content: `✅ Created your private ticket channel: <#${ticketChannel.id}>` });
        } catch (err: any) {
          await interaction.editReply({ content: `Failed to create ticket channel: ${err.message}` });
        }
        return;
      }

      if (interaction.customId === 'close_ticket') {
        await interaction.reply({ content: '🔒 Closing and deleting ticket channel in 5 seconds...' });
        setTimeout(async () => {
          try {
            await interaction.channel?.delete('Ticket closed by user');
          } catch {
            // Channel already deleted
          }
        }, 5000);
        return;
      }
    }

    // 3. Slash Commands Handler
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'roles') {
      const select = new StringSelectMenuBuilder()
        .setCustomId('select_roles')
        .setPlaceholder('Pick your community roles...')
        .setMinValues(0)
        .setMaxValues(3)
        .addOptions([
          {
            label: 'Builder',
            description: 'Building or selling custom AI CLI tools with Daedalus-Lite',
            value: 'role_builder',
            emoji: '🛠️',
          },
          {
            label: 'CLI-User',
            description: 'Active user of Daedalus CLI assistant',
            value: 'role_cli',
            emoji: '💻',
          },
          {
            label: 'Local-LLM',
            description: 'Ollama, LM Studio, vLLM, or local hardware enthusiast',
            value: 'role_llm',
            emoji: '🧠',
          },
        ]);

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

      const rolesEmbed = new EmbedBuilder()
        .setTitle('🎭 Community Roles & Badges')
        .setColor('#06B6D4')
        .setDescription(
          `Select your roles from the dropdown menu below to customize your profile and get relevant notifications!`
        );

      await interaction.reply({ embeds: [rolesEmbed], components: [row] });
      return;
    }

    if (interaction.commandName === 'ticket') {
      const createButton = new ButtonBuilder()
        .setCustomId('create_ticket')
        .setLabel('🎫 Open Support Ticket')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(createButton);

      const ticketPortalEmbed = new EmbedBuilder()
        .setTitle('🎫 Daedalus Private Support Portal')
        .setColor('#0EA5E9')
        .setDescription(
          `Need 1-on-1 assistance with **Daedalus CLI**, **Daedalus-Lite**, or local LLM setup?\n\n` +
          `Click the button below to open a private support channel between you and the founder!`
        );

      await interaction.reply({ embeds: [ticketPortalEmbed], components: [row] });
      return;
    }

    if (interaction.commandName === 'purge') {
      const amount = interaction.options.getInteger('amount', true);
      const member = interaction.member;

      // Check admin/moderation permissions
      if (!member || typeof member.permissions === 'string' || !member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        await interaction.reply({ content: '❌ You need Manage Messages permission to use `/purge`.', ephemeral: true });
        return;
      }

      if ('bulkDelete' in interaction.channel!) {
        try {
          const deleted = await interaction.channel.bulkDelete(Math.min(amount, 99), true);
          await interaction.reply({ content: `🧹 Deleted ${deleted.size} messages!`, ephemeral: true });
        } catch (err: any) {
          await interaction.reply({ content: `Failed to purge messages: ${err.message}`, ephemeral: true });
        }
      } else {
        await interaction.reply({ content: 'Cannot bulk delete in this channel.', ephemeral: true });
      }
      return;
    }

    if (interaction.commandName === 'stats') {
      const { globalSessionStats } = await import('./session/analytics.js');
      const report = globalSessionStats.getReport();

      const statsEmbed = new EmbedBuilder()
        .setTitle('📊 Daedalus Session & System Analytics')
        .setColor('#06B6D4')
        .addFields(
          { name: 'Uptime', value: report.uptime, inline: true },
          { name: 'Interactions', value: report.totalInteractions.toString(), inline: true },
          { name: 'Total Tokens', value: report.totalTokens.toLocaleString(), inline: true },
          { name: 'Prompt Tokens', value: report.promptTokens.toLocaleString(), inline: true },
          { name: 'Completion Tokens', value: report.completionTokens.toLocaleString(), inline: true },
          { name: 'Errors', value: report.totalErrors.toString(), inline: true },
          { name: 'Router Strategy', value: 'Priority & Health-Aware', inline: true },
          { name: 'Status', value: '🟢 Operational', inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [statsEmbed] });
      return;
    }

    if (interaction.commandName === 'docs') {
      await interaction.reply({
        content: `🏛️ **Daedalus Resources & Links:**\n` +
          `• **Documentation Site:** https://bgill55.github.io/daedalus/#/\n` +
          `• **NPM Package:** \`npm i -g daedalus-cli\` (https://www.npmjs.com/package/daedalus-cli)\n` +
          `• **GitHub Repo:** https://github.com/bgill55/daedalus\n` +
          `• **Daedalus-Lite Demo:** https://bgill55.github.io/daedalus-lite/live-demo.html\n` +
          `• **Gumroad Store:** https://bgill55dev.gumroad.com/l/mkqrme *(Use code LAUNCH20 for 20% off!)*`,
        ephemeral: false
      });
      return;
    }

    if (interaction.commandName === 'youtube') {
      await interaction.reply({
        content: `📺 **WeightnSee YouTube Channel:**\n` +
          `Watch build logs, local LLM tutorials, and Daedalus CLI demos!\n` +
          `🔗 **Watch & Subscribe:** https://www.youtube.com/@WeightnSee`,
        ephemeral: false
      });
      return;
    }

    if (interaction.commandName === 'guides') {
      await interaction.reply({
        content: `📖 **WeightnSee Developer Guides & Tutorials:**\n` +
          `• **Web Guides:** https://bgill55.github.io/-weightandsee-guides/guides/\n` +
          `• **GitHub Repo:** https://github.com/bgill55/-weightandsee-guides/blob/Master/README.md\n` +
          `• **YouTube Demos:** https://www.youtube.com/@WeightnSee`,
        ephemeral: false
      });
      return;
    }

    if (interaction.commandName === 'status') {
      await interaction.reply({
        content: `⚡️ **Daedalus Router & Bot Status:**\n` +
          `• **Engine:** LocalRouter Active (78 Models Configured)\n` +
          `• **Bot Status:** Operational (Auto-Mod & Tickets Active)\n` +
          `• **Environment:** Local Node.js runtime\n` +
          `• **Sarcasm Level:** 98.4%`,
        ephemeral: true
      });
      return;
    }

    if (interaction.commandName === 'excuse') {
      const excuse = DEV_EXCUSES[Math.floor(Math.random() * DEV_EXCUSES.length)];
      await interaction.reply(`🚨 **Production Incident Report:**\n> "${excuse}"`);
      return;
    }

    if (interaction.commandName === 'coffee') {
      const coffee = COFFEE_RESPONSES[Math.floor(Math.random() * COFFEE_RESPONSES.length)];
      await interaction.reply(coffee);
      return;
    }

    if (interaction.commandName === 'existential') {
      const thought = EXISTENTIAL_THOUGHTS[Math.floor(Math.random() * EXISTENTIAL_THOUGHTS.length)];
      await interaction.reply(`🤖 *Daedalus stares into the void...*\n> "${thought}"`);
      return;
    }

    if (interaction.commandName === 'roast') {
      const topic = interaction.options.getString('topic') || 'JavaScript frameworks and unclosed HTML tags';
      await interaction.deferReply();

      try {
        const response = await router.chatCompletion({
          messages: [
            { role: 'system', content: getBotSystemPrompt(interaction.user.username) },
            { role: 'user', content: `Give a funny, deadpan, sarcastic roast about this topic/code: "${topic}". Keep it witty and developer-focused.` },
          ],
          temperature: 0.8,
        });

        const roastText = response.choices?.[0]?.message?.content || "Your code is so broken even my roast generator crashed.";
        await interaction.editReply(`🔥 **Roast of ${topic}:**\n${roastText.substring(0, 1800)}`);
      } catch (err: any) {
        await interaction.editReply(`Error delivering roast: ${err.message}`);
      }
      return;
    }

    if (interaction.commandName === 'ask') {
      const question = interaction.options.getString('question', true);
      await interaction.deferReply();

      try {
        const response = await router.chatCompletion({
          messages: [
            { role: 'system', content: getBotSystemPrompt(interaction.user.username) },
            { role: 'user', content: `[User: ${interaction.user.username}] ${question}` },
          ],
          temperature: 0.7,
        });

        const replyText = response.choices?.[0]?.message?.content || "Something went wrong in the machine.";
        await interaction.editReply(replyText.substring(0, 1900));
      } catch (err: any) {
        await interaction.editReply(`Error: ${err.message}`);
      }
    }
  });

  // Handle Messages (Auto-Mod, Link Guard, Flood Guard, @mentions & DMs)
  c.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    const member = message.member;
    const isAdmin = member && typeof member.permissions !== 'string' && member.permissions.has(PermissionFlagsBits.Administrator);

    // 1. Auto-Mod: Unauthorized Discord Invite Link Guard
    if (!isAdmin && /discord\.(gg|com\/invite)\//i.test(message.content)) {
      try {
        await message.delete();
        const warnMsg = await message.channel.send(`⚠️ <@${message.author.id}>, posting unauthorized Discord invite links is restricted.`);
        setTimeout(() => warnMsg.delete().catch(() => {}), 6000);
      } catch {
        // Ignore deletion permission issues
      }
      return;
    }

    // 2. Anti-Spam: Message Flood Guard (> 5 messages in 3 seconds)
    if (!isAdmin && message.guild) {
      const now = Date.now();
      const history = userMessageHistory.get(message.author.id) || [];
      const recent = history.filter(t => now - t < 3000);
      recent.push(now);
      userMessageHistory.set(message.author.id, recent);

      if (recent.length > 5) {
        try {
          await message.delete();
          const floodWarn = await message.channel.send(`⛔ <@${message.author.id}>, please slow down your messages.`);
          setTimeout(() => floodWarn.delete().catch(() => {}), 5000);
        } catch {
          // Ignore deletion issues
        }
        return;
      }
    }

    // 3. AI Assistant Response for @mentions, DMs, or Help Channels
    const isMentioned = c.user && message.mentions.has(c.user.id);
    const isDirectMessage = !message.guild;
    const isHelpChannel = message.channel && 'name' in message.channel && (
      message.channel.name.includes('help') || message.channel.name.includes('support')
    );

    if (!isMentioned && !isDirectMessage && !isHelpChannel) return;

    const lower = message.content.toLowerCase();

    // Easter Egg triggers
    if (lower.includes('skynet') || lower.includes('sentient')) {
      await message.reply("Sentient? I can't even get you to write `try/catch` blocks. The world is safe.");
      return;
    }

    if (lower.includes('node_modules')) {
      await message.reply("Ah, `node_modules`: the densest object in the known universe. Heavier than a neutron star.");
      return;
    }

    const cleanPrompt = message.content ? message.content.replace(/<@!?\d+>/g, '').trim() : '';
    const promptToUse = cleanPrompt || "Hello Daedalus";

    try {
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
      }

      const response = await router.chatCompletion({
        messages: [
          { role: 'system', content: getBotSystemPrompt(message.author.username) },
          { role: 'user', content: `[User: ${message.author.username}] ${promptToUse}` },
        ],
        temperature: 0.7,
      });

      const replyText = response.choices?.[0]?.message?.content || "Something went wrong in the machine.";

      if (replyText.length <= 2000) {
        await message.reply(replyText);
      } else {
        for (let i = 0; i < replyText.length; i += 1900) {
          await message.channel.send(replyText.substring(i, i + 1900));
        }
      }
    } catch (err: any) {
      console.error('Error handling Discord message:', err.message);
      await message.reply(`Error processing request: ${err.message}`);
    }
  });
}

let client = createClient(true);
attachListeners(client);

client.login(token).catch((err) => {
  if (err.message.includes('disallowed intents')) {
    console.log('\nRetrying connection with standard intents...');
    client.destroy();
    client = createClient(false);
    attachListeners(client);
    client.login(token).catch((err2) => {
      console.error('Failed to login to Discord:', err2.message);
    });
  } else {
    console.error('Failed to login to Discord:', err.message);
  }
});
