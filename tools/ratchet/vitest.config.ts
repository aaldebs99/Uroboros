import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "ratchet", include: ["src/**/*.test.ts"] },
});
