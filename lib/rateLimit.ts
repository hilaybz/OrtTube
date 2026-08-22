import "server-only";

/**
 * Per-key sliding-window rate limiting for routes that cost real money.
 *
 * In-memory, so each serverless instance counts separately — good enough to stop
 * cost abuse at pilot scale; swap for a shared store (e.g. Upstash) if the app
 * grows.
 *
 * A factory rather than a shared function because each limiter owns its own
 * buckets. Keys are user ids, so a single global map would silently pool every
 * route's budget into one: a student who asked the tutor ten questions would find
 * an unrelated endpoint refusing them.
 */
export function createRateLimiter(opts: {
  windowMs: number;
  max: number;
}): (key: string) => boolean {
  const buckets = new Map<string, number[]>();

  return (key: string): boolean => {
    const now = Date.now();
    const recent = (buckets.get(key) ?? []).filter((t) => now - t < opts.windowMs);
    if (recent.length >= opts.max) {
      // Written back even when refusing, so the expired entries just dropped
      // don't have to be re-filtered on the next call.
      buckets.set(key, recent);
      return true;
    }
    recent.push(now);
    buckets.set(key, recent);
    return false;
  };
}
