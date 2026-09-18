// Token-bucket rate limiter (in-memory for local; swap to Redis via same interface).
export interface RateConfig {
  perUserPerMin: number;
  perTenantPerMin: number;
}

const DEFAULTS: RateConfig = { perUserPerMin: 20, perTenantPerMin: 200 };

interface Bucket { count: number; windowStart: number; }

const userBuckets = new Map<string, Bucket>();
const tenantBuckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

function hit(map: Map<string, Bucket>, key: string, limit: number): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  let b = map.get(key);
  if (!b || now - b.windowStart >= WINDOW_MS) {
    b = { count: 0, windowStart: now };
    map.set(key, b);
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfterSec: Math.ceil((b.windowStart + WINDOW_MS - now) / 1000) };
  }
  return { ok: true };
}

export function checkRate(tenantId: string, userId: string, cfg: RateConfig = DEFAULTS) {
  const u = hit(userBuckets, `${tenantId}:${userId}`, cfg.perUserPerMin);
  if (!u.ok) return u;
  return hit(tenantBuckets, tenantId, cfg.perTenantPerMin);
}

export function resetRate() {
  userBuckets.clear();
  tenantBuckets.clear();
}
