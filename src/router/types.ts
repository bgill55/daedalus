// Daedalus Local Router Types

export interface ModelEntry {
  name: string;                 // Human-readable name (e.g., "lmstudio-qwen")
  endpoint: string;             // Base URL (e.g., "http://localhost:1234/v1")
  model: string;                // Model ID (e.g., "qwen2.5-coder-32b" or "auto")
  priority: number;             // Lower = higher priority
  enabled: boolean;
  apiKey?: string;              // Optional API key for remote providers
  maxTokens?: number;           // Context window (optional, for auto-detection)
  supportsTools?: boolean;      // Whether model supports tool calling
  supportsVision?: boolean;     // Whether model supports vision
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
}

export interface RouterConfig {
  strategy: 'priority' | 'round-robin' | 'fastest';
  chain: ModelEntry[];
  healthCheckInterval: number;  // ms
  requestTimeout: number;       // ms
  defaultRateLimit: {
    rpm: number;  // requests per minute
    tpm: number;  // tokens per minute
  };
}

export interface ChatRequest {
  model?: string;
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
}