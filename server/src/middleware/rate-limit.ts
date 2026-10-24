import type { NextFunction, Request, Response } from 'express';
import { tooManyRequests } from '../lib/errors.js';

// fixed-window rate limiter, held in process memory. being upfront about
// its limits: resets on restart, doesn't coordinate across instances, so
// behind a load balancer each one keeps its own count. fine for a
// single-instance API — didn't want to spin up Redis just for this. if it
// ever needs to scale out, swapping hit() for Redis INCR/EXPIRE is a
// one-function change since every caller already goes through it.
//
// the actual reason this exists: makes brute-forcing a 6-digit OTP
// impractical. 10^6 possible codes vs. 5 verify attempts per code plus a
// cap on how many codes you can even request.

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number; // requests allowed per key per window
  keyBy?: (req: Request) => string; // defaults to client IP
  message?: string;
}

const buckets = new Map<string, Bucket>();

// without this, a long-running process just accumulates one map entry per
// key forever and never frees them
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000);
sweeper.unref(); // don't let this timer keep the process alive on shutdown

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

// test helper, gives each test a clean slate
export function resetRateLimits(): void {
  buckets.clear();
}
