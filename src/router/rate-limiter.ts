// Token bucket rate limiter

import { TokenBucket } from './types.js';

export function createTokenBucket(capacity: number, refillRate: number): TokenBucket {
  return {
    tokens: capacity,
    lastRefill: Date.now(),
    capacity,
    refillRate,
  };
}

export function consumeTokens(bucket: TokenBucket, tokens: number): boolean {
  refillBucket(bucket);
  if (bucket.tokens >= tokens) {
    bucket.tokens -= tokens;
    return true;
  }
  return false;
}

export function refillBucket(bucket: TokenBucket): void {
  const now = Date.now();
  const elapsedSeconds = (now - bucket.lastRefill) / 1000;
  const tokensToAdd = elapsedSeconds * bucket.refillRate;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd);
  bucket.lastRefill = now;
}

export function getAvailableTokens(bucket: TokenBucket): number {
  refillBucket(bucket);
  return Math.floor(bucket.tokens);
}

export function getWaitTime(bucket: TokenBucket, tokens: number): number {
  refillBucket(bucket);
  if (bucket.tokens >= tokens) return 0;
  const needed = tokens - bucket.tokens;
  return Math.ceil((needed / bucket.refillRate) * 1000);
}