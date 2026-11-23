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
 * Sign-in attempt counters in Valkey, so every replica shares them (Djinn's are per process).
 * `attempt` counts first and checks after, in one transaction, so a burst of parallel guesses
 * cannot all pass the check before any of them is counted; `succeeded` takes a good sign-in back
 * off the counters.
 */
export function createLimiter(valkey: Redis, prefix: string) {
  const redisKey = (k: FailureKey) => `${prefix}:signin-fail:${k.kind}:${k.value}`;
  const limit = (k: FailureKey) =>
    k.kind === "user" ? MAX_FAILURES_PER_USER : MAX_FAILURES_PER_IP;
  return {
    /** Counts one attempt against every key; true when any key is now over its limit. */
    async attempt(keys: FailureKey[]): Promise<boolean> {
      const multi = valkey.multi();
      for (const k of keys) {
        multi.incr(redisKey(k));
        multi.expire(redisKey(k), FAILURE_WINDOW_SECONDS, "NX");
      }
      const results = (await multi.exec()) ?? [];
      const failed = results.find(([err]) => err !== null);
      if (failed?.[0]) throw failed[0];
      return keys.some((k, i) => Number(results[i * 2]?.[1] ?? 0) > limit(k));
    },
    /** A good sign-in: clears the username's count and takes this attempt off the others. */
    async succeeded(keys: FailureKey[]): Promise<void> {
      const multi = valkey.multi();
      for (const k of keys) {
        if (k.kind === "user") multi.del(redisKey(k));
        else multi.decr(redisKey(k));
      }
      await multi.exec();
    },
  };
}

export type Limiter = ReturnType<typeof createLimiter>;
