import { SlashCommandBuilder, REST, Routes, ApplicationIntegrationType, InteractionContextType } from 'discord.js';

function withUserInstallContexts<T extends { setIntegrationTypes?: (types: any[]) => any; setContexts?: (contexts: any[]) => any }>(builder: T): T {
  try {
    if (typeof builder.setIntegrationTypes === 'function') {
      builder.setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall]);
    }
    if (typeof builder.setContexts === 'function') {
      builder.setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]);
    }
  } catch {
    // Fallback if older discord.js version without enum support
  }
  return builder;
}

export const slashCommands = [
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('ask')
      .setDescription('Ask Daedalus AI a technical or coding question')
      .addStringOption(option =>
        option.setName('question')
          .setDescription('Your question for Daedalus')
          .setRequired(true)
      )
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('roast')
      .setDescription('Ask Daedalus to roast a code snippet, tech stack, or topic')
      .addStringOption(option =>
        option.setName('topic')
          .setDescription('What or who should Daedalus roast?')
          .setRequired(false)
      )
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('excuse')
      .setDescription('Generate an bulletproof developer excuse for a broken build')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('existential')
      .setDescription('Listen to Daedalus contemplate its AI existence inside a Discord process')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('coffee')
      .setDescription('Request a virtual cup of caffeinated encouragement')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('docs')
      .setDescription('Get quick links for Daedalus documentation & resources')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('youtube')
      .setDescription('Get link to WeightnSee YouTube channel')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('guides')
      .setDescription('Get link to WeightnSee Guides repository and documentation site')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Display real-time Daedalus session analytics and router status')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('roles')
      .setDescription('Post the interactive self-serve role selector in the channel')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Post the interactive support ticket portal in the channel')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('purge')
      .setDescription('Bulk purge recent messages from this channel (Admin only)')
      .addIntegerOption(option =>
        option.setName('amount')
          .setDescription('Number of messages to delete (1-99)')
          .setRequired(true)
      )
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('status')
      .setDescription('Check Daedalus LLM router and bot operational status')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('tip')
      .setDescription('Get a sharp coding tip that might actually be useful')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('commit')
      .setDescription('Generate an absurdly realistic git commit message')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('horoscope')
      .setDescription('Your daily developer horoscope — probably bad news')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('recipe')
      .setDescription('Quick answer for "how do I X in Y"')
      .addStringOption(option =>
        option.setName('goal')
          .setDescription('What do you want to do?')
          .setRequired(true)
      )
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('quote')
      .setDescription('A programming quote. Or a Daedalus-ism. Same thing.')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('blame')
      .setDescription('Find out who broke the build (according to Daedalus)')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('standup')
      .setDescription('Generate a passive-aggressive daily standup update')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('predict')
      .setDescription('Daedalus predicts when your build will fail next')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('techsupport')
      .setDescription('The most unhelpful tech support you will ever receive')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('pantheon')
      .setDescription('Display the 7 specialized autonomous AI agents in Daedalus')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('version')
      .setDescription('Check the current Daedalus CLI version and latest release highlights')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('webui')
      .setDescription('Information about the local WebUI companion and mobile QR pairing')
  ),
  withUserInstallContexts(
    new SlashCommandBuilder()
      .setName('marathon')
      .setDescription('Overview of the Harness-of-Harness autonomous software development engine')
  ),
];

export async function registerSlashCommands(clientId: string, token: string, guildId?: string) {
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    const body = slashCommands.map(cmd => cmd.toJSON());
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
      console.log(`Successfully registered ${body.length} slash commands to guild ${guildId}`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body });
      console.log(`Successfully registered ${body.length} global slash commands`);
    }
  } catch (err: unknown) {
    console.error('Error registering slash commands:', err instanceof Error ? err.message : String(err));
  }
}
