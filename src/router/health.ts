// Health checking for models

import { ModelEntry, ModelHealth } from './types.js';

const healthCache = new Map<string, ModelHealth>();

export async function checkModelHealth(model: ModelEntry, timeout: number): Promise<ModelHealth> {
  const cacheKey = `${model.endpoint}|${model.model}`;
  const cached = healthCache.get(cacheKey);
  
  // Return cached if recent (< 30s)
  if (cached && Date.now() - cached.lastCheck < 30000) {
    return cached;
  }

  try {
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    // Use /models endpoint to check health
    const response = await fetch(`${model.endpoint}/models`, {
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
    });
    
    clearTimeout(timeoutId);
    const latency = Date.now() - start;

    if (response.ok) {
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