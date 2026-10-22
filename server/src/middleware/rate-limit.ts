import type { NextFunction, Request, Response } from 'express';
import { tooManyRequests } from '../lib/errors.js';

/**
 * A fixed-window rate limiter held in process memory.
 *
 * Honest about its limits: this resets when the process restarts and does not
 * coordinate across instances, so behind a load balancer each instance keeps
 * its own count. For a single-instance assignment API that is the right
 * trade-off — no Redis to run, no extra dependency to explain. The swap to
 * Redis `INCR`/`EXPIRE` is a change to `hit()` only, because every caller
 * already goes through this one function.
 *
 * It exists specifically to make brute-forcing a 6-digit OTP impractical:
 * 10^6 possibilities against 5 verify attempts per code and a capped number
 * of sends per window.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Requests allowed per key per window. */
  max: number;
  /** What counts as "the same caller". Defaults to client IP. */
  keyBy?: (req: Request) => string;
  message?: string;
}

const buckets = new Map<string, Bucket>();

// Without this, a long-running process accumulates one entry per key forever.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000);
sweeper.unref(); // Don't hold the event loop open on shutdown.

export function hit(key: string, windowMs: number, max: number): { allowed: boolean; retryAfterSeconds: number; remaining: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0, remaining: max - 1 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  return {
    allowed: existing.count <= max,
    retryAfterSeconds,
    remaining: Math.max(0, max - existing.count),
  };
}

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, keyBy, message } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.method}:${req.route?.path ?? req.path}:${keyBy ? keyBy(req) : clientIp(req)}`;
    const result = hit(key, windowMs, max);

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      next(
        tooManyRequests(
          message ?? `Too many requests. Try again in ${result.retryAfterSeconds}s.`,
          result.retryAfterSeconds,
        ),
      );
      return;
    }

    next();
  };
}

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** Test helper — lets each test start from a clean slate. */
export function resetRateLimits(): void {
  buckets.clear();
}
