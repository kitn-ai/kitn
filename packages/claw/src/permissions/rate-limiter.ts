export interface RateLimiterConfig {
  maxPerMinute: number;
  toolLimits?: Record<string, number>;
  windowMs?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private config: {
    maxPerMinute: number;
    windowMs: number;
    toolLimits: Record<string, number>;
  };
  private buckets = new Map<string, Bucket>();

  constructor(config: RateLimiterConfig) {
    this.config = {
      maxPerMinute: config.maxPerMinute,
      windowMs: config.windowMs ?? 60_000,
      toolLimits: config.toolLimits ?? {},
    };
  }

  tryAcquire(toolName: string): boolean {
    const now = Date.now();
    const limit =
      this.config.toolLimits[toolName] ?? this.config.maxPerMinute;

    let bucket = this.buckets.get(toolName);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.config.windowMs };
      this.buckets.set(toolName, bucket);
    }

    if (bucket.count >= limit) return false;
    bucket.count++;
    return true;
  }
}
