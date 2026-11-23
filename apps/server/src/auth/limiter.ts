import type { Redis } from "ioredis";

/** The window failed sign-ins are counted in. */
export const FAILURE_WINDOW_SECONDS = 15 * 60;
export const MAX_FAILURES_PER_USER = 5;
export const MAX_FAILURES_PER_IP = 30;

export interface FailureKey {
  kind: "user" | "ip";
  value: string;
}

/**
 * Failed sign-in counters in Valkey, so every replica shares them (Djinn's are per process).
 * `blocked` is true once any key reached its limit inside the window.
 */
export function createLimiter(valkey: Redis, prefix: string) {
  const redisKey = (k: FailureKey) => `${prefix}:signin-fail:${k.kind}:${k.value}`;
  const limit = (k: FailureKey) =>
    k.kind === "user" ? MAX_FAILURES_PER_USER : MAX_FAILURES_PER_IP;
  return {
    async blocked(keys: FailureKey[]): Promise<boolean> {
      if (keys.length === 0) return false;
      const counts = await valkey.mget(...keys.map(redisKey));
      return keys.some((k, i) => Number(counts[i] ?? 0) >= limit(k));
    },
    async fail(keys: FailureKey[]): Promise<void> {
      const multi = valkey.multi();
      for (const k of keys) {
        multi.incr(redisKey(k));
        multi.expire(redisKey(k), FAILURE_WINDOW_SECONDS, "NX");
      }
      await multi.exec();
    },
    async reset(keys: FailureKey[]): Promise<void> {
      if (keys.length > 0) await valkey.del(...keys.map(redisKey));
    },
  };
}

export type Limiter = ReturnType<typeof createLimiter>;
