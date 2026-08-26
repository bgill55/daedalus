// Daedalus Local Router - Main routing logic

import { OpenAI } from 'openai';
import { ProxyAgent } from 'undici';
import type { ChatCompletionMessageParam, ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import type { ChatMessage, ChatMessageContent, MessageContentPart } from '../types.js';
import type { 
  ModelEntry, 
  RouterConfig, 
  RouteResult, 
  ChatRequest, 
  ChatResponse, 
  StreamChunk 
} from './types.js';
import type { RouteSkip } from '../types.js';

export type { RouteResult, RouterConfig, ChatResponse };
import { createTokenBucket, consumeTokens, getWaitTime } from './rate-limiter.js';
import { checkModelHealth, getCachedHealth, getEndpointCatalog, markHealthy, markUnhealthy } from './health.js';
import { logRouteDecision } from './routing-logger.js';
import { BlacklistStore } from './blacklist-store.js';

function isHardFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not in the catalog/i.test(msg)) return true;
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError')) return true;
  if (err instanceof Error && err.name === 'APIConnectionTimeoutError') return true;
  if (/timeout|timed out|timedout/i.test(msg)) return true;
  const status = (err as { status?: number; statusCode?: number })?.status
    ?? (err as { status?: number; statusCode?: number })?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) return true;
  return false;
}

// Upstream rejected the request because the specific model name is gone
// (provider disabled / removed / renamed it) rather than a problem with the
// prompt. When this happens the pinned model can never succeed, so the router
// should drop the pin and fall back to other enabled models instead of looping
// on the dead one. (Distinct from a generic 400 like malformed input.)
// Exported for unit testing.
export function isModelUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /(model|models?).{0,40}(disabled|not (found|available|in the catalog)|does not exist|no longer available|deprecated|unknown model)/i.test(msg)
    || /(disabled|not (found|available)|does not exist|no longer available|deprecated|unknown model)/i.test(msg);
}

export class LocalRouter {
  private config: RouterConfig;
  private clients: Map<string, OpenAI> = new Map();
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private rateLimiters: Map<string, ReturnType<typeof createTokenBucket>> = new Map();
  private roundRobinIndex = 0;
  private discoveredModels: Map<string, string> = new Map(); // endpoint key -> model id
  public lastRoutedModel?: string;
  public lastRoutedModelName?: string;
  public lastRoutedTier?: string;
  public lastRouteDecision?: { model: ModelEntry; reason: string; skipped: Array<{ endpoint: string; model: string; reason: string }> };
  private routeStats = { fast: 0, standard: 0, complex: 0, override: 0 };
  private sessionBlacklist!: BlacklistStore;
  private latencyEma = new Map<string, number>();
  private readonly slowAlpha = 0.3;

  constructor(config: RouterConfig) {
    this.config = config;
    this.sessionBlacklist = new BlacklistStore({
      ttlMs: this.config.blacklistTtlMs,
      enabled: this.config.blacklistPersist !== false,
    });
    this.initializeRateLimiters();
  }

  reloadConfig(config: RouterConfig): void {
    this.config = config;
    this.clients.clear();
    this.initializeRateLimiters();
  }

  getSessionBlacklist(): Array<{ endpoint: string; model: string; reason: string; at: number }> {
    return this.sessionBlacklist.list().map(e => ({
      endpoint: e.endpoint,
      model: e.model,
      reason: e.reason,
      at: e.at,
    }));
  }

  getLastRouteDecision(): typeof this.lastRouteDecision {
    return this.lastRouteDecision;
  }

  private recordRoutingDecision(model: ModelEntry, reason: string, skipped: RouteSkip[]): void {
    this.lastRouteDecision = { model, reason, skipped: skipped.map(s => ({ ...s })) };
    logRouteDecision({
      ts: new Date().toISOString(),
      model: model.name,
      endpoint: model.endpoint,
      modelId: model.model,
      reason,
      skipped: skipped.map(s => ({ model: s.model, endpoint: s.endpoint, reason: s.reason })),
    });
  }

  getLatencyEma(): Array<{ endpoint: string; model: string; emaMs: number; thresholdMs: number }> {
    const threshold = this.config.slowModelThresholdMs ?? 0;
    return Array.from(this.latencyEma.entries()).map(([key, ema]) => {
      const [endpoint, model] = key.split('|');
      return { endpoint, model, emaMs: Math.round(ema), thresholdMs: threshold };
    });
  }

  clearSessionBlacklist(): void {
    this.sessionBlacklist.clear();
  }

  addToSessionBlacklist(endpoint: string, model: string, reason: string): void {
    const entry = this.config.chain.find(m => m.endpoint === endpoint && m.model === model);
    if (entry) {
      this.blacklistModel(entry, reason);
    } else {
      this.sessionBlacklist.add(endpoint, model, reason);
      markUnhealthy({ endpoint, model } as ModelEntry, reason);
    }
  }

  private blacklistModel(m: ModelEntry, reason: string): void {
    this.sessionBlacklist.add(m.endpoint, m.model, reason);
    markUnhealthy(m, reason);
  }

  private isBlacklisted(m: ModelEntry): boolean {
    const key = `${m.endpoint}|${m.model}`;
    const { blacklisted, expiredNow } = this.sessionBlacklist.isBlacklisted(m.endpoint, m.model);
    if (expiredNow) {
      // Decay: a previously blacklisted model came back after its TTL, so
      // reset its latency baseline to get a fresh measurement.
      this.latencyEma.delete(key);
    }
    return blacklisted;
  }

  private recordLatency(m: ModelEntry, latencyMs: number): void {
    const threshold = this.config.slowModelThresholdMs ?? 0;
    if (threshold <= 0 || this.isBlacklisted(m)) return;
    const key = `${m.endpoint}|${m.model}`;
    const prev = this.latencyEma.get(key) ?? latencyMs;
    const ema = prev + this.slowAlpha * (latencyMs - prev);
    this.latencyEma.set(key, ema);
    if (ema > threshold) {
      this.blacklistModel(m, `Avg latency ${Math.round(ema)}ms exceeds threshold ${threshold}ms`);
    }
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
      const proxyUrl = this.config.proxyUrl
        ?? process.env.HTTPS_PROXY
        ?? process.env.https_proxy
        ?? process.env.HTTP_PROXY
        ?? process.env.http_proxy;
      const clientOpts: ConstructorParameters<typeof OpenAI>[0] = {
        baseURL: model.endpoint,
        apiKey: model.apiKey || 'not-needed', // Use apiKey from config if provided
        timeout: this.config.requestTimeout,
      };
      if (proxyUrl) {
        try {
          // Scoped proxy: only this HTTP client's fetches go through it. The
          // agent's terminal/sandbox traffic is unaffected. OneCLI gateway /
          // corporate proxy support requires the operator to set it deliberately.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          clientOpts.fetch = ((input: any, init?: any) =>
            fetch(input, { ...init, dispatcher: new ProxyAgent(proxyUrl) } as any)) as any;
        } catch {
          console.warn('[WARN] proxy configured but undici ProxyAgent unavailable; requests will bypass the proxy.');
        }
      }
      client = new OpenAI(clientOpts);
      this.clients.set(key, client);
    }
    return client;
  }

  async startHealthChecks(): Promise<void> {
    let running = false;

    const run = async () => {
      if (running) return;
      running = true;
      try {
        await this.runHealthChecks();
      } catch (err) {
        console.error('Health check failed:', (err as Error).message);
      } finally {
        running = false;
      }
    };

    await run();
    this.healthCheckTimer = setInterval(run, this.config.healthCheckInterval);
  }

  async stopHealthChecks(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  async runHealthChecks(): Promise<void> {
    const enabledModels = this.config.chain.filter(m => m.enabled);
    const uniqueEndpoints = new Map<string, ModelEntry>();
    for (const m of enabledModels) {
      if (!uniqueEndpoints.has(m.endpoint)) {
        uniqueEndpoints.set(m.endpoint, m);
      }
    }
    await Promise.all(
      Array.from(uniqueEndpoints.values()).map(async (m) => {
        const health = await checkModelHealth(m, 5000);
        const catalog = await getEndpointCatalog(m.endpoint, m.apiKey);
        const endpointDown = !health.healthy && !/not in the catalog/i.test(health.error ?? '');
        for (const target of enabledModels.filter(e => e.endpoint === m.endpoint)) {
          if (this.isBlacklisted(target)) continue;
          if (endpointDown) {
            markUnhealthy(target, health.error ?? 'unhealthy');
            continue;
          }
          if (target.model !== 'auto' && catalog && !catalog.has(target.model)) {
            markUnhealthy(target, `Model '${target.model}' is not in the catalog served by this endpoint`);
          } else {
            markHealthy(target, health.latencyMs ?? 0);
          }
        }
      })
    );
  }

  getEnabledModels(): ModelEntry[] {
    return this.config.chain.filter(m => m.enabled);
  }

  getHealthyModels(): ModelEntry[] {
    const enabled = this.getEnabledModels();
    return enabled.filter(m => {
      const health = getCachedHealth(m);
      // Local endpoints are assumed healthy until proven otherwise
      if (!health && isLocalEndpoint(m.endpoint)) {
        return true;
      }
      return health?.healthy !== false; // Unknown = assume healthy for remote, but local is always healthy initially
    });
  }

  getNextModel(currentName: string): ModelEntry | undefined {
    const enabled = this.getEnabledModels();
    if (enabled.length < 2) return undefined;
    // Capability floor (minModel): never escalate to a model weaker than the floor.
    const floor = this.config.minModel ? enabled.find(m => m.name === this.config.minModel) : undefined;
    const idx = enabled.findIndex(m => m.name === currentName || m.model === currentName);
    const start = idx === -1 ? 0 : idx + 1;
    for (let i = 0; i < enabled.length - 1; i++) {
      const candidate = enabled[(start + i) % enabled.length];
      if (candidate.name === currentName || candidate.model === currentName) continue;
      if (candidate.supportsTools === false) continue;
      if (this.isBlacklisted(candidate)) continue;
      if (floor && candidate.priority > floor.priority) continue;
      const health = getCachedHealth(candidate);
      if (health?.healthy === false) continue;
      return candidate;
    }
    return undefined;
  }

  async route(request: ChatRequest, excludedModels?: Set<string>): Promise<RouteResult> {
    const skipped: Array<{ endpoint: string; model: string; reason: string }> = [];
    const noteSkipped = (m: ModelEntry, reason: string) => {
      if (!skipped.some(s => s.endpoint === m.endpoint && s.model === m.model && s.reason === reason)) {
        skipped.push({ endpoint: m.endpoint, model: m.model, reason });
      }
    };
    for (const m of this.getEnabledModels()) {
      if (this.isBlacklisted(m)) noteSkipped(m, 'session-blacklisted');
    }

    let healthyModels = this.getHealthyModels().filter(m => {
      if (this.isBlacklisted(m)) {
        noteSkipped(m, 'session-blacklisted');
        return false;
      }
      return true;
    });

    if (excludedModels && excludedModels.size > 0) {
      healthyModels = healthyModels.filter(m => {
        if (excludedModels.has(m.name) || excludedModels.has(m.model)) {
          noteSkipped(m, 'excluded-this-turn');
          return false;
        }
        return true;
      });
    }
    
    if (healthyModels.length === 0) {
      healthyModels = this.config.chain.filter(m => {
        if (m.enabled && !this.isBlacklisted(m) &&
          (!excludedModels || (!excludedModels.has(m.name) && !excludedModels.has(m.model)))) {
          return true;
        }
        if (m.enabled && this.isBlacklisted(m)) {
          noteSkipped(m, 'session-blacklisted');
        }
        return false;
      });
    }

    if (healthyModels.length === 0) {
      healthyModels = this.config.chain.filter(m => {
        if (m.enabled && (!excludedModels || (!excludedModels.has(m.name) && !excludedModels.has(m.model)))) {
          return true;
        }
        return false;
      });
    }

    if (healthyModels.length === 0) {
      throw new Error('No healthy models available. Check your local servers (LM Studio, Ollama, etc.)');
    }

    let selectedModel: ModelEntry | undefined;
    let candidateModels = healthyModels;

    if (request.model && request.model !== 'auto') {
      if (['intelligence', 'fast', 'standard'].includes(request.model)) {
        const tierModels = healthyModels.filter(m => m.tier === request.model);
        if (tierModels.length > 0) {
          candidateModels = tierModels;
        }
        request.model = 'auto';
      } else {
        const pinned = healthyModels.find(m => m.name === request.model || m.model === request.model) ||
                       this.config.chain.find(m => m.enabled && (m.name === request.model || m.model === request.model));
        if (!pinned) {
          throw new Error(`Requested model ${request.model} is not configured or enabled.`);
        }
        const pinnedExcluded = !!excludedModels && excludedModels.size > 0 &&
          (excludedModels.has(pinned.name) || excludedModels.has(pinned.model));
        if (!pinnedExcluded) {
          selectedModel = pinned;
          if (!isLocalEndpoint(selectedModel.endpoint)) {
            const rateLimiter = this.rateLimiters.get(`${selectedModel.endpoint}|${selectedModel.model}`);
            if (rateLimiter) {
              const estimatedTokens = this.estimateTokens(request);
              if (!consumeTokens(rateLimiter, estimatedTokens)) {
                const waitMs = getWaitTime(rateLimiter, estimatedTokens);
                throw new Error(`Rate limited. Wait ${waitMs}ms or try another model.`);
              }
            }
          }
          const health = getCachedHealth(selectedModel) ?? { healthy: true, lastCheck: Date.now(), consecutiveFailures: 0 };
          this.routeStats.override++;
          this.lastRoutedTier = selectedModel.tier;
          this.recordRoutingDecision(selectedModel, `model override '${request.model}'`, skipped);
          return { model: selectedModel, health, reason: `model override '${request.model}'`, skipped: skipped.map(s => ({ ...s })) };
        }
      }
    }

    const requiresTools = !!(request.tools && request.tools.length > 0);
    const hasImage = request.messages.some((msg: ChatMessage) =>
      Array.isArray(msg.content) && msg.content.some((c: MessageContentPart) => c.type === 'image_url')
    );
    const estimatedTokens = this.estimateTokens(request);
    const isComplexTask = requiresTools || estimatedTokens > 8000;

    if (hasImage) {
      const visionSupporting = candidateModels.filter(m => m.supportsVision);
      if (visionSupporting.length > 0) {
        candidateModels = visionSupporting;
      }
    }

    if (requiresTools) {
      const toolSupporting = candidateModels.filter(m => m.supportsTools);
      if (toolSupporting.length > 0) {
        candidateModels = toolSupporting;
      }
    }

    let tierFilteredModels: ModelEntry[];
    const complexity = request.complexity;
    const targetTier = complexity === 'simple' ? 'fast'
      : complexity === 'standard' ? 'standard'
      : complexity === 'complex' ? 'intelligence'
      : isComplexTask ? 'intelligence' : 'fast';

    if (targetTier === 'fast') {
      tierFilteredModels = candidateModels.filter(m => m.tier === 'fast');
      if (tierFilteredModels.length === 0) {
        tierFilteredModels = candidateModels.filter(m => m.tier === 'standard' || !m.tier);
      }
    } else if (targetTier === 'standard') {
      tierFilteredModels = candidateModels.filter(m => m.tier === 'standard' || !m.tier);
      if (tierFilteredModels.length === 0) {
        tierFilteredModels = candidateModels.filter(m => m.tier === 'intelligence');
      }
    } else {
      tierFilteredModels = candidateModels.filter(m => m.tier === 'intelligence');
      if (tierFilteredModels.length === 0) {
        tierFilteredModels = candidateModels.filter(m => m.tier === 'standard' || !m.tier);
      }
    }

    if (tierFilteredModels.length === 0) {
      tierFilteredModels = candidateModels;
    }

    let rankedCandidates: ModelEntry[];
    switch (this.config.strategy) {
      case 'priority':
        rankedCandidates = [...tierFilteredModels].sort((a, b) => a.priority - b.priority);
        break;
        
      case 'round-robin':
        rankedCandidates = [];
        for (let i = 0; i < tierFilteredModels.length; i++) {
          rankedCandidates.push(tierFilteredModels[(this.roundRobinIndex + i) % tierFilteredModels.length]);
        }
        break;
        
      case 'fastest':
        rankedCandidates = [...tierFilteredModels].sort((a, b) => {
          const ha = getCachedHealth(a);
          const hb = getCachedHealth(b);
          return (ha?.latencyMs ?? Infinity) - (hb?.latencyMs ?? Infinity);
        });
        break;
        
      default:
        rankedCandidates = tierFilteredModels;
    }

    // Capability floor (minModel): never select or escalate to a model weaker than
    // the configured floor. The floor is a model NAME from the chain; its priority
    // is the cutoff — any candidate ranked below it (higher priority number) is
    // excluded. This prevents the weak-tier thrash without favoring any provider.
    if (this.config.minModel) {
      const floor = this.config.chain.find(m => m.name === this.config.minModel);
      if (floor) {
        const floorPriority = floor.priority;
        const aboveFloor = rankedCandidates.filter(m => m.priority <= floorPriority);
        if (aboveFloor.length > 0) rankedCandidates = aboveFloor;
      }
    }
    let rateLimitError: Error | undefined;

    for (const m of rankedCandidates) {
      if (isLocalEndpoint(m.endpoint)) {
        selectedModel = m;
        if (this.config.strategy === 'round-robin') {
          const chosenIndex = tierFilteredModels.indexOf(m);
          this.roundRobinIndex = (chosenIndex + 1) % tierFilteredModels.length;
        }
        break;
      }

      const rateLimiter = this.rateLimiters.get(`${m.endpoint}|${m.model}`);
      if (rateLimiter) {
        const est = this.estimateTokens(request);
        if (consumeTokens(rateLimiter, est)) {
          selectedModel = m;
          if (this.config.strategy === 'round-robin') {
            const chosenIndex = tierFilteredModels.indexOf(m);
            this.roundRobinIndex = (chosenIndex + 1) % tierFilteredModels.length;
          }
          break;
        } else {
          const waitMs = getWaitTime(rateLimiter, est);
          if (!rateLimitError) {
            rateLimitError = new Error(`Rate limited. Wait ${waitMs}ms or try another model.`);
          }
        }
      } else {
        selectedModel = m;
        if (this.config.strategy === 'round-robin') {
          const chosenIndex = tierFilteredModels.indexOf(m);
          this.roundRobinIndex = (chosenIndex + 1) % tierFilteredModels.length;
        }
        break;
      }
    }

    if (!selectedModel) {
      throw rateLimitError || new Error('All models are currently rate limited.');
    }

    if (targetTier === 'fast') {
      this.routeStats.fast++;
    } else if (targetTier === 'standard') {
      this.routeStats.standard++;
    } else {
      this.routeStats.complex++;
    }
    this.lastRoutedTier = targetTier === 'fast' ? 'fast' : targetTier === 'standard' ? 'standard' : 'intelligence';

    const health = getCachedHealth(selectedModel) ?? { healthy: true, lastCheck: Date.now(), consecutiveFailures: 0 };
    const reason = `tier '${targetTier}' via ${this.config.strategy} strategy`;
    this.recordRoutingDecision(selectedModel, reason, skipped);
    return { model: selectedModel, health, reason, skipped: skipped.map(s => ({ ...s })) };
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
    let attempts = 0;
    const maxAttempts = 3;
    let lastError: unknown;
    const excludedModels = new Set<string>();

    while (attempts < maxAttempts) {
      attempts++;
      let selectedModel: ModelEntry | undefined;
      try {
        const { model } = await this.route(request, excludedModels);
        selectedModel = model;
        if (process.env.DAEDALUS_DEBUG) {
          const skipped = this.lastRouteDecision?.skipped ?? [];
          const skipInfo = skipped.length > 0
            ? ` (skipped ${skipped.length}: ${skipped.map(s => `${s.model}[${s.reason}]`).join(', ')})`
            : '';
          console.error(`[ROUTE] ${model.name} — ${this.lastRouteDecision?.reason ?? 'n/a'}${skipInfo}`);
        }
        const client = this.getOrCreateClient(model);
        const key = `${model.endpoint}|${model.model}`;

        const actualModel = model.model === 'auto'
          ? await this.discoverModel(client, key)
          : model.model;
        
        this.lastRoutedModel = model.name === actualModel ? model.name : `${model.name} (${actualModel})`;
        this.lastRoutedModelName = model.name;
        
        const { signal, ...body } = request;
        delete (body as Record<string, unknown>).complexity;
        const isOfficialOpenAI = model.provider === 'openai' || model.endpoint.includes('api.openai.com');
        if (body.tool_choice === 'required' && !isOfficialOpenAI) {
          body.tool_choice = 'auto';
        }
        if (body.frequency_penalty === undefined) {
          body.frequency_penalty = 0.2;
        }
        if (body.presence_penalty === undefined) {
          body.presence_penalty = 0.1;
        }

        const sanitizedMessages = sanitizeMessagesForModel(body.messages, model);

        const start = Date.now();
        const response = await client.chat.completions.create({
          ...body,
          messages: sanitizedMessages,
          model: actualModel,
        } as ChatCompletionCreateParamsNonStreaming, { signal }) as ChatResponse;
        
        const elapsed = Date.now() - start;
        markHealthy(model, elapsed);
        this.recordLatency(model, elapsed);
        return response;
      } catch (err) {
        lastError = err;
        if (err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError')) throw err;
        if (selectedModel) {
          if (isHardFailure(err)) {
            this.blacklistModel(selectedModel, err instanceof Error ? err.message : String(err));
          } else {
            markUnhealthy(selectedModel, err instanceof Error ? err.message : String(err));
          }
          excludedModels.add(selectedModel.name);
          excludedModels.add(selectedModel.model);
          // The pinned model was rejected by the provider as unavailable (disabled /
          // removed / renamed). Re-pinning it next attempt would only loop on the
          // dead model, so drop the pin and let the router fall back to others.
          if (request.model && request.model !== 'auto' && isModelUnavailableError(err)) {
            request.model = 'auto';
          }
        }
      }
    }

    throw lastError || new Error('All model attempts failed.');
  }

  async *chatStream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    let attempts = 0;
    const maxAttempts = 3;
    let lastError: unknown;
    const excludedModels = new Set<string>();

    while (attempts < maxAttempts) {
      attempts++;
      let selectedModel: ModelEntry | undefined;
      try {
        const { model } = await this.route(request, excludedModels);
        selectedModel = model;
        if (process.env.DAEDALUS_DEBUG) {
          const skipped = this.lastRouteDecision?.skipped ?? [];
          const skipInfo = skipped.length > 0
            ? ` (skipped ${skipped.length}: ${skipped.map(s => `${s.model}[${s.reason}]`).join(', ')})`
            : '';
          console.error(`[ROUTE] ${model.name} — ${this.lastRouteDecision?.reason ?? 'n/a'}${skipInfo}`);
        }
        const client = this.getOrCreateClient(model);
        const key = `${model.endpoint}|${model.model}`;

        const actualModel = model.model === 'auto'
          ? await this.discoverModel(client, key)
          : model.model;
        
        this.lastRoutedModel = model.name === actualModel ? model.name : `${model.name} (${actualModel})`;
        this.lastRoutedModelName = model.name;
        
        const { signal, ...body } = request;
        delete (body as Record<string, unknown>).complexity;
        const isOfficialOpenAI = model.provider === 'openai' || model.endpoint.includes('api.openai.com');
        if (body.tool_choice === 'required' && !isOfficialOpenAI) {
          body.tool_choice = 'auto';
        }

        if (body.frequency_penalty === undefined) {
          body.frequency_penalty = 0.2;
        }
        if (body.presence_penalty === undefined) {
          body.presence_penalty = 0.1;
        }

        const sanitizedMessages = sanitizeMessagesForModel(body.messages, model);

        const streamOptions = body.stream_options ?? { include_usage: true };

        const start = Date.now();
        const stream = await client.chat.completions.create({
          ...body,
          messages: sanitizedMessages,
          model: actualModel,
          stream: true,
          stream_options: streamOptions,
        } as ChatCompletionCreateParamsStreaming, { signal });

        for await (const chunk of stream) {
          yield chunk as StreamChunk;
        }
        
        const elapsed = Date.now() - start;
        markHealthy(model, elapsed);
        this.recordLatency(model, elapsed);
        return;
      } catch (err) {
        lastError = err;
        if (err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError')) throw err;
        if (selectedModel) {
          if (isHardFailure(err)) {
            this.blacklistModel(selectedModel, err instanceof Error ? err.message : String(err));
          } else {
            markUnhealthy(selectedModel, err instanceof Error ? err.message : String(err));
          }
          excludedModels.add(selectedModel.name);
          excludedModels.add(selectedModel.model);
          // The pinned model was rejected by the provider as unavailable (disabled /
          // removed / renamed). Re-pinning it next attempt would only loop on the
          // dead model, so drop the pin and let the router fall back to others.
          if (request.model && request.model !== 'auto' && isModelUnavailableError(err)) {
            request.model = 'auto';
          }
        }
      }
    }

    throw lastError || new Error('All model streaming attempts failed.');
  }

  private async discoverModel(client: OpenAI, cacheKey: string): Promise<string> {
    const cached = this.discoveredModels.get(cacheKey);
    if (cached) return cached;
    try {
      const models = await client.models.list();
      if (models && Array.isArray(models.data) && models.data.length > 0) {
        const id = models.data[0].id;
        this.discoveredModels.set(cacheKey, id);
        return id;
      }
    } catch { /* ignore — fallback below */ }

    const modelPart = cacheKey.split('|')[1];
    if (modelPart && modelPart !== 'auto') {
      return modelPart;
    }
    return 'gpt-3.5-turbo';
  }

  async listModels(): Promise<string[]> {
    return this.getEnabledModels()
      .sort((a, b) => a.priority - b.priority)
      .map(entry => `${entry.name}:${entry.model}`);
  }

  // Rich catalog metadata for a single endpoint, used by `/model sync` to expand
  // a single "auto" entry into individually-selectable models. Reads the upstream
  // OpenAI-compatible /v1/models payload (FreeLLM API augments each row with
  // context_window + available, which the OpenAI SDK types as `any`).
  async syncCatalog(endpointName?: string): Promise<Array<{
    id: string;
    displayName: string;
    contextWindow: number | null;
    available: boolean;
    intelligenceRank: number | null;
    platform: string | null;
  }>> {
    const entry = endpointName
      ? this.config.chain.find(e => e.name.toLowerCase() === endpointName.toLowerCase())
      // Prefer a freellmapi entry that HAS an apiKey as the default sync target: a keyless
      // top-of-chain entry (e.g. ox-alpha) would otherwise 401 the default /model sync.
      : (this.config.chain.find(e => e.provider === 'freellmapi' && !!e.apiKey)
        ?? this.config.chain.find(e => e.provider === 'freellmapi')
        ?? this.getEnabledModels()[0]);
    if (!entry) throw new Error('No model endpoint found to sync. Add one with /model add first.');
    try {
      const client = this.getOrCreateClient(entry);
      const list = await client.models.list();
      const rows: Array<{
        id: string;
        displayName: string;
        contextWindow: number | null;
        available: boolean;
        intelligenceRank: number | null;
        platform: string | null;
      }> = [];
      for (const m of list.data) {
        if (!m.id || m.id === 'auto') continue; // keep the virtual auto entry out of the expanded list
        const extra = m as unknown as {
          context_window?: number | null;
          contextWindow?: number | null;
          available?: boolean | number;
          display_name?: string;
          intelligence_rank?: number | null;
          platform?: string | null;
        };
        const avail = extra.available;
        rows.push({
          id: m.id,
          displayName: extra.display_name ?? m.id,
          contextWindow: extra.context_window ?? extra.contextWindow ?? null,
          available: avail === true || avail === 1,
          intelligenceRank: extra.intelligence_rank ?? null,
          platform: extra.platform ?? null,
        });
      }
      return rows;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read models from ${entry.name} (${entry.endpoint}): ${msg}`);
    }
  }

  getConfig(): RouterConfig {
    return this.config;
  }

  getRouteStats() {
    return { ...this.routeStats };
  }

  updateConfig(config: Partial<RouterConfig>): void {
    const wasRunning = this.healthCheckTimer !== null;
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    this.config = { ...this.config, ...config };
    this.clients.clear();
    this.rateLimiters.clear();
    this.initializeRateLimiters();
    if (wasRunning) {
      this.startHealthChecks().catch(() => {});
    }
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

export function sanitizeMessagesForModel(messages: ChatMessage[], model: ModelEntry): ChatCompletionMessageParam[] {
  if (!messages) return [];
  const sanitized: ChatMessage[] = messages.map(msg => {
    const role = msg.role;
    const rawContent = msg.content;
    let content: ChatMessageContent;
    if (rawContent === null || rawContent === undefined) {
      content = '';
    } else if (Array.isArray(rawContent)) {
      if (model.supportsVision) {
        content = rawContent;
      } else {
        const textParts = rawContent
          .filter((part): part is Extract<MessageContentPart, { type: 'text' }> => part.type === 'text')
          .map((part) => part.text || '')
          .join('\n');
        content = textParts || '[Image/Vision Payload Removed]';
      }
    } else {
      content = rawContent;
    }

    const cleanMsg: ChatMessage = { role, content };

    if (role === 'assistant') {
      if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        cleanMsg.tool_calls = msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      }
      if (msg.name) cleanMsg.name = msg.name;
    } else if (role === 'tool') {
      cleanMsg.tool_call_id = msg.tool_call_id;
    } else if (role === 'user') {
      if (msg.name) cleanMsg.name = msg.name;
    } else if (role === 'system') {
      if (msg.name) cleanMsg.name = msg.name;
    }

    return cleanMsg;
  });

  return sanitized as ChatCompletionMessageParam[];
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