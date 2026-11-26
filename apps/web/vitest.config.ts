import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: "web",
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      css: false,
      // Budgets that catch a hang, not a slow runner: vitest's 5 s per test is a laptop's number,
      // and a CI runner shared with other jobs ran this suite six times slower than that. The
      // server project does the same; waits get theirs in src/test/setup.ts.
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  }),
);
