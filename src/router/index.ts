// Daedalus Local Router - Main routing logic

import { OpenAI } from 'openai';
import { 
  ModelEntry, 
  ModelHealth, 
  RouterConfig, 
  RouteResult, 
  ChatRequest, 
  ChatResponse, 
  StreamChunk 
} from './types.js';

export { RouteResult, RouterConfig };
import { createTokenBucket, consumeTokens, getWaitTime } from './rate-limiter.js';
import { checkModelHealth, getCachedHealth, markHealthy, markUnhealthy } from './health.js';

export class LocalRouter {
  private config: RouterConfig;
  private clients: Map<string, OpenAI> = new Map();
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private rateLimiters: Map<string, ReturnType<typeof createTokenBucket>> = new Map();
  private roundRobinIndex = 0;
  private discoveredModels: Map<string, string> = new Map(); // endpoint key -> model id

  constructor(config: RouterConfig) {
    this.config = config;
    this.initializeRateLimiters();
  }

  private initializeRateLimiters(): void {
    for (const model of this.config.chain) {
      if (model.enabled) {
        const key = `${model.endpoint}|${model.model}`;
        // Use TPM as capacity if configured, otherwise estimate from RPM (~4K tokens per request)
        const tpm = this.config.defaultRateLimit.tpm || model.maxTokens || this.config.defaultRateLimit.rpm * 4000;
        this.rateLimiters.set(key, createTokenBucket(tpm, tpm / 60));
      }
    }
  }

  private getOrCreateClient(model: ModelEntry): OpenAI {
    const key = `${model.endpoint}|${model.model}`;
    let client = this.clients.get(key);
    
    if (!client) {
      client = new OpenAI({
        baseURL: model.endpoint,
        apiKey: model.apiKey || 'not-needed', // Use apiKey from config if provided
        timeout: this.config.requestTimeout,
      });
      this.clients.set(key, client);
    }
    return client;
  }

  async startHealthChecks(): Promise<void> {
    // Initial health check
    this.runHealthChecks().catch(() => {});
    
    // Periodic health checks
    this.healthCheckTimer = setInterval(() => {
      this.runHealthChecks();
    }, this.config.healthCheckInterval);
  }

  async stopHealthChecks(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private async runHealthChecks(): Promise<void> {
    const enabledModels = this.config.chain.filter(m => m.enabled);
    await Promise.all(enabledModels.map(m => checkModelHealth(m, 5000)));
  }

  getEnabledModels(): ModelEntry[] {
    return this.config.chain.filter(m => m.enabled);
  }

  getHealthyModels(): ModelEntry[] {
    const enabled = this.getEnabledModels();
    return enabled.filter(m => {
      const health = getCachedHealth(m);
      return health?.healthy !== false; // Unknown = assume healthy
    });
  }

  async route(request: ChatRequest): Promise<RouteResult> {
    const healthyModels = this.getHealthyModels();
    
    if (healthyModels.length === 0) {
      throw new Error('No healthy models available. Check your local servers (LM Studio, Ollama, etc.)');
    }

    let selectedModel: ModelEntry | undefined;

    if (request.model && request.model !== 'auto') {
      selectedModel = healthyModels.find(m => m.name === request.model || m.model === request.model);
    }

    if (!selectedModel) {
      switch (this.config.strategy) {
        case 'priority':
          selectedModel = [...healthyModels].sort((a, b) => a.priority - b.priority)[0];
          break;
          
        case 'round-robin':
          selectedModel = healthyModels[this.roundRobinIndex % healthyModels.length];
          this.roundRobinIndex++;
          break;
          
        case 'fastest':
          selectedModel = [...healthyModels].sort((a, b) => {
            const ha = getCachedHealth(a);
            const hb = getCachedHealth(b);
            return (ha?.latencyMs ?? Infinity) - (hb?.latencyMs ?? Infinity);
          })[0];
          break;
          
        default:
          selectedModel = healthyModels[0];
      }
    }

    // Check rate limit
    const rateLimiter = this.rateLimiters.get(`${selectedModel.endpoint}|${selectedModel.model}`);
    if (rateLimiter) {
      const estimatedTokens = this.estimateTokens(request);
      if (!consumeTokens(rateLimiter, estimatedTokens)) {
        const waitMs = getWaitTime(rateLimiter, estimatedTokens);
        throw new Error(`Rate limited. Wait ${waitMs}ms or try another model.`);
      }
    }

    const health = getCachedHealth(selectedModel) ?? { healthy: true, lastCheck: Date.now(), consecutiveFailures: 0 };
    return { model: selectedModel, health };
  }

  private estimateTokens(request: ChatRequest): number {
    let totalChars = 0;
    for (const msg of request.messages) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            totalChars += (part.text || '').length;
          } else if (part.type === 'image_url') {
            // Images cost ~85-2000 tokens depending on resolution.
            // Overestimate at 2000 tokens to stay safe on rate limits.
            totalChars += 8000;
          }
        }
      } else {
        totalChars += JSON.stringify(msg).length;
      }
    }
    // Rough estimate: 4 chars per token
    return Math.ceil(totalChars / 4) + (request.max_tokens ?? 4096);
  }

  async chatCompletion(request: ChatRequest): Promise<ChatResponse> {
    const { model } = await this.route(request);
    const client = this.getOrCreateClient(model);
    const key = `${model.endpoint}|${model.model}`;

    const actualModel = model.model === 'auto'
      ? await this.discoverModel(client, key)
      : model.model;
    
    try {
      const start = Date.now();
      const response = await client.chat.completions.create({
        ...request,
        model: actualModel,
      }) as ChatResponse;
      
      markHealthy(model, Date.now() - start);
      return response;
    } catch (err: any) {
      markUnhealthy(model, err.message);
      throw err;
    }
  }

  async *chatStream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const { model } = await this.route(request);
    const client = this.getOrCreateClient(model);
    const key = `${model.endpoint}|${model.model}`;

    const actualModel = model.model === 'auto'
      ? await this.discoverModel(client, key)
      : model.model;
    
    try {
      const start = Date.now();
      const stream = await client.chat.completions.create({
        ...request,
        model: actualModel,
        stream: true,
      });

      for await (const chunk of stream) {
        yield chunk as StreamChunk;
      }
      
      markHealthy(model, Date.now() - start);
    } catch (err: any) {
      markUnhealthy(model, err.message);
      throw err;
    }
  }

  private async discoverModel(client: OpenAI, cacheKey: string): Promise<string> {
    const cached = this.discoveredModels.get(cacheKey);
    if (cached) return cached;
    try {
      const models = await client.models.list();
      if (models.data.length > 0) {
        const id = models.data[0].id;
        this.discoveredModels.set(cacheKey, id);
        return id;
      }
    } catch { /* ignore — will throw below */ }
    throw new Error(
      `No models found at ${cacheKey.split('|')[0]}. ` +
      `Ensure your local server (LM Studio, Ollama, etc.) is running and has at least one model loaded.`
    );
  }

  async listModels(): Promise<string[]> {
    const models: string[] = [];
    for (const entry of this.getEnabledModels()) {
      try {
        const client = this.getOrCreateClient(entry);
        const list = await client.models.list();
        for (const m of list.data) {
          models.push(`${entry.name}:${m.id}`);
        }
      } catch { /* ignore */ }
    }
    return models;
  }

  getConfig(): RouterConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<RouterConfig>): void {
    this.config = { ...this.config, ...config };
    this.initializeRateLimiters();
  }

  // OpenAI-compatible interface for delegation tool
  get chat() {
    return {
      completions: {
        create: (request: ChatRequest) => this.chatCompletion(request),
      },
    };
  }
}

function isLocalEndpoint(endpoint: string): boolean {
  try {
    const hostname = new URL(endpoint).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0';
  } catch {
    return false;
  }
}

// Factory function for easy creation
export function createRouter(config: Partial<RouterConfig> = {}): LocalRouter {
  const defaultConfig: RouterConfig = {
    strategy: 'priority',
    chain: [],
    healthCheckInterval: 30000,
    requestTimeout: 120000,
    defaultRateLimit: { rpm: 60, tpm: 100000 },
    ...config,
  };
  return new LocalRouter(defaultConfig);
}