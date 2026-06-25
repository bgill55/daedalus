// Daedalus First-Run Onboarding Wizard
// Guides users through initial setup — local or remote LLM configuration

import readline from 'readline';
import pc from 'picocolors';
import { loadConfig, saveConfig, discoverLocalServers } from '../config/index.js';
import { DaedalusConfig } from '../config/index.js';
import { checkModelHealth } from '../router/health.js';
import type { ModelEntry } from '../router/types.js';

// ── Utility: prompt for input ──

function question(rl: readline.Interface, query: string): Promise<string> {
  return new Promise(resolve => rl.question(query, resolve));
}

// ── Check if any model is actually reachable ──

async function hasAnyHealthyModel(config: DaedalusConfig): Promise<boolean> {
  const enabled = config.router.chain.filter(m => m.enabled);
  if (enabled.length === 0) return false;
  const results = await Promise.allSettled(
    enabled.map(m => checkModelHealth(m as ModelEntry, 5000))
  );
  return results.some(r => r.status === 'fulfilled' && (r.value).healthy === true);
}

// ── Add a remote provider entry ──

function addRemoteProvider(
  config: DaedalusConfig,
  name: string,
  endpoint: string,
  apiKey?: string
): void {
  // Disable all current entries first
  config.router.chain.forEach(m => { m.enabled = false; });

  // Add the new one with priority 1
  config.router.chain.unshift({
    name,
    endpoint,
    model: 'auto',
    priority: 1,
    enabled: true,
    supportsTools: true,
    apiKey: apiKey || undefined,
  });

  if (apiKey) {
    const keyVar = name.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY';
    console.log(pc.gray(`\n  [TIP] API key saved in config. You can also set ${pc.bold(keyVar)} as an environment variable.`));
  }
}

// ── Auto-configure with the first discovered local server ──

function addLocalServer(config: DaedalusConfig, discovered: Array<{ name: string; endpoint: string; models: string[] }>): void {
  config.router.chain.forEach(m => { m.enabled = false; });
  const server = discovered[0];
  config.router.chain.unshift({
    name: server.name.toLowerCase().replace(/\s+/g, '-'),
    endpoint: server.endpoint,
    model: 'auto',
    priority: 1,
    enabled: true,
    supportsTools: true,
  });
  console.log(pc.green(`  ✔ Added ${server.name} at ${server.endpoint}`));
}

// ── Main wizard entry point ──

export async function runOnboarding(force = false): Promise<void> {
  // Quick check — if already configured with a healthy model, skip entirely (unless forced)
  const initialConfig = loadConfig();
  if (!force) {
    const alreadyHealthy = await hasAnyHealthyModel(initialConfig);
    if (alreadyHealthy) return;
  }

  // Flag to detect if user made changes
  let configChanged = false;
  const config = loadConfig();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // ── Welcome ──
  console.log();
  console.log(pc.bold(pc.cyan('  ╔══════════════════════════════════════════════════╗')));
  const welcomeLine = '      Welcome to Daedalus — First-Time Setup     ';
  console.log(pc.bold(pc.cyan('  ║' + welcomeLine + '║')));
  console.log(pc.bold(pc.cyan('  ╚══════════════════════════════════════════════════╝')));
  console.log();
  console.log(pc.gray('  I need at least one LLM backend to start chatting.'));
  console.log(pc.gray('  Let me help you get connected.'));
  console.log();

  // ── Step 1: Auto-discover ──
  console.log(pc.bold('[SCAN] Scanning for local LLM servers...'));
  const discovered = await discoverLocalServers();

  if (discovered.length > 0) {
    console.log(pc.green(`  Found ${discovered.length} running server(s):`));
    for (const s of discovered) {
      console.log(`    ${pc.green('●')} ${s.name} at ${s.endpoint}`);
      if (s.models.length > 0) {
        console.log(`       Models: ${s.models.slice(0, 3).join(', ')}${s.models.length > 3 ? '...' : ''}`);
      }
    }
    console.log();

    const ans = await question(rl, pc.bold('  Use the first discovered server automatically? [Y/n] '));
    if (!ans.toLowerCase().startsWith('n')) {
      addLocalServer(config, discovered);
      configChanged = true;
      console.log();
    }
  } else {
    console.log(pc.yellow('  No local servers detected.'));
    console.log();
  }

  // ── Step 2: If still not configured, show options ──
  if (!configChanged) {
    await showOptionsMenu(rl, config);
    configChanged = true;
  }

  // ── Step 3: Save config ──
  if (configChanged) {
    saveConfig(config);
    console.log(pc.green('\n✔ Configuration saved!'));
  }

  // ── Step 4: Test ──
  console.log(pc.bold('\n[TEST] Testing connection...'));
  const healthy = await hasAnyHealthyModel(config);
  if (healthy) {
    console.log(pc.green('  [OK] Connection successful! Ready to chat.'));
  } else {
    console.log(pc.yellow('  [WARN] Still no healthy model. Run /doctor anytime to diagnose.'));
    console.log(pc.gray('  You can also type /config to see current settings.'));
  }

  console.log(pc.gray('\n  Tip: type /help or /commands anytime to see what I can do.'));
  console.log(pc.gray('  Tip: use /session new <absolute-path> to switch project roots without restarting.'));
  console.log();

  rl.close();
  // Ensure stdin is back to normal for the main REPL
  if (process.stdin.isPaused()) {
    process.stdin.resume();
  }
}

// ── Options menu when no server is found ──

async function showOptionsMenu(rl: readline.Interface, config: DaedalusConfig): Promise<void> {
  while (true) {
    console.log(pc.bold('\n  [CFG] What would you like to do?'));
    console.log();
    console.log('    1)  Start a local server and scan again');
    console.log('    2)  Connect to a remote API (OpenAI, Groq, OpenRouter, etc.)');
    console.log('    3)  I\'ll configure it myself later');
    console.log();

    const choice = await question(rl, pc.bold('  Your choice (1-3): '));
    const trimmed = choice.trim();

    if (trimmed === '1') {
      console.log(pc.gray('\n  Please start one of these in another terminal:'));
      console.log(pc.gray('    • LM Studio — open app, start server on :1234'));
      console.log(pc.gray('    • Ollama — run "ollama serve"'));
      console.log(pc.gray('    • llama.cpp — run "./server" (default :8080)'));
      console.log(pc.gray('    • vLLM — run "vllm serve" (default :8000)'));
      console.log();
      await question(rl, pc.bold('  Press Enter after starting your server...'));
      console.log(pc.bold('\n[SCAN] Re-scanning...'));
      const discovered = await discoverLocalServers();
      if (discovered.length > 0) {
        console.log(pc.green(`  Found ${discovered.length} server(s)!`));
        addLocalServer(config, discovered);
        return;
      } else {
        console.log(pc.yellow('  Still nothing detected. Try again or choose another option.'));
        continue;
      }
    }

    if (trimmed === '2') {
      await configureRemoteProvider(rl, config);
      return;
    }

    if (trimmed === '3') {
      console.log(pc.gray('\n  No problem! Run /doctor anytime to auto-detect servers,'));
      console.log(pc.gray('  or edit ~/.daedalus/config.json manually.'));
      console.log(pc.gray('  Type /config to see current settings.'));
      return;
    }

    console.log(pc.red('  Invalid choice. Please enter 1, 2, or 3.'));
  }
}

// ── Remote provider configuration ──

async function configureRemoteProvider(rl: readline.Interface, config: DaedalusConfig): Promise<void> {
  console.log(pc.bold('\n  [REMOTE] Remote API Configuration'));
  console.log();
  console.log('  Popular providers:');
  console.log('    1)  OpenAI         — https://api.openai.com/v1');
  console.log('    2)  Groq           — https://api.groq.com/openai/v1');
  console.log('    3)  OpenRouter     — https://openrouter.ai/api/v1');
  console.log('    4)  Anthropic      — https://api.anthropic.com/v1');
  console.log('    5)  Custom URL');
  console.log();

  const presets: Record<string, { name: string; endpoint: string }> = {
    '1': { name: 'openai', endpoint: 'https://api.openai.com/v1' },
    '2': { name: 'groq', endpoint: 'https://api.groq.com/openai/v1' },
    '3': { name: 'openrouter', endpoint: 'https://openrouter.ai/api/v1' },
    '4': { name: 'anthropic', endpoint: 'https://api.anthropic.com/v1' },
  };

  const choice = await question(rl, pc.bold('  Select provider (1-5): '));
  const trimmed = choice.trim();
  let baseUrl: string;
  let providerName: string;

  if (presets[trimmed]) {
    baseUrl = presets[trimmed].endpoint;
    providerName = presets[trimmed].name;
    console.log(pc.gray(`  Using: ${baseUrl}`));
  } else if (trimmed === '5') {
    baseUrl = await question(rl, pc.bold('  Enter API base URL: '));
    providerName = 'custom';
  } else {
    console.log(pc.yellow('  Invalid choice, defaulting to custom.'));
    baseUrl = await question(rl, pc.bold('  Enter API base URL: '));
    providerName = 'custom';
  }

  const apiKey = await question(rl, pc.bold('  Enter your API key (or leave blank if none): '));

  // Validate — try a simple request
  console.log(pc.gray('\n  Testing connection...'));
  try {
    const testEndpoint = baseUrl.replace(/\/+$/, '') + '/models';
    const res = await fetch(testEndpoint, {
      headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      console.log(pc.green('  [OK] Connection successful!'));
    } else {
      console.log(pc.yellow(`  [WARN] Server responded with status ${res.status} — but I'll save it anyway.`));
    }
  } catch {
    console.log(pc.yellow('  [WARN] Could not reach the server — but I\'ll save it anyway.'));
  }

  addRemoteProvider(config, providerName, baseUrl, apiKey || undefined);
}
