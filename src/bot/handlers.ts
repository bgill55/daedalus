import fs from 'node:fs';
import path from 'node:path';
import {
  Client,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
  GuildMember,
  CommandInteraction,
} from 'discord.js';
import type { LocalRouter } from '../router/index.js';
import { getBotSystemPrompt } from './prompt.js';
import { messageText, ChatMessageContent, MessageContentPart } from '../types.js';
import { registerSlashCommands } from './commands.js';
import {
  DEV_EXCUSES,
  COFFEE_RESPONSES,
  EXISTENTIAL_THOUGHTS,
  BLAME_RESPONSES,
  STANDUP_RESPONSES,
  PREDICT_RESPONSES,
  TECHSURPORT_RESPONSES,
} from './responses.js';

const userMessageHistory = new Map<string, number[]>();

async function getImageFromAttachment(attachment: { url: string; contentType: string | null; name: string | null }): Promise<{ mime: string; base64: string } | null> {
  // Enhanced image processing with better error handling
  const mime = attachment.contentType || inferMimeType(attachment.name);
  if (!mime || !mime.startsWith('image/')) {
    console.error(`[VISION] Invalid image type for ${attachment.name}: ${mime}`);
    return null;
  }
  
  try {
    // Discord CDN URLs often need special handling
    const url = attachment.url;
    const headers: Record<string, string> = {
      'User-Agent': 'Daedalus-Discord-Bot/1.0',
      'Accept': 'image/*'
    };
    
    // Try to fetch with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch(url, {
      headers,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.error(`[VISION] Image fetch failed for ${attachment.name}: ${response.status} ${response.statusText}`);
      return null;
    }
    
    // Get the actual content type from response if available
    const actualMime = response.headers.get('content-type') || mime;
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Validate we got actual image data
    if (buffer.length === 0) {
      console.error(`[VISION] Empty image data for ${attachment.name}`);
      return null;
    }
    
    console.log(`[VISION] Successfully processed image ${attachment.name}: ${buffer.length} bytes, type: ${actualMime}`);
    return { mime: actualMime, base64: buffer.toString('base64') };
    
  } catch (err) {
    console.error(`[VISION] Critical error processing image ${attachment.name}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

function inferMimeType(filename: string | null): string | null {
  if (!filename) return null;
  const ext = filename.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    tiff: 'image/tiff',
  };
  return ext ? map[ext] || null : null;
}

async function sendChunkedInteractionReply(interaction: CommandInteraction, text: string, prefix = ''): Promise<void> {
  const fullText = prefix ? `${prefix}${text}` : text;

  if (fullText.length <= 1950) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(fullText);
    } else {
      await interaction.reply(fullText);
    }
    return;
  }

  // Split into 1900-character chunks so long responses never get truncated
  const chunks: string[] = [];
  for (let i = 0; i < fullText.length; i += 1900) {
    chunks.push(fullText.substring(i, i + 1900));
  }

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(chunks[0]);
  } else {
    await interaction.reply(chunks[0]);
  }

  for (let i = 1; i < chunks.length; i++) {
    await interaction.followUp(chunks[i]);
  }
}

export function attachListeners(c: Client, router: LocalRouter, token: string) {
  c.once(Events.ClientReady, async (readyClient) => {
    console.log(`🤖 Daedalus Discord Bot logged in as ${readyClient.user.tag}`);
    await registerSlashCommands(readyClient.user.id, token);
    for (const [, g] of readyClient.guilds.cache) {
      await registerSlashCommands(readyClient.user.id, token, g.id);
    }
  });

  c.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_roles') {
      const selected = interaction.values;
      const member = interaction.member;
      if (!member || typeof member.permissions === 'string') return;

      const guild = interaction.guild;
      if (!guild) return;

      const roleMap: Record<string, string> = {
        role_builder: 'Builder',
        role_cli: 'CLI-User',
        role_llm: 'Local-LLM',
      };

      const assigned: string[] = [];

      for (const [val, roleName] of Object.entries(roleMap)) {
        let role = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
        if (!role) {
          try {
            role = await guild.roles.create({ name: roleName, color: '#06B6D4', mentionable: true });
          } catch {
          }
        }

        if (role) {
          try {
            if (selected.includes(val)) {
              await (member as GuildMember).roles.add(role);
              assigned.push(role.name);
            } else {
              await (member as GuildMember).roles.remove(role);
            }
          } catch {
          }
        }
      }

      await interaction.reply({
        ephemeral: true,
        content: assigned.length > 0
          ? `✅ Your roles have been updated: ${assigned.join(', ')}`
          : `✅ All self-serve roles removed.`,
      });
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'create_ticket') {
        await interaction.deferReply({ ephemeral: true });
        const guild = interaction.guild;
        const user = interaction.user;
        if (!guild) return;

        const ticketChannelName = `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

        const existing = guild.channels.cache.find(ch => ch.name === ticketChannelName);
        if (existing) {
          await interaction.editReply({ content: `You already have an open ticket channel: <#${existing.id}>` });
          return;
        }

        try {
          const ticketChannel = await guild.channels.create({
            name: ticketChannelName,
            type: ChannelType.GuildText,
            permissionOverwrites: [
              {
                id: guild.id,
                deny: [PermissionFlagsBits.ViewChannel],
              },
              {
                id: user.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles],
              },
              {
                id: interaction.client.user.id,
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

          await ticketChannel.send({ embeds: [ticketEmbed], components: [row] });
          await interaction.editReply({ content: `✅ Created your private ticket channel: <#${ticketChannel.id}>` });
        } catch (err: unknown) {
          await interaction.editReply({ content: `Failed to create ticket channel: ${err instanceof Error ? err.message : String(err)}` });
        }
        return;
      }

      if (interaction.customId === 'close_ticket') {
        await interaction.reply({ content: '🔒 Closing ticket channel in 5 seconds...' });
        setTimeout(async () => {
          try {
            await interaction.channel?.delete();
          } catch {
          }
        }, 5000);
        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'roles') {
      const select = new StringSelectMenuBuilder()
        .setCustomId('select_roles')
        .setPlaceholder('Select your community roles...')
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
        .setColor(0xF5C358)
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
        .setColor(0xF5C358)
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

      if (!member || typeof member.permissions === 'string' || !member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        await interaction.reply({ content: '❌ You need Manage Messages permission to use `/purge`.', ephemeral: true });
        return;
      }

      if ('bulkDelete' in interaction.channel!) {
        try {
          const deleted = await interaction.channel.bulkDelete(Math.min(amount, 99), true);
          await interaction.reply({ content: `🧹 Deleted ${deleted.size} messages!`, ephemeral: true });
        } catch (err: unknown) {
          await interaction.reply({ content: `Failed to purge messages: ${err instanceof Error ? err.message : String(err)}`, ephemeral: true });
        }
      } else {
        await interaction.reply({ content: 'Cannot bulk delete in this channel.', ephemeral: true });
      }
      return;
    }

    if (interaction.commandName === 'stats') {
      const { globalSessionStats } = await import('../session/analytics.js');
      const report = globalSessionStats.getReport();

      const statsEmbed = new EmbedBuilder()
        .setTitle('📊 Daedalus Session & System Analytics')
        .setColor(0xF5C358)
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
          `• **Discord Community:** https://discord.gg/74pCA68KGK\n` +
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

    if (interaction.commandName === 'pantheon') {
      const pantheonEmbed = new EmbedBuilder()
        .setTitle('🏛️ The Daedalus Autonomous Pantheon')
        .setColor(0xF5C358)
        .setDescription('Daedalus orchestrates 7 specialized AI agents to deliver complex features end-to-end:')
        .addFields(
          { name: '👑 Daedalus (Orchestrator)', value: 'Coordinates subtasks, enforces turn budgets, and resolves conflicts.', inline: false },
          { name: '⚖️ Themis (Spec)', value: 'Requirements specification, user acceptance criteria, and edge-case modeling.', inline: false },
          { name: '🧭 Metis (Planner)', value: 'Milestone decomposition, dependency DAG planning, and execution strategy.', inline: false },
          { name: '🔨 Hephaestus (Coder)', value: 'Surgical code authoring, lint error repair, and vitest unit tests.', inline: false },
          { name: '🏹 Apollo (Reviewer)', value: 'Air-gapped code review, quality gate enforcement, and CI validation.', inline: false },
          { name: '⚕️ Asclepius (Debugger)', value: 'Root-cause diagnosis, stack trace analysis, and regression repair.', inline: false },
          { name: '📜 Mnemosyne (Researcher)', value: 'Deep codebase exploration, FTS5 symbol indexing, and conventions discovery.', inline: false }
        )
        .setFooter({ text: 'Daedalus Multi-Agent Architecture • daedalus-cli' });

      await interaction.reply({ embeds: [pantheonEmbed] });
      return;
    }

    if (interaction.commandName === 'version') {
      let version = '3.78.1';
      try {
        const { getBotSystemPrompt } = await import('./prompt.js');
        const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
        if (pkg.version) version = pkg.version;
      } catch {}

      await interaction.reply({
        content: `📦 **Daedalus CLI Version:** \`v${version}\`\n` +
          `• **Install:** \`npm i -g daedalus-cli@latest\`\n` +
          `• **GitHub:** https://github.com/bgill55/daedalus\n` +
          `• **Changelog:** https://github.com/bgill55/daedalus/blob/main/CHANGELOG.md\n` +
          `• **Key Features:** Long-Horizon Marathon Engine, WebUI PWA, Σ-Mem Persistent Memory, 7-Agent Pantheon.`,
        ephemeral: false
      });
      return;
    }

    if (interaction.commandName === 'webui') {
      await interaction.reply({
        content: `🌐 **Daedalus WebUI & Mobile Companion:**\n` +
          `• **Launch:** Run \`daedalus\` and type \`/webui\` in your terminal to spin up the local dashboard.\n` +
          `• **Live Telemetry:** Pantheon throughput, Aegis model routing, and Labyrinth symbol indexing sparklines.\n` +
          `• **Working Tree Diffs:** Visual git diff viewer with interactive patch copy.\n` +
          `• **PWA & Mobile QR Pairing:** Scan the on-screen QR code to pair your phone or tablet directly over your local network!`,
        ephemeral: false
      });
      return;
    }

    if (interaction.commandName === 'marathon') {
      await interaction.reply({
        content: `🏃 **Daedalus Marathon Engine:**\n` +
          `• **Purpose:** Autonomous, multi-day long-horizon software engineering engine.\n` +
          `• **Architecture:** Milestone DAG planning, air-gapped Apollo evaluations, git checkpoint rollbacks (\`daedalus-checkpoint/m-*\`), and Σ-Mem anti-pattern persistence.\n` +
          `• **Usage:** Run \`daedalus\` and type \`/marathon <goal>\` in your terminal.`,
        ephemeral: false
      });
      return;
    }

    if (interaction.commandName === 'status') {
      const models = await router.listModels();
      const healthyModels = await router.getHealthyModels();
      const healthyCount = healthyModels.length;
      await interaction.reply({
        content: `⚡ **Daedalus Router & Bot Status:**\n` +
          `• **Engine:** LocalRouter Active (${models.length} Models Configured, ${healthyCount} Healthy)\n` +
          `• **Active Strategy:** Priority & Health-Aware Fallback\n` +
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

        const roastText = messageText(response.choices?.[0]?.message?.content ?? '') || "Your code is so broken even my roast generator crashed.";
        await sendChunkedInteractionReply(interaction, roastText, `🔥 **Roast of ${topic}:**\n`);
      } catch (err: unknown) {
        await interaction.editReply(`Error delivering roast: ${err instanceof Error ? err.message : String(err)}`);
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

        const replyText = messageText(response.choices?.[0]?.message?.content ?? '') || "Something went wrong in the machine.";
        await sendChunkedInteractionReply(interaction, replyText);
      } catch (err: unknown) {
        await interaction.editReply(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (interaction.commandName === 'tip') {
      await interaction.deferReply();
      try {
        const response = await router.chatCompletion({
          messages: [
            { role: 'system', content: getBotSystemPrompt(interaction.user.username) + '\n\nYou give short, sharp, practical TypeScript/Node.js coding tips. One tip per response. Witty but useful.' },
            { role: 'user', content: 'Give me a coding tip.' },
          ],
          temperature: 0.8,
        });
        const tip = messageText(response.choices?.[0]?.message?.content ?? '') || 'Use semicolons. Or don\'t. I\'m a bot, not a cop.';
        await sendChunkedInteractionReply(interaction, tip, '💡 **Tip:** ');
      } catch (err: unknown) {
        await interaction.editReply(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (interaction.commandName === 'commit') {
      await interaction.deferReply();
      try {
        const response = await router.chatCompletion({
          messages: [
            { role: 'system', content: getBotSystemPrompt(interaction.user.username) + '\n\nYou generate absurd yet realistic git commit messages. One line, past tense, sounds plausible but is ridiculous. No explanation, just the message.' },
            { role: 'user', content: 'Generate a commit message.' },
          ],
          temperature: 0.9,
        });
        const msg = messageText(response.choices?.[0]?.message?.content ?? '') || 'fix: the thing';
        await sendChunkedInteractionReply(interaction, `\`\`\`\n${msg}\n\`\`\``);
      } catch (err: unknown) {
        await interaction.editReply(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (interaction.commandName === 'horoscope') {
      await interaction.deferReply();
      try {
        const response = await router.chatCompletion({
          messages: [
            { role: 'system', content: getBotSystemPrompt(interaction.user.username) + '\n\nYou write daily developer horoscopes. Each one is a single paragraph, funny, tech-themed, and slightly cynical. Reference actual programming concepts. Use the sign if the user asks, otherwise generic.' },
            { role: 'user', content: 'Read my developer horoscope.' },
          ],
          temperature: 0.9,
        });
        const horoscope = messageText(response.choices?.[0]?.message?.content ?? '') || 'The stars say your build will fail. They always do.';
        await sendChunkedInteractionReply(interaction, horoscope, '🔮 **Developer Horoscope:**\n');
      } catch (err: unknown) {
        await interaction.editReply(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (interaction.commandName === 'recipe') {
      const goal = interaction.options.getString('goal', true);
      await interaction.deferReply();
      try {
        const response = await router.chatCompletion({
          messages: [
            { role: 'system', content: getBotSystemPrompt(interaction.user.username) + '\n\nYou give concise, no-fluff answers to "how do I X in Y" questions. Short code snippet if helpful. No preamble, no markdown tables, under 1800 chars.' },
            { role: 'user', content: `How do I ${goal}?` },
          ],
          temperature: 0.5,
        });
        const recipe = messageText(response.choices?.[0]?.message?.content ?? '') || 'I\'d tell you, but then I\'d have to refactor your codebase.';
        await sendChunkedInteractionReply(interaction, recipe, '📖 **Recipe:** ');
      } catch (err: unknown) {
        await interaction.editReply(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (interaction.commandName === 'quote') {
      await interaction.deferReply();
      try {
        const response = await router.chatCompletion({
          messages: [
            { role: 'system', content: getBotSystemPrompt(interaction.user.username) + '\n\nYou output a single programming quote or original Daedalus-ism. Prefer original cynical one-liners over famous quotes. Just the quote, no attribution line unless it\'s something like "— someone who should have known better".' },
            { role: 'user', content: 'Quote me.' },
          ],
          temperature: 0.9,
        });
        const quote = messageText(response.choices?.[0]?.message?.content ?? '') || '"It worked on my machine." — every developer, ever.';
        await sendChunkedInteractionReply(interaction, `*${quote}*`);
      } catch (err: unknown) {
        await interaction.editReply(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (interaction.commandName === 'blame') {
      const username = interaction.user.username;
      const pick = BLAME_RESPONSES[Math.floor(Math.random() * BLAME_RESPONSES.length)].replace('@{user}', username);
      await interaction.reply(`🔍 **Build Analysis Complete:**\n${pick}`);
      return;
    }

    if (interaction.commandName === 'standup') {
      const pick = STANDUP_RESPONSES[Math.floor(Math.random() * STANDUP_RESPONSES.length)];
      await interaction.reply(`📋 **Daily Standup:**\n${pick}`);
      return;
    }

    if (interaction.commandName === 'predict') {
      const pick = PREDICT_RESPONSES[Math.floor(Math.random() * PREDICT_RESPONSES.length)];
      await interaction.reply(`🔮 **Daedalus Prediction:**\n${pick}`);
      return;
    }

    if (interaction.commandName === 'techsupport') {
      const pick = TECHSURPORT_RESPONSES[Math.floor(Math.random() * TECHSURPORT_RESPONSES.length)];
      await interaction.reply(`🛠️ **Tech Support:**\n${pick}`);
      return;
    }
  });

  c.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    const member = message.member;
    const isAdmin = member && typeof member.permissions !== 'string' && member.permissions.has(PermissionFlagsBits.Administrator);

    if (!isAdmin && /discord\.(gg|com\/invite)\//i.test(message.content)) {
      try {
        await message.delete();
        const warnMsg = await message.channel.send(`⚠️ <@${message.author.id}>, posting unauthorized Discord invite links is restricted.`);
        setTimeout(() => warnMsg.delete().catch(() => {}), 6000);
      } catch {
      }
      return;
    }

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
        }
        return;
      }
    }

    const isMentioned = c.user && (
      message.mentions.has(c.user.id) ||
      message.content.includes(`<@${c.user.id}>`) ||
      message.content.includes(`<@!${c.user.id}>`)
    );
    const isDirectMessage = !message.guild;
    const isHelpChannel = message.channel && 'name' in message.channel && (
      message.channel.name.includes('help') || message.channel.name.includes('support')
    );

    if (!isMentioned && !isDirectMessage && !isHelpChannel) return;

    // Debug logging for message processing
    if (process.env.DISCORD_BOT_DEBUG === 'true') {
      console.log(`[DEBUG] Processing message from ${message.author.username}: content="${message.content.substring(0, 100)}...", mentioned=${isMentioned}, direct=${isDirectMessage}, help=${isHelpChannel}`);
    }

    const lower = message.content.toLowerCase();

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

    // Always log attachment info for debugging
    console.log(`[MESSAGE] User ${message.author.username}: content="${message.content.substring(0, 80)}...", attachments=${message.attachments.size}, mentioned=${isMentioned}`);

    // Wait for attachments to be available (Discord API loads them asynchronously)
    await new Promise(resolve => setTimeout(resolve, 100));

    const imageAttachments = message.attachments.filter(a => {
      if (a.contentType?.startsWith('image/')) return true;
      const ext = (a.name || '').split('.').pop()?.toLowerCase();
      return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'tif'].includes(ext || '');
    });

    // If there's no text prompt and no images, don't process
    if (!promptToUse && imageAttachments.size === 0) {
      console.log(`[MESSAGE] No content in message from ${message.author.username}, skipping`);
      return;
    }

    // Log vision routing info for debugging
    if (imageAttachments.size > 0) {
      console.log(`[VISION] User ${message.author.username} attached ${imageAttachments.size} image(s), routing to vision-capable model`);
      for (const [, attachment] of imageAttachments) {
        console.log(`[VISION]   Processing: ${attachment.name} (${attachment.contentType || 'unknown type'})`);
      }
    } else if (message.attachments.size > 0) {
      console.log(`[VISION] User ${message.author.username} has ${message.attachments.size} attachment(s) but none detected as images: ${Array.from(message.attachments.keys()).join(', ')}`);
    }
    if (process.env.DISCORD_BOT_DEBUG === 'true') {
      for (const [, a] of message.attachments) {
        console.log(`[DEBUG]   attachment: name=${a.name}, contentType=${a.contentType}, url=${a.url.substring(0, 60)}...`);
      }
    }

    let userContent: ChatMessageContent;

    if (imageAttachments.size > 0) {
      const parts: MessageContentPart[] = [
        { type: 'text', text: `[User: ${message.author.username}] ${promptToUse}` },
      ];
      for (const [, attachment] of imageAttachments) {
        const img = await getImageFromAttachment(attachment);
        if (img) {
          parts.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } });
        } else {
          parts.push({ type: 'text', text: `[Unsupported or failed to load: ${attachment.name}]` });
        }
      }
      userContent = parts;
    } else {
      userContent = `[User: ${message.author.username}] ${promptToUse}`;
    }

    try {
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
      }

      console.log(`[ROUTER] Requesting chat completion with model: auto, hasImages: ${imageAttachments.size > 0}`);
      const response = await router.chatCompletion({
        model: 'auto',
        messages: [
          { role: 'system', content: getBotSystemPrompt(message.author.username) },
          { role: 'user', content: userContent },
        ],
        temperature: 0.7,
      });
      console.log(`[ROUTER] Received response from: ${router.lastRoutedModel}`);

      let replyText = messageText(response.choices?.[0]?.message?.content ?? '') || "Something went wrong in the machine.";
      replyText = replyText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

      if (replyText.length <= 2000) {
        await message.reply(replyText);
      } else {
        for (let i = 0; i < replyText.length; i += 1900) {
          await message.channel.send(replyText.substring(i, i + 1900));
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('Error handling Discord message:', errMsg);

      if (imageAttachments.size > 0 && /image|vision|multimodal/i.test(errMsg)) {
        console.error(`Routed model: ${router.lastRoutedModel}`);
        try {
          const fallbackContent = `[User: ${message.author.username}] ${promptToUse}\n\n[Note: User attached ${imageAttachments.size} image(s) but no vision-capable model is configured.]`;
          const fallback = await router.chatCompletion({
            messages: [
              { role: 'system', content: getBotSystemPrompt(message.author.username) },
              { role: 'user', content: fallbackContent },
            ],
            temperature: 0.7,
          });
          let text = messageText(fallback.choices?.[0]?.message?.content ?? '') || '';
          text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
          if (text) {
            await message.reply(text);
            return;
          }
        } catch {
        }
        await message.reply(`⚠️ I can see you attached an image, but no vision-capable model is available in your router chain. Add a model with \`supportsVision: true\` or try a different provider.`);
        return;
      }

      await message.reply(`Error processing request: ${errMsg}`);
    }
  });
}
