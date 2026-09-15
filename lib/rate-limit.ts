// Per-user abuse budgets for paid or heavy operations (chat turns, image
// generation, exports, upload tokens). Counters live in Postgres
// (usage_counters) so limits hold across serverless instances without a new
// paid service. Login throttling is intentionally NOT here: auth is moving to
// Clerk, which owns that control.

export type Bucket =
  | "chat_hour"
  | "chat_day"
  | "image_day"
  | "export_hour"
  | "upload_hour";

interface BucketConfig {
  windowSeconds: number;
  envVar: string;
  defaultLimit: number;
  label: string;
}

export const BUCKETS: Record<Bucket, BucketConfig> = {
  chat_hour: { windowSeconds: 3600, envVar: "RATE_LIMIT_CHAT_PER_HOUR", defaultLimit: 60, label: "chat messages this hour" },
  chat_day: { windowSeconds: 86400, envVar: "RATE_LIMIT_CHAT_PER_DAY", defaultLimit: 300, label: "chat messages today" },
  image_day: { windowSeconds: 86400, envVar: "RATE_LIMIT_IMAGES_PER_DAY", defaultLimit: 40, label: "generated images today" },
  export_hour: { windowSeconds: 3600, envVar: "RATE_LIMIT_EXPORTS_PER_HOUR", defaultLimit: 60, label: "exports this hour" },
  upload_hour: { windowSeconds: 3600, envVar: "RATE_LIMIT_UPLOADS_PER_HOUR", defaultLimit: 100, label: "uploads this hour" },
};

function envInt(name: string, fallback: number, env: Record<string, string | undefined> = process.env) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function getLimit(bucket: Bucket, env: Record<string, string | undefined> = process.env) {
  const cfg = BUCKETS[bucket];
  return envInt(cfg.envVar, cfg.defaultLimit, env);
}

// Input and per-run caps, also env-configurable
export const CHAT_MAX_MESSAGE_CHARS = () => envInt("CHAT_MAX_MESSAGE_CHARS", 20000);
export const CHAT_MAX_IMAGES_PER_RUN = () => envInt("CHAT_MAX_IMAGES_PER_RUN", 2);
export const EXPORT_MAX_CONTENT_CHARS = () => envInt("EXPORT_MAX_CONTENT_CHARS", 500000);

export function windowStart(now: Date, windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

export interface CounterStore {
  // Atomically add `amount` to the counter unless that would exceed `limit`.
  // Returns the new count, or null when the increment was refused.
  incrementIfWithin(
    userId: string,
    bucket: Bucket,
    windowStart: Date,
    amount: number,
    limit: number
  ): Promise<number | null>;
}

export interface RateResult {
  allowed: boolean;
  bucket: Bucket;
  limit: number;
  remaining: number;
  resetAt: Date;
}

export async function consume(
  store: CounterStore,
  userId: string,
  bucket: Bucket,
  amount = 1,
  now = new Date(),
  env: Record<string, string | undefined> = process.env
): Promise<RateResult> {
  const cfg = BUCKETS[bucket];
  const limit = getLimit(bucket, env);
  const start = windowStart(now, cfg.windowSeconds);
  const resetAt = new Date(start.getTime() + cfg.windowSeconds * 1000);

  if (amount > limit) {
    return { allowed: false, bucket, limit, remaining: 0, resetAt };
  }

  const count = await store.incrementIfWithin(userId, bucket, start, amount, limit);
  if (count === null) {
    return { allowed: false, bucket, limit, remaining: 0, resetAt };
  }
  return { allowed: true, bucket, limit, remaining: Math.max(0, limit - count), resetAt };
}

export class MemoryCounterStore implements CounterStore {
  private counts = new Map<string, number>();

  async incrementIfWithin(userId: string, bucket: Bucket, start: Date, amount: number, limit: number) {
    const key = `${userId}|${bucket}|${start.toISOString()}`;
    const current = this.counts.get(key) || 0;
    if (current + amount > limit) return null;
    this.counts.set(key, current + amount);
    return current + amount;
  }
}

export const postgresCounterStore: CounterStore = {
  async incrementIfWithin(userId, bucket, start, amount, limit) {
    const { db } = await import("@/lib/db");
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`
      INSERT INTO usage_counters (user_id, bucket, window_start, count, updated_at)
      VALUES (${userId}::uuid, ${bucket}, ${start.toISOString()}::timestamptz, ${amount}, now())
      ON CONFLICT (user_id, bucket, window_start)
      DO UPDATE SET count = usage_counters.count + EXCLUDED.count, updated_at = now()
      WHERE usage_counters.count + EXCLUDED.count <= ${limit}
      RETURNING count
    `);
    const row = (result.rows as { count: number }[])[0];

    // Opportunistic cleanup of expired windows (about 1 in 200 calls)
    if (Math.random() < 0.005) {
      void db
        .execute(sql`DELETE FROM usage_counters WHERE window_start < now() - interval '3 days'`)
        .catch(() => {});
    }

    return row ? Number(row.count) : null;
  },
};

// Consume one unit from each bucket in order; stops at the first refusal.
// If the counter store itself fails, the request is allowed and the error is
// logged: an outage of the counter table must not take the portal down.
export async function consumeBudgets(
  userId: string,
  buckets: Bucket[],
  amount = 1,
  store: CounterStore = postgresCounterStore
): Promise<RateResult | null> {
  for (const bucket of buckets) {
    try {
      const result = await consume(store, userId, bucket, amount);
      if (!result.allowed) return result;
    } catch (error) {
      console.error(`Rate limit store error (${bucket}), allowing request:`, error);
    }
  }
  return null;
}

export function rateLimitBody(result: RateResult) {
  const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
  return {
    error: `Limit reached: ${result.limit} ${BUCKETS[result.bucket].label}. Please try again later.`,
    code: "rate_limited",
    bucket: result.bucket,
    limit: result.limit,
    retryAfterSeconds,
  };
}

export function rateLimitResponse(result: RateResult): Response {
  const body = rateLimitBody(result);
  return new Response(JSON.stringify(body), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(body.retryAfterSeconds),
    },
  });
}
