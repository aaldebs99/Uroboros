import { Redis } from "ioredis";
import { inject } from "vitest";

export const TestValkey = {
  /** URL of the shared Valkey; tests share it, so use unique key prefixes or `flush()`. */
  url(): string {
    return inject("valkeyUrl");
  },

  /** Empties every database on the shared Valkey. */
  async flush(): Promise<void> {
    const redis = new Redis(inject("valkeyUrl"), { lazyConnect: true });
    try {
      await redis.connect();
      await redis.flushall();
    } finally {
      redis.disconnect();
    }
  },
};
