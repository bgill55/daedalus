// Daedalus Built-in Configuration Presets

import type { DaedalusConfig } from './index.js';
import type { ModelEntry } from '../router/types.js';

export interface ConfigPreset {
  id: string;
  name: string;
  description: string;
  chain: ModelEntry[];
  overrides?: Partial<DaedalusConfig>;
}

export const PRESETS: Record<string, ConfigPreset> = {
  'local-free': {
    id: 'local-free',
    name: 'Local Free-Tier (Default)',
    description: 'Connects to FreeLLM API or local LM Studio / Ollama with zero token fees.',
    chain: [
      {
        name: 'freellmapi',
        endpoint: 'http://127.0.0.1:3001/v1',
        model: 'auto',
        priority: 0,
        enabled: true,
        supportsVision: true,
        supportsTools: true,
        tier: 'intelligence',
      },
      {
        name: 'lmstudio-gemma',
        endpoint: 'http://127.0.0.1:1234/v1',
        model: 'google/gemma-4-e4b',
        priority: 1,
        enabled: true,
        supportsVision: true,
        supportsTools: true,
        tier: 'intelligence',
      },
    ],
  },
  'cloud-power': {
    id: 'cloud-power',
    name: 'Cloud Power (BYOK)',
    description: 'High-intelligence cloud API setup using OpenAI, Anthropic, or OpenRouter.',
    chain: [
      {
        name: 'openai-gpt4',
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        priority: 0,
        enabled: true,
        supportsVision: true,
        supportsTools: true,
        tier: 'intelligence',
        provider: 'openai',
      },
      {
        name: 'openrouter-fallback',
        endpoint: 'https://openrouter.ai/api/v1',
        model: 'anthropic/claude-3.5-sonnet',
        priority: 1,
        enabled: true,
        supportsVision: true,
        supportsTools: true,
        tier: 'intelligence',
        provider: 'openrouter',
      },
    ],
  },
  'hybrid': {
    id: 'hybrid',
    name: 'Hybrid (Local Fast + Cloud Intelligence)',
    description: 'Uses fast local models for simple tasks and escalates to cloud APIs for complex refactoring.',
    chain: [
      {
        name: 'local-fast',
        endpoint: 'http://127.0.0.1:11434/v1',
        model: 'qwen2.5-coder:7b',
        priority: 0,
        enabled: true,
        supportsVision: false,
        supportsTools: true,
        tier: 'fast',
        provider: 'custom',
      },
      {
        name: 'openai-intelligence',
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        priority: 1,
        enabled: true,
        supportsVision: true,
        supportsTools: true,
        tier: 'intelligence',
        provider: 'openai',
      },
    ],
    overrides: {
      router: {
        complexityRouting: true,
        autoEscalate: true,
        strategy: 'priority',
        chain: [],
        healthCheckInterval: 30000,
        requestTimeout: 120000,
        slowModelThresholdMs: 45000,
        blacklistTtlMs: 600000,
        blacklistPersist: true,
        defaultRateLimit: { rpm: 60, tpm: 100000 },
      },
    },
  },
  'privacy-strict': {
    id: 'privacy-strict',
    name: 'Privacy Strict (100% Offline)',
    description: 'Strictly local LLM execution with web tools and cloud fallbacks disabled.',
    chain: [
      {
        name: 'local-lmstudio',
        endpoint: 'http://127.0.0.1:1234/v1',
        model: 'auto',
        priority: 0,
        enabled: true,
        supportsVision: true,
        supportsTools: true,
        tier: 'intelligence',
        provider: 'custom',
      },
    ],
    overrides: {
      tools: {
        builtin: [
          'read_file', 'write_file', 'patch', 'search_files', 'list_files',
          'terminal', 'git_diff', 'git_status', 'todo', 'delegate_task',
          'index_codebase', 'find_symbol', 'get_definition', 'get_references',
        ],
        mcpServers: {},
        permissions: { terminal: 'auto', files: 'auto' },
        sandbox: 'none',
        sandboxImage: 'node:20',
      },
    },
  },
};

export function getPreset(id: string): ConfigPreset | undefined {
  return PRESETS[id.toLowerCase().trim()];
}

export function applyPreset(currentConfig: DaedalusConfig, presetId: string): DaedalusConfig {
  const preset = getPreset(presetId);
  if (!preset) {
    throw new Error(`Unknown preset: "${presetId}". Available presets: ${Object.keys(PRESETS).join(', ')}`);
  }

  const updated: DaedalusConfig = {
    ...currentConfig,
    router: {
      ...currentConfig.router,
      chain: [...preset.chain],
      ...(preset.overrides?.router || {}),
    },
    ...(preset.overrides || {}),
  };

  return updated;
}
