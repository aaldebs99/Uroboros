import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "server",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["./test/globalSetup.ts"],
    // Containers start once per run; first pull of an image can be slow.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    // test/eventually.ts gives vi.waitFor the same timeout: vitest's 1000 ms is too tight under load.
    expect: { poll: { timeout: 5000 } },
  },
});
