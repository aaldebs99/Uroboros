import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * `base: "/"` keeps deep links working on a hard refresh behind the server's SPA fallback. In dev,
 * `/api` is proxied to the API (`mise run dev:api`, on 127.0.0.1:18081). The dev server's own
 * port is 18173 (UROBOROS_UI_PORT), strict so a clash fails instead of silently moving to another
 * port. Tests live in `vitest.config.ts`.
 */
export const apiTarget = process.env["UROBOROS_API_URL"] ?? "http://127.0.0.1:18081";
const uiPort = Number(process.env["UROBOROS_UI_PORT"] ?? "18173");

/**
 * A worker that removes itself, served as `/sw.js` by the dev server only. A browser that opened a
 * production build on this origin keeps its worker, which answers every navigation from the old
 * build's cache; Vite answers `/sw.js` with `index.html`, an update the browser rejects, so
 * nothing would ever clear it. This one unregisters, empties Cache Storage and reloads the open
 * tabs, which then load from Vite. `src/main.tsx` registers nothing in dev.
 */
export const SELF_DESTROYING_WORKER = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    for (const key of await caches.keys()) await caches.delete(key);
    for (const client of await self.clients.matchAll({ type: "window" })) {
      await client.navigate(client.url).catch(() => {});
    }
  })());
});
`;

function devServiceWorker(): Plugin {
  return {
    name: "uroboros:dev-service-worker",
    apply: "serve",
    configureServer(server) {
      // Ahead of Vite's HTML fallback; an exact match, as connect's path argument is a prefix.
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/sw.js") {
          next();
          return;
        }
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(SELF_DESTROYING_WORKER);
      });
    },
  };
}

export default defineConfig({
  base: "/",
  plugins: [
    react(),
    tailwindcss(),
    devServiceWorker(),
    VitePWA({
      // A new version takes over at once and the page reloads into it.
      registerType: "autoUpdate",
      // `src/main.tsx` registers the worker itself, in production only.
      injectRegister: false,
      // `public/manifest.webmanifest` is static and linked from index.html, so the dev server
      // serves the same manifest as a build (iOS reads it when the icon is added).
      manifest: false,
      // `src/sw/sw.ts` is our own worker, for the push and notificationclick handlers, with the
      // shell precached and client routes falling back to it.
      strategies: "injectManifest",
      srcDir: "src/sw",
      filename: "sw.ts",
      injectManifest: {
        // Everything the shell needs to open with no connection.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,webmanifest}"],
        sourcemap: false,
      },
    }),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: uiPort,
    strictPort: true,
    proxy: { "/api": { target: apiTarget, changeOrigin: true } },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
