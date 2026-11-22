import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * `base: "/"` keeps deep links working on a hard refresh behind the server's SPA fallback. In dev,
 * `/api` is proxied to the API (`mise run dev:api`). Tests live in `vitest.config.ts`.
 */
export const apiTarget = process.env["UROBOROS_API_URL"] ?? "http://127.0.0.1:8080";

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
