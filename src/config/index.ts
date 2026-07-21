// Daedalus configuration

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

export const ModelEntrySchema = z.object({
  name: z.string(),
  endpoint: z.string().refine(v => /^https?:\/\//i.test(v) || /^[a-zA-Z0-9.-]+:\d+/.test(v), {
    message: 'endpoint must be a URL (http://...) or host:port',
  }),
  model: z.string(),
  priority: z.number().int().min(0),
  enabled: z.boolean(),
  apiKey: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  supportsTools: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  tier: z.enum(['standard', 'fast', 'intelligence']).default('standard').optional(),
});

export const RouterConfigSchema = z.object({
  strategy: z.enum(['priority', 'round-robin', 'fastest']).default('priority'),
  chain: z.array(ModelEntrySchema).default([]),
  healthCheckInterval: z.number().int().positive().default(30000),
  requestTimeout: z.number().int().positive().default(120000),
  defaultRateLimit: z.object({
    rpm: z.number().int().positive().default(60),
    tpm: z.number().int().positive().default(100000),
  }).default({ rpm: 60, tpm: 100000 }),
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
      'get_definition', 'get_references', 'generate_image'
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
  }).default({
    streaming: true,
    showTokens: true,
    showCost: true,
    diffStyle: 'unified',
    theme: 'dark',
    tui: false,
  }),
  safety: z.object({
    protectGit: z.boolean().default(true),
    autoApprove: z.boolean().default(false),
  }).default({
    protectGit: true,
    autoApprove: false,
  }),
});

export type DaedalusConfig = z.infer<typeof ConfigSchema>;

const DEFAULT_CONFIG: DaedalusConfig = {
  version: 1,
  router: {
    strategy: 'priority',
    chain: [
      { name: 'lmstudio-default', endpoint: 'http://localhost:1234/v1', model: 'auto', priority: 1, enabled: true },
      { name: 'ollama-default', endpoint: 'http://localhost:11434/v1', model: 'auto', priority: 2, enabled: true },
      { name: 'llamacpp-default', endpoint: 'http://localhost:8080/v1', model: 'auto', priority: 3, enabled: false },
      { name: 'vllm-default', endpoint: 'http://localhost:8000/v1', model: 'auto', priority: 4, enabled: false },
    ],
    healthCheckInterval: 30000,
    requestTimeout: 120000,
    defaultRateLimit: { rpm: 60, tpm: 100000 },
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
      'get_definition', 'get_references'
    ],
    mcpServers: {},
    sandbox: 'none',
    sandboxImage: 'node:20',
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
  },
  safety: {
    protectGit: true,
    autoApprove: false,
  },
};

function getConfigDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, '.daedalus');
}

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
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
  } catch (err: any) {
    console.error('\n[WARN] Failed to load config file:');
    console.error(`  ${err.message}`);
    console.error('  Falling back to defaults. Edit ~/.daedalus/config.json or run /onboard');
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: DaedalusConfig): void {
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

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
        const data: any = await res.json();
        let models: string[] = [];
        
        if (c.name === 'Ollama') {
          models = data.models?.map((m: any) => m.name) || [];
        } else {
          models = data.data?.map((m: any) => m.id) || [];
        }
        
        if (models.length > 0) {
          results.push({ name: c.name.toLowerCase(), endpoint: c.endpoint, models });
        }
      }
    } catch { /* not running */ }
  }
  
  return results;
}