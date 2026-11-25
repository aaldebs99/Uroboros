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
    // `mise run test:coverage`: a report of what the suite runs, never a gate.
    coverage: {
      provider: "v8",
      include: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.ts", "tools/*/src/**/*.ts"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "**/generated/**",
        "apps/web/src/test/**",
        "packages/ytdlp/src/testFake.ts",
        "tools/ratchet/src/testRepo.ts",
      ],
      reporter: ["text-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
