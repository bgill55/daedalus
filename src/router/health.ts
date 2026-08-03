// Health checking for models

import { ModelEntry, ModelHealth } from './types.js';

const healthCache = new Map<string, ModelHealth>();

const catalogCache = new Map<string, { ids: Set<string>; fetchedAt: number }>();
const CATALOG_TTL = 5 * 60 * 1000;

function catalogKey(endpoint: string): string {
  let baseUrl = endpoint;
  if (!/^https?:\/\//i.test(baseUrl)) {
    baseUrl = 'https://' + baseUrl;
  }
  return baseUrl;
}

async function fetchEndpointCatalog(endpoint: string, apiKey: string | undefined): Promise<Set<string> | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const response = await fetch(`${catalogKey(endpoint)}/models`, {
      signal: controller.signal,
      headers,
    });
    clearTimeout(timeoutId);
    if (!response.ok) return null;
    const data = await response.json() as { data?: Array<{ id?: string }> | null };
    const ids = new Set<string>();
    for (const m of data?.data ?? []) {
      if (m && typeof m.id === 'string') ids.add(m.id);
    }
    catalogCache.set(endpoint, { ids, fetchedAt: Date.now() });
    return ids;
  } catch {
    return null;
  }
}

export function getCachedCatalog(endpoint: string): Set<string> | null {
  const cached = catalogCache.get(endpoint);
  if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL) return cached.ids;
  return null;
}

export async function getEndpointCatalog(endpoint: string, apiKey: string | undefined): Promise<Set<string> | null> {
  const cached = getCachedCatalog(endpoint);
  if (cached) return cached;
  return fetchEndpointCatalog(endpoint, apiKey);
}

function notInCatalogHealth(model: ModelEntry, cached: ModelHealth | undefined): ModelHealth {
  return {
    healthy: false,
    lastCheck: Date.now(),
    error: `Model '${model.model}' is not in the catalog served by this endpoint`,
    consecutiveFailures: (cached?.consecutiveFailures ?? 0) + 1,
  };
}

export async function checkModelHealth(model: ModelEntry, timeout: number): Promise<ModelHealth> {
  const cacheKey = `${model.endpoint}|${model.model}`;
  const cached = healthCache.get(cacheKey);
  
  // Return cached if recent (< 30s)
  if (cached && Date.now() - cached.lastCheck < 30000) {
    return cached;
  }

  // Short-circuit when the endpoint catalog is cached and the model id is absent
  const cachedCatalog = getCachedCatalog(model.endpoint);
  if (model.model !== 'auto' && cachedCatalog && !cachedCatalog.has(model.model)) {
    const health = notInCatalogHealth(model, cached);
    healthCache.set(cacheKey, health);
    return health;
  }

  try {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    // Normalize endpoint — prepend https:// if missing
    let baseUrl = model.endpoint;
    if (!/^https?:\/\//i.test(baseUrl)) {
      baseUrl = 'https://' + baseUrl;
    }
    // Use /models endpoint to check health
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (model.apiKey) {
      headers['Authorization'] = `Bearer ${model.apiKey}`;
    }
    const response = await fetch(`${baseUrl}/models`, {
      signal: controller.signal,
      headers,
    });
    
    clearTimeout(timeoutId);
    const latency = Date.now() - start;

    if (response.ok) {
      const ids = new Set<string>();
      try {
        const data = await response.json() as { data?: Array<{ id?: string }> | null };
        for (const m of data?.data ?? []) {
          if (m && typeof m.id === 'string') ids.add(m.id);
        }
      } catch {
        // Non-JSON /models response — catalog unknown, skip membership check
      }
      if (ids.size > 0) {
        catalogCache.set(model.endpoint, { ids, fetchedAt: Date.now() });
      }
      if (model.model !== 'auto' && ids.size > 0 && !ids.has(model.model)) {
        const health = notInCatalogHealth(model, cached);
        healthCache.set(cacheKey, health);
        return health;
      }
      const health: ModelHealth = {
        healthy: true,
        lastCheck: Date.now(),
        latencyMs: latency,
        consecutiveFailures: 0,
      };
      healthCache.set(cacheKey, health);
      return health;
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (err: any) {
    const cached = healthCache.get(cacheKey) ?? {
      healthy: false,
      lastCheck: 0,
      consecutiveFailures: 0,
    };
    
    const health: ModelHealth = {
      healthy: false,
      lastCheck: Date.now(),
      error: err.message,
      consecutiveFailures: (cached?.consecutiveFailures ?? 0) + 1,
    };
    healthCache.set(cacheKey, health);
    return health;
  }
}

export function getCachedHealth(model: ModelEntry): ModelHealth | undefined {
  const cacheKey = `${model.endpoint}|${model.model}`;
  return healthCache.get(cacheKey);
}

export function markHealthy(model: ModelEntry, latencyMs: number): void {
  const cacheKey = `${model.endpoint}|${model.model}`;
  healthCache.set(cacheKey, {
    healthy: true,
    lastCheck: Date.now(),
    latencyMs,
    consecutiveFailures: 0,
  });
}

export function markUnhealthy(model: ModelEntry, error: string): void {
  const cacheKey = `${model.endpoint}|${model.model}`;
  const cached = healthCache.get(cacheKey) ?? { healthy: false, lastCheck: 0, consecutiveFailures: 0 };
  healthCache.set(cacheKey, {
    healthy: false,
    lastCheck: Date.now(),
    error,
    consecutiveFailures: cached.consecutiveFailures + 1,
  });
}