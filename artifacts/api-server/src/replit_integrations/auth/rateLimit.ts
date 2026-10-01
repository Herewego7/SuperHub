// Minimal in-memory sliding-window limiter for auth endpoints. Single-process
// only (fine for this app's current single-instance deployment) — the goal is
// to blunt naive brute-force/credential-stuffing attempts against
// login/signup, not to be a general-purpose distributed rate limiter.
const buckets = new Map<string, { count: number; resetAt: number }>();

// Periodically drop expired buckets so this map can't grow unbounded under
// sustained traffic from many distinct keys.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

export function _resetRateLimitsForTest(): void {
  buckets.clear();
}
