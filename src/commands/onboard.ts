import pc from 'picocolors';
import { discoverLocalServers, saveConfig } from '../config/index.js';
import { errMessage } from '../utils/errors.js';
import type { ModelEntry } from '../router/types.js';
import type { ChatMessage } from '../types.js';
import { messageText } from '../types.js';
import type { Command } from './types.js';

export const onboardCommand: Command = {
  name: '/onboard',
  description: 'First-time setup — discover local models, configure, and test',
  usage: '/onboard',
  helpText: 'Run the interactive setup wizard to scan your local network/environment for model servers, select a primary model tier, and test its output/diagnostics.',
  execute: async (_args, ctx) => {
    const config = ctx.config;

    console.log(pc.bold(pc.cyan('\n╔══════════════════════════════════════╗')));
    console.log(pc.bold(pc.cyan('║        Daedalus Onboarding          ║')));
    console.log(pc.bold(pc.cyan('╚══════════════════════════════════════╝')));
    console.log();
    console.log('Daedalus runs AI models locally on your machine.');
    console.log('First, I need to know which model server to use.');
    console.log();

    console.log(pc.bold('🔍 Scanning for local model servers...'));
    const discovered = await discoverLocalServers();

    let chosenEndpoint = '';
    let chosenModel = '';

    if (discovered.length > 0) {
      console.log(pc.green(`\n  Found ${discovered.length} running server(s):\n`));
      for (let i = 0; i < discovered.length; i++) {
        const s = discovered[i];
        console.log(`  ${i + 1}. ${pc.cyan(s.name)} at ${s.endpoint}`);
        for (const m of s.models.slice(0, 3)) {
          console.log(`     - ${m}`);
        }
        if (s.models.length > 3) {
          console.log(pc.gray(`     ... and ${s.models.length - 3} more`));
        }
      }

      console.log();
      const serverChoice = await ctx.askLine(`Select a server (1-${discovered.length}) or press Enter to add manually: `);
      const idx = parseInt(serverChoice) - 1;
      if (idx >= 0 && idx < discovered.length) {
        const server = discovered[idx];
        chosenEndpoint = server.endpoint;
        if (server.models.length === 1) {
          chosenModel = server.models[0];
        } else {
          console.log(`\nModels on ${pc.cyan(server.name)}:`);
          for (let i = 0; i < server.models.length; i++) {
            console.log(`  ${i + 1}. ${server.models[i]}`);
          }
          const modelChoice = await ctx.askLine(`Select a model (1-${server.models.length}): `);
          const midx = parseInt(modelChoice) - 1;
          if (midx >= 0 && midx < server.models.length) {
            chosenModel = server.models[midx];
          }
        }
      }
    }

    if (!chosenEndpoint) {
      console.log(`\nEnter your model server details manually.`);
      chosenEndpoint = await ctx.askLine('API endpoint (e.g. http://localhost:1234/v1): ');
      if (!chosenEndpoint) chosenEndpoint = 'http://localhost:1234/v1';
      chosenModel = await ctx.askLine('Model name (e.g. qwen2.5-coder-7b-instruct): ');
      if (!chosenModel) chosenModel = 'auto';
    }

    if (!chosenModel) chosenModel = 'auto';

    const entry = {
      name: chosenModel,
      endpoint: chosenEndpoint,
      model: chosenModel,
      priority: 1,
      enabled: true,
    };

    config.router.chain = [entry, ...config.router.chain.filter((e: ModelEntry) => e.endpoint !== chosenEndpoint)];
    saveConfig(config);

    console.log(pc.green(`\n✓ Added model "${pc.bold(chosenModel)}" at ${chosenEndpoint}`));

    const testPrompt = await ctx.askLine('\nRun a quick test? (Y/n): ');
    if (testPrompt.toLowerCase() !== 'n') {
      console.log(pc.dim('\nSending test request...'));
      try {
        const start = Date.now();
        const testMessages: ChatMessage[] = [
          { role: 'system', content: 'You are a helpful assistant. Respond in 1-2 sentences.' },
          { role: 'user', content: 'Say hello and confirm you are working.' },
        ];
        const testRouter = ctx.router;
        const completion = await testRouter.chat.completions.create({
          model: chosenModel,
          messages: testMessages,
          temperature: 0.1,
        });
        const elapsed = Date.now() - start;
        const text = messageText(completion.choices?.[0]?.message?.content ?? '') || '(no response)';
        console.log(pc.green(`\n✓ Response received in ${elapsed}ms:`));
        console.log(`  ${pc.white(text)}`);
      } catch (err) {
        console.log(pc.yellow(`\n⚠ Test failed: ${errMessage(err)}`));
        console.log('  The model is configured but may need troubleshooting.');
        console.log(`  Check ${pc.cyan(ctx.configDir + '/config.json')} and verify the endpoint.`);
      }
    }

    console.log(pc.green(`\n✓ Onboarding complete! Configuration saved to:`));
    console.log(`  ${pc.cyan(ctx.configDir + '/config.json')}`);
    console.log(`\nType ${pc.cyan('?')} to see all available commands, or just start typing.`);
  }
};
