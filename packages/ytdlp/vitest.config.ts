import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "ytdlp", include: ["src/**/*.test.ts"] },
});
