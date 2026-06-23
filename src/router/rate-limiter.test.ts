import { describe, it, expect, vi } from 'vitest';
import {
  createTokenBucket,
  consumeTokens,
  getAvailableTokens,
  getWaitTime,
  refillBucket,
} from './rate-limiter.js';

describe('TokenBucket rate limiter', () => {

  it('creates a bucket with full capacity', () => {
    const bucket = createTokenBucket(100, 10);
    expect(bucket.tokens).toBe(100);
    expect(bucket.capacity).toBe(100);
    expect(bucket.refillRate).toBe(10);
  });

  it('allows consuming available tokens', () => {
    const bucket = createTokenBucket(100, 10);
    expect(consumeTokens(bucket, 30)).toBe(true);
    expect(bucket.tokens).toBe(70);
  });

  it('rejects consuming more tokens than available', () => {
    const bucket = createTokenBucket(50, 10);
    expect(consumeTokens(bucket, 51)).toBe(false);
  });

  it('refills tokens over time', () => {
    vi.useFakeTimers();
    const bucket = createTokenBucket(100, 60);
    consumeTokens(bucket, 60);
    expect(bucket.tokens).toBe(40);

    vi.advanceTimersByTime(1000);
    refillBucket(bucket);
    expect(bucket.tokens).toBe(100);

    vi.useRealTimers();
  });

  it('does not exceed capacity on refill', () => {
    vi.useFakeTimers();
    const bucket = createTokenBucket(100, 10);
    vi.advanceTimersByTime(20000);
    refillBucket(bucket);
    expect(bucket.tokens).toBe(100);

    vi.useRealTimers();
  });

  it('getAvailableTokens returns floored token count', () => {
    vi.useFakeTimers();
    const bucket = createTokenBucket(100, 1);
    consumeTokens(bucket, 99);
    vi.advanceTimersByTime(500);
    const avail = getAvailableTokens(bucket);
    expect(avail).toBe(1);

    vi.useRealTimers();
  });

  it('getWaitTime returns 0 when enough tokens available', () => {
    const bucket = createTokenBucket(100, 10);
    const wait = getWaitTime(bucket, 50);
    expect(wait).toBe(0);
  });

  it('getWaitTime calculates wait time for insufficient tokens', () => {
    vi.useFakeTimers();
    const bucket = createTokenBucket(100, 10);
    consumeTokens(bucket, 100);
    const wait = getWaitTime(bucket, 30);
    expect(wait).toBeGreaterThan(0);

    vi.useRealTimers();
  });

  it('handles consume and refill correctly', () => {
    vi.useFakeTimers();
    const bucket = createTokenBucket(100, 50);
    consumeTokens(bucket, 80);
    expect(bucket.tokens).toBe(20);

    vi.advanceTimersByTime(1000);
    refillBucket(bucket);
    consumeTokens(bucket, 40);
    expect(bucket.tokens).toBe(30);

    vi.useRealTimers();
  });

  it('handles zero capacity edge case', () => {
    const bucket = createTokenBucket(0, 0);
    expect(consumeTokens(bucket, 1)).toBe(false);
    expect(getAvailableTokens(bucket)).toBe(0);
  });

  it('maintains total correctness with high-frequency consume', () => {
    vi.useFakeTimers();
    const bucket = createTokenBucket(1000, 100);
    let totalConsumed = 0;

    for (let i = 0; i < 20; i++) {
      if (consumeTokens(bucket, 50)) {
        totalConsumed += 50;
      }
      vi.advanceTimersByTime(100);
    }

    expect(totalConsumed).toBeGreaterThan(0);
    expect(bucket.tokens).toBeLessThanOrEqual(1000);

    vi.useRealTimers();
  });

});
