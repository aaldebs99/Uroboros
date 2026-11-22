import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * `base: "/"` keeps deep links working on a hard refresh behind the server's SPA fallback. In dev,
 * `/api` is proxied to the API (`mise run dev:api`, on 127.0.0.1:18081). The dev server's own
 * port is 18173 (UROBOROS_UI_PORT), strict so a clash fails instead of silently moving to another
 * port. Tests live in `vitest.config.ts`.
 */
export const apiTarget = process.env["UROBOROS_API_URL"] ?? "http://127.0.0.1:18081";
const uiPort = Number(process.env["UROBOROS_UI_PORT"] ?? "18173");

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: uiPort,
    strictPort: true,
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
