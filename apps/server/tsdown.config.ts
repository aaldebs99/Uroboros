import { defineConfig } from "tsdown";

/**
 * One self-contained ESM file per entrypoint in bin/. Every dependency is inlined, including
 * `@uroboros/contract`, which exports raw .ts, so the runtime images need no node_modules.
 */
export default defineConfig({
  entry: {
    api: "src/bin/api.ts",
    worker: "src/bin/worker.ts",
    migrate: "src/bin/migrate.ts",
    gen: "src/bin/gen.ts",
  },
  format: "esm",
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  fixedExtension: true,
  deps: { alwaysBundle: [/.*/], onlyBundle: false },
  // The pinned Swagger UI that /api/docs serves (src/api/docs.ts), with its licence and notice.
  copy: [
    "swagger-ui.css",
    "swagger-ui-bundle.js",
    "swagger-ui-bundle.js.LICENSE.txt",
    "LICENSE",
    "NOTICE",
  ].map((file) => ({ from: `node_modules/swagger-ui-dist/${file}`, to: "dist/swagger-ui" })),
});
