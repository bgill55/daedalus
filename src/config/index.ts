// Daedalus configuration

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../tools/logger.js';

const logger = createLogger();

const ProviderRegistryEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  baseUrl: z.string(),
  exampleModel: z.string(),
  notes: z.string(),
});
export type ProviderRegistryEntry = z.infer<typeof ProviderRegistryEntrySchema>;

export const PROVIDER_REGISTRY: ProviderRegistryEntry[] = z.array(ProviderRegistryEntrySchema).parse([
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', exampleModel: 'gpt-4.1', notes: 'Official OpenAI. Use your own API key.' },
  { id: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', exampleModel: 'claude-sonnet-4-5', notes: 'Anthropic API. Requires the claude model gateway for tool calls.' },
  { id: 'google', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', exampleModel: 'gemini-2.5-flash', notes: 'Google AI Studio key via the OpenAI-compatible endpoint.' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', exampleModel: 'deepseek/deepseek-v3', notes: 'One key, many models.' },
  { id: 'freellmapi', label: 'FreeLLM API', baseUrl: 'http://127.0.0.1:3001/v1', exampleModel: 'auto', notes: 'Local free-tier proxy. Catalog-aware routing filters invalid ids.' },
  { id: 'custom', label: 'Custom / self-hosted', baseUrl: 'http://localhost:PORT/v1', exampleModel: 'your-model-id', notes: 'LM Studio, Ollama, vLLM, etc.' },
]);

export const ModelEntrySchema = z.object({
  name: z.string(),
  endpoint: z.string().refine(v => /^https?:\/\//i.test(v) || /^[a-zA-Z0-9.-]+:\d+/.test(v), {
    message: 'endpoint must be a URL (http://...) or host:port',
  }),
  model: z.string(),
  priority: z.number().int().min(0),
  enabled: z.boolean(),
  apiKey: z.string().optional(),
  provider: z.enum(['openai', 'anthropic', 'google', 'openrouter', 'freellmapi', 'custom']).optional(),
  maxTokens: z.number().int().positive().optional(),
  supportsTools: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  tier: z.enum(['standard', 'fast', 'intelligence']).default('standard').optional(),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const RouterConfigSchema = z.object({
  strategy: z.enum(['priority', 'round-robin', 'fastest']).default('priority'),
  chain: z.array(ModelEntrySchema).default([]),
  // Optional outbound proxy (e.g. an OneCLI gateway or corporate proxy) applied
  // to every model request. Explicit opt-in only — Daedalus never auto-discovers
  // a MITM proxy. Falls back to HTTPS_PROXY/HTTP_PROXY env vars when unset.
  proxyUrl: z.string().url().optional(),
  healthCheckInterval: z.number().int().positive().default(30000),
  requestTimeout: z.number().int().positive().default(120000),
  slowModelThresholdMs: z.number().int().nonnegative().default(45000),
  blacklistTtlMs: z.number().int().positive().default(600000),
  blacklistPersist: z.boolean().default(true),
  defaultRateLimit: z.object({
    rpm: z.number().int().positive().default(60),
    tpm: z.number().int().positive().default(100000),
  }).default({ rpm: 60, tpm: 100000 }),
  autoEscalate: z.boolean().default(true),
  complexityRouting: z.boolean().default(true),
  // Capability floor: the WEAKEST model Daedalus is allowed to use. When set to a
  // model name from the chain, the router never selects or escalates DOWN to any
  // model ranked below it (higher priority number = lower priority). This stops
  // the weak-tier thrash (e.g. a chain full of 120b models) without hardcoding a
  // provider — the floor references a model the user already configured. Provider-neutral.
  minModel: z.string().optional(),
});

export const AgentRoleSchema = z.object({
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  allowedTools: z.array(z.string()),
  canDelegate: z.boolean(),
  maxTurns: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export const ConfigSchema = z.object({
  version: z.number().int().positive().default(1),
  router: RouterConfigSchema,
  modelOverride: z.string().optional(),
  agents: z.object({
    default: z.string().default('coder'),
    available: z.array(z.string()).default(['orchestrator', 'planner', 'coder', 'reviewer', 'debugger', 'researcher']),
    autoOrchestrate: z.boolean().default(true),
    ensemble: z.object({
      enabled: z.boolean().default(false),
      draftModel: z.string().default('auto'),
      criticModel: z.string().default('auto'),
      maxLoops: z.number().int().min(1).max(5).default(2),
      candidatesCount: z.number().int().min(1).max(5).default(2),
    }).default({
      enabled: false,
      draftModel: 'auto',
      criticModel: 'auto',
      maxLoops: 2,
      candidatesCount: 2,
    }),
  }).default({
    default: 'coder',
    available: ['orchestrator', 'planner', 'coder', 'reviewer', 'debugger', 'researcher'],
    autoOrchestrate: true,
    ensemble: {
      enabled: false,
      draftModel: 'auto',
      criticModel: 'auto',
      maxLoops: 2,
    },
  }),
  tools: z.object({
    builtin: z.array(z.string()).default([
      'read_file', 'write_file', 'patch', 'search_files', 'list_files',
      'terminal', 'git_diff', 'git_status', 'todo', 'delegate_task',
      'web_search', 'fetch_url', 'index_codebase', 'find_symbol',
      'get_definition', 'get_references', 'generate_image',
      'handoff_task', 'set_context_variable'
    ]),
    mcpServers: z.record(z.object({
      transport: z.enum(['stdio', 'http']),
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      url: z.string().url().optional(),
      headers: z.record(z.string()).optional(),
      enabled: z.boolean().default(false),
    })).default({}),
    shell: z.string().optional(),
    permissions: z.object({
      terminal: z.enum(['auto', 'ask']).default('auto'),
      files: z.enum(['auto', 'ask']).default('auto'),
    }).default({ terminal: 'auto', files: 'auto' }),
    sandbox: z.enum(['none', 'docker', 'wsl']).default('none'),
    sandboxImage: z.string().default('node:20'),
    wslDistribution: z.string().optional(),
  }).default({
    builtin: [],
    mcpServers: {},
    sandbox: 'none',
    sandboxImage: 'node:20',
  }),
  imageGen: z.object({
    enabled: z.boolean().default(true),
    provider: z.enum(['auto', 'sd-webui', 'pollinations']).default('auto'),
    endpoint: z.string().default('http://127.0.0.1:7860'),
    defaultWidth: z.number().int().positive().default(512),
    defaultHeight: z.number().int().positive().default(512),
    defaultSteps: z.number().int().positive().default(20),
    outputDir: z.string().default('./assets/images'),
  }).default({
    enabled: true,
    provider: 'auto',
    endpoint: 'http://127.0.0.1:7860',
    defaultWidth: 512,
    defaultHeight: 512,
    defaultSteps: 20,
    outputDir: './assets/images',
  }),
  context: z.object({
    maxTokens: z.number().int().positive().default(128000),
    summarizeAt: z.number().min(0).max(1).default(0.8),
    includeGitDiff: z.boolean().default(true),
    includeIndex: z.boolean().default(true),
  }).default({
    maxTokens: 128000,
    summarizeAt: 0.8,
    includeGitDiff: true,
    includeIndex: true,
  }),
  indexing: z.object({
    enabled: z.boolean().default(true),
    watch: z.boolean().default(true),
    languages: z.array(z.string()).default(['typescript', 'python', 'go', 'rust']),
    exclude: z.array(z.string()).default(['node_modules', 'dist', 'build', '.git', 'target']),
  }).default({
    enabled: true,
    watch: true,
    languages: ['typescript', 'python', 'go', 'rust'],
    exclude: ['node_modules', 'dist', 'build', '.git', 'target'],
  }),
  updateCheck: z.boolean().default(true),
  session: z.object({
    autoSave: z.boolean().default(true),
    exportJsonl: z.boolean().default(true),
    maxHistoryTurns: z.number().int().positive().default(200),
  }).default({
    autoSave: true,
    exportJsonl: true,
    maxHistoryTurns: 200,
  }),
  ui: z.object({
    streaming: z.boolean().default(true),
    showTokens: z.boolean().default(true),
    showCost: z.boolean().default(true),
    diffStyle: z.enum(['unified', 'side-by-side']).default('unified'),
    theme: z.enum(['dark', 'light', 'auto']).default('dark'),
    tui: z.boolean().default(false),
    compactMode: z.boolean().default(true),
    collapseCommentary: z.boolean().default(true),
    spinner: z.enum(['braille', 'tracker', 'aurora']).default('braille'),
  }).default({
    streaming: true,
    showTokens: true,
    showCost: true,
    diffStyle: 'unified',
    theme: 'dark',
    tui: false,
    compactMode: true,
    collapseCommentary: true,
    spinner: 'braille',
  }),
  safety: z.object({
    protectGit: z.boolean().default(true),
    autoApprove: z.boolean().default(false),
    autoApprovePlans: z.boolean().default(false),
  }).default({
    protectGit: true,
    autoApprove: false,
    autoApprovePlans: false,
  }),
  git: z.object({
    // When true, single-agent mode branches from the detected base branch
    // (main/master) at the start of a task, so work never piles onto a stale
    // branch. Toggle via /gitautobranch. No auto-merge in interactive mode —
    // the user merges the work branch back when ready.
    autoBranchFromBase: z.boolean().default(false),
  }).default({
    autoBranchFromBase: false,
  }),
  security: z.object({
    // Mask detected credentials in terminal output, model context, JSONL
    // export, and session memory.
    redactSecrets: z.boolean().default(true),
    // Block commits that would introduce a credential into the staged diff.
    preCommitGuard: z.boolean().default(true),
  }).default({
    redactSecrets: true,
    preCommitGuard: true,
  }),
});

export type DaedalusConfig = z.infer<typeof ConfigSchema>;
export const DEFAULT_CONFIG: DaedalusConfig = {
  version: 1,
  router: {
    strategy: 'priority',
    chain: [
      // FreeLLMAPI - local proxy on port 3001
      { name: 'freellmapi', endpoint: 'http://127.0.0.1:3001/v1', model: 'auto', priority: 0, enabled: true, supportsVision: true, supportsTools: true, tier: 'intelligence' },
      // LM Studio with gemma-4-e4b - vision-capable local fallback
      { name: 'lmstudio-gemma', endpoint: 'http://127.0.0.1:1234/v1', model: 'google/gemma-4-e4b', priority: 1, enabled: true, supportsVision: true, supportsTools: true, tier: 'intelligence' },
    ],
    healthCheckInterval: 30000,
    requestTimeout: 120000,
    slowModelThresholdMs: 45000,
    blacklistTtlMs: 600000,
    blacklistPersist: true,
    defaultRateLimit: { rpm: 60, tpm: 100000 },
    autoEscalate: true,
    complexityRouting: true,
    proxyUrl: undefined,
  },
  agents: {
    default: 'coder',
    available: ['orchestrator', 'planner', 'coder', 'reviewer', 'debugger', 'researcher'],
    autoOrchestrate: true,
    ensemble: {
      enabled: false,
      draftModel: 'auto',
      criticModel: 'auto',
      maxLoops: 2,
      candidatesCount: 2,
    },
  },
  tools: {
    builtin: [
      'read_file', 'write_file', 'patch', 'search_files', 'list_files',
      'terminal', 'git_diff', 'git_status', 'todo', 'delegate_task',
      'web_search', 'fetch_url', 'index_codebase', 'find_symbol',
      'get_definition', 'get_references', 'generate_image',
      'handoff_task', 'set_context_variable'
    ],
    mcpServers: {},
    permissions: { terminal: 'auto', files: 'auto' },
    sandbox: 'none',
    sandboxImage: 'node:20',
  },
  imageGen: {
    enabled: true,
    provider: 'auto',
    endpoint: 'http://127.0.0.1:7860',
    defaultWidth: 512,
    defaultHeight: 512,
    defaultSteps: 20,
    outputDir: './assets/images',
  },
  context: {
    maxTokens: 128000,
    summarizeAt: 0.8,
    includeGitDiff: true,
    includeIndex: true,
  },
  indexing: {
    enabled: true,
    watch: true,
    languages: ['typescript', 'python', 'go', 'rust'],
    exclude: ['node_modules', 'dist', 'build', '.git', 'target'],
  },
  updateCheck: true,
  session: {
    autoSave: true,
    exportJsonl: true,
    maxHistoryTurns: 200,
  },
  ui: {
    streaming: true,
    showTokens: true,
    showCost: true,
    diffStyle: 'unified',
    theme: 'dark',
    tui: false,
    compactMode: true,
    collapseCommentary: true,
    spinner: 'braille',
  },
  safety: {
    protectGit: true,
    autoApprove: false,
    autoApprovePlans: false,
  },
  git: {
    autoBranchFromBase: false,
  },
  security: {
    redactSecrets: true,
    preCommitGuard: true,
  },
};

function getConfigDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, '.daedalus');
}

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

export function toMinimalConfig(config: DaedalusConfig): Record<string, unknown> {
  const minimal: Record<string, unknown> = {
    version: config.version,
    router: {
      strategy: config.router.strategy,
      chain: config.router.chain,
      autoEscalate: config.router.autoEscalate === DEFAULT_CONFIG.router.autoEscalate ? undefined : config.router.autoEscalate,
      complexityRouting: config.router.complexityRouting === DEFAULT_CONFIG.router.complexityRouting ? undefined : config.router.complexityRouting,
    },
  };

  // Clean undefined properties inside router
  const routerClean = Object.fromEntries(
    Object.entries(minimal.router as Record<string, unknown>).filter(([, v]) => v !== undefined)
  );
  minimal.router = routerClean;

  if (config.modelOverride) {
    minimal.modelOverride = config.modelOverride;
  }

  // Include non-default settings only if user explicitly changed them
  if (JSON.stringify(config.agents) !== JSON.stringify(DEFAULT_CONFIG.agents)) {
    minimal.agents = config.agents;
  }
  if (JSON.stringify(config.tools) !== JSON.stringify(DEFAULT_CONFIG.tools)) {
    minimal.tools = config.tools;
  }
  if (JSON.stringify(config.context) !== JSON.stringify(DEFAULT_CONFIG.context)) {
    minimal.context = config.context;
  }
  if (JSON.stringify(config.ui) !== JSON.stringify(DEFAULT_CONFIG.ui)) {
    minimal.ui = config.ui;
  }
  if (JSON.stringify(config.indexing) !== JSON.stringify(DEFAULT_CONFIG.indexing)) {
    minimal.indexing = config.indexing;
  }

  return minimal;
}

export function generateExampleConfigJsonc(configDir: string): void {
  const examplePath = path.join(configDir, 'config.example.jsonc');
  const exampleContent = `// Daedalus Configuration Reference & Examples (~/.daedalus/config.json)
// Edit your active config.json or use slash commands like /preset and /model in the CLI.

{
  "version": 1,

  // ── MODEL ROUTER & BACKEND CHAINS ──
  "router": {
    // Routing strategy: "priority" (default), "round-robin", or "fastest"
    "strategy": "priority",

    // Enable dynamic task complexity classification (trivial -> fast, heavy -> intelligence)
    "complexityRouting": true,

    // Auto-escalate to stronger models upon repeated tool errors
    "autoEscalate": true,

    // Router model chain list (tried in order)
    "chain": [
      // Example 1: Local LM Studio (Free)
      {
        "name": "lmstudio-gemma",
        "endpoint": "http://127.0.0.1:1234/v1",
        "model": "google/gemma-4-e4b",
        "priority": 0,
        "enabled": true,
        "supportsTools": true,
        "tier": "intelligence"
      },
      // Example 2: Local Ollama (Free)
      {
        "name": "ollama-qwen",
        "endpoint": "http://127.0.0.1:11434/v1",
        "model": "qwen2.5-coder:7b",
        "priority": 1,
        "enabled": false,
        "supportsTools": true,
        "tier": "fast"
      },
      // Example 3: OpenAI API (Bring Your Own Key)
      {
        "name": "openai-gpt4",
        "endpoint": "https://api.openai.com/v1",
        "apiKey": "sk-proj-YOUR_API_KEY_HERE",
        "model": "gpt-4o",
        "priority": 2,
        "enabled": false,
        "supportsTools": true,
        "provider": "openai",
        "tier": "intelligence"
      }
    ]
  },

  // ── CLI & UI PREFERENCES ──
  "ui": {
    "theme": "dark",
    "compactMode": true,
    "spinner": "braille"
  }
}
`;

  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(examplePath, exampleContent, 'utf8');
  } catch { /* best effort */ }
}

export function loadConfig(): DaedalusConfig {
  const configPath = getConfigPath();
  
  if (!fs.existsSync(configPath)) {
    // Create default config
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(content);
    return ConfigSchema.parse(parsed);
  } catch (err) {
    logger.error('\n[WARN] Failed to load config file:');
    logger.error(`  ${(err instanceof Error ? err.message : String(err))}`);
    logger.error('  Falling back to defaults. Edit ~/.daedalus/config.json or run /onboard');
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: DaedalusConfig): void {
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  const minimal = toMinimalConfig(config);
  fs.writeFileSync(configPath, JSON.stringify(minimal, null, 2), 'utf8');
  generateExampleConfigJsonc(configDir);

  // Restrict permissions on non-Windows — only owner can read
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(configPath, 0o600);
    } catch { /* best-effort */ }
  }
}

export function getConfigDirPath(): string {
  return getConfigDir();
}

export function resetConfig(): DaedalusConfig {
  saveConfig(DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}

// Auto-discover local servers and suggest configs
export async function discoverLocalServers(): Promise<Array<{ name: string; endpoint: string; models: string[] }>> {
  const candidates = [
    { name: 'FreeLLMAPI', url: 'http://localhost:3001/v1/models', endpoint: 'http://localhost:3001/v1' },
    { name: 'FreeLLMAPI (Dev)', url: 'http://localhost:5173/v1/models', endpoint: 'http://localhost:5173/v1' },
    { name: 'LM Studio', url: 'http://localhost:1234/v1/models', endpoint: 'http://localhost:1234/v1' },
    { name: 'Ollama', url: 'http://localhost:11434/api/tags', endpoint: 'http://localhost:11434/v1' },
    { name: 'llama.cpp', url: 'http://localhost:8080/v1/models', endpoint: 'http://localhost:8080/v1' },
    { name: 'vLLM', url: 'http://localhost:8000/v1/models', endpoint: 'http://localhost:8000/v1' },
  ];
  
  const results = [];
  
  for (const c of candidates) {
    try {
      const res = await fetch(c.url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data: Record<string, unknown> = (await res.json()) as Record<string, unknown>;
        let models: string[] = [];
        
        if (c.name === 'Ollama') {
          models = (data.models as Array<{ name?: string }> | undefined)
            ?.map((m) => m.name?.trim() || '')
            .filter((name) => name.length > 0) || [];
        } else {
          models = (data.data as Array<{ id?: string }> | undefined)
            ?.map((m) => m.id?.trim() || '')
            .filter((id) => id.length > 0) || [];
        }
        
        if (models.length > 0) {
          results.push({ name: c.name.toLowerCase(), endpoint: c.endpoint, models });
        }
      }
    } catch { /* not running */ }
  }
  
  return results;
}