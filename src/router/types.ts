// Daedalus Local Router Types

import type { RouteSkip } from '../types.js';

export interface ModelEntry {
  name: string;                 // Human-readable name (e.g., "lmstudio-qwen")
  endpoint: string;             // Base URL (e.g., "http://localhost:1234/v1")
  model: string;                // Model ID (e.g., "qwen2.5-coder-32b" or "auto")
  priority: number;             // Lower = higher priority
  enabled: boolean;
  apiKey?: string;              // Optional API key for remote providers
  provider?: 'openai' | 'anthropic' | 'google' | 'openrouter' | 'freellmapi' | 'custom';  // BYOK provider tag for smart defaults
  maxTokens?: number;           // Context window (optional, for auto-detection)
  supportsTools?: boolean;      // Whether model supports tool calling
  supportsVision?: boolean;     // Whether model supports vision
  tier?: 'standard' | 'fast' | 'intelligence';
}

export interface ModelHealth {
  healthy: boolean;
  lastCheck: number;
  latencyMs?: number;
  error?: string;
  consecutiveFailures: number;
}

export interface TokenBucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillRate: number; // tokens per second
}

export interface RouteResult {
  model: ModelEntry;
  health: ModelHealth;
  reason: string;
  skipped: RouteSkip[];
}

export type TaskComplexity = 'simple' | 'standard' | 'complex';

export interface RouterConfig {
  strategy: 'priority' | 'round-robin' | 'fastest';
  chain: ModelEntry[];
  healthCheckInterval: number;  // ms
  requestTimeout: number;       // ms
  slowModelThresholdMs?: number; // ms; models whose EMA latency exceeds this are blacklisted (0 = disabled)
  blacklistTtlMs?: number;      // ms; how long a blacklisted model stays excluded before decaying back in (default 10m)
  blacklistPersist?: boolean;   // persist blacklist to SQLite across restarts (default true)
  defaultRateLimit: {
    rpm: number;  // requests per minute
    tpm: number;  // tokens per minute
  };
  autoEscalate?: boolean;  // switch to the next chain model after repeated tool failures
}

export interface ChatRequest {
  model?: string;
  complexity?: TaskComplexity;
  messages: any[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: any[];
  tool_choice?: any;
  signal?: AbortSignal;
  [key: string]: any;
}

export interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: any;
    finish_reason: string | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: any[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}