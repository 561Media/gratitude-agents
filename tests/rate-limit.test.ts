import { describe, expect, it } from "vitest";
import {
  MemoryCounterStore,
  consume,
  consumeBudgets,
  getLimit,
  rateLimitResponse,
  windowStart,
  type CounterStore,
} from "@/lib/rate-limit";

const USER = "11111111-1111-1111-1111-111111111111";

describe("rate limit counter", () => {
  it("allows up to the limit then refuses within the same window", async () => {
    const store = new MemoryCounterStore();
    const env = { RATE_LIMIT_EXPORTS_PER_HOUR: "3" };
    const now = new Date("2026-09-15T10:15:00Z");
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await consume(store, USER, "export_hour", 1, now, env));
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[2].remaining).toBe(0);
    expect(results[3].resetAt.toISOString()).toBe("2026-09-15T11:00:00.000Z");
  });

  it("starts a fresh count in the next window", async () => {
    const store = new MemoryCounterStore();
    const env = { RATE_LIMIT_EXPORTS_PER_HOUR: "1" };
    expect((await consume(store, USER, "export_hour", 1, new Date("2026-09-15T10:59:59Z"), env)).allowed).toBe(true);
    expect((await consume(store, USER, "export_hour", 1, new Date("2026-09-15T10:59:59Z"), env)).allowed).toBe(false);
    expect((await consume(store, USER, "export_hour", 1, new Date("2026-09-15T11:00:00Z"), env)).allowed).toBe(true);
  });

  it("keeps users independent", async () => {
    const store = new MemoryCounterStore();
    const env = { RATE_LIMIT_IMAGES_PER_DAY: "1" };
    const now = new Date();
    expect((await consume(store, USER, "image_day", 1, now, env)).allowed).toBe(true);
    expect((await consume(store, "other", "image_day", 1, now, env)).allowed).toBe(true);
    expect((await consume(store, USER, "image_day", 1, now, env)).allowed).toBe(false);
  });

  it("reads limits from env with defaults for missing or invalid values", () => {
    expect(getLimit("chat_hour", {})).toBe(60);
    expect(getLimit("chat_hour", { RATE_LIMIT_CHAT_PER_HOUR: "5" })).toBe(5);
    expect(getLimit("chat_hour", { RATE_LIMIT_CHAT_PER_HOUR: "abc" })).toBe(60);
    expect(getLimit("chat_hour", { RATE_LIMIT_CHAT_PER_HOUR: "0" })).toBe(0);
  });

  it("aligns windows to fixed boundaries", () => {
    expect(windowStart(new Date("2026-09-15T13:47:12Z"), 86400).toISOString()).toBe("2026-09-15T00:00:00.000Z");
  });

  it("fails open when the counter store errors", async () => {
    const broken: CounterStore = {
      incrementIfWithin: async () => {
        throw new Error("db down");
      },
    };
    const original = console.error;
    console.error = () => {};
    try {
      expect(await consumeBudgets(USER, ["chat_hour"], 1, broken)).toBeNull();
    } finally {
      console.error = original;
    }
  });

  it("returns a 429 JSON response with Retry-After", async () => {
    const store = new MemoryCounterStore();
    const env = { RATE_LIMIT_CHAT_PER_HOUR: "0" };
    const result = await consume(store, USER, "chat_hour", 1, new Date(), env);
    const res = rateLimitResponse(result);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    const body = await res.json();
    expect(body.code).toBe("rate_limited");
    expect(body.bucket).toBe("chat_hour");
  });
});
