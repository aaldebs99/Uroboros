import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      // Each workspace package brings its own vitest.config.ts. A bare `tools/*` glob would also
      // match loose files, which Vitest rejects as a project.
      "apps/*/vitest.config.ts",
      "packages/*/vitest.config.ts",
      "tools/*/vitest.config.ts",
    ],
  },
});
