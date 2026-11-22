import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      // Each workspace package brings its own vitest.config.ts. A bare `tools/*` glob would also
      // match loose files such as tools/smoke.test.ts, which Vitest rejects as a project.
      "apps/*/vitest.config.ts",
      "packages/*/vitest.config.ts",
      "tools/*/vitest.config.ts",
      // Loose test files directly under tools/ (the toolchain smoke test).
      { test: { name: "root", include: ["tools/*.test.ts"] } },
    ],
  },
});
