import { Redis } from "ioredis";
import { inject } from "vitest";

export const TestValkey = {
  /**
   * URL of the shared Valkey. Every test file runs against the same server in parallel, so a test
   * keeps to keys under its own unique prefix and never flushes the server: a FLUSHALL in one file
   * wipes the queues another file is in the middle of using.
   */
  url(): string {
    return inject("valkeyUrl");
  },

  /** Deletes every key under `prefix` (and nothing else). */
  async clear(prefix: string): Promise<void> {
    if (prefix === "") throw new Error("TestValkey.clear needs a non-empty prefix");
    const redis = new Redis(inject("valkeyUrl"), { lazyConnect: true });
    try {
      await redis.connect();
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 500);
        if (keys.length > 0) await redis.del(...keys);
        cursor = next;
      } while (cursor !== "0");
    } finally {
      redis.disconnect();
    }
  },
};
