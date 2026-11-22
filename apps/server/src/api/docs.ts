import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { OpenAPIHono } from "@hono/zod-openapi";

/**
 * Swagger UI at `/api/docs`, from the pinned `swagger-ui-dist` and nothing else: no CDN, so the
 * page cannot change under a release and needs no third-party origin in its CSP. The bundle
 * carries the files tsdown copied next to it (`dist/swagger-ui/`); a source run reads them from
 * the package.
 */
const DOCS = "/api/docs";

/** The files the page loads, by the name it loads them under. */
const ASSETS: Record<string, { file: string; type: string }> = {
  "swagger-ui.css": { file: "swagger-ui.css", type: "text/css; charset=utf-8" },
  "swagger-ui-bundle.js": {
    file: "swagger-ui-bundle.js",
    type: "text/javascript; charset=utf-8",
  },
};

/** Started from its own file rather than inline, so the page's CSP needs no script hash. */
const INIT = `window.ui = SwaggerUIBundle({
  url: "/api/openapi.json",
  dom_id: "#swagger-ui",
  // The default sends the document to validator.swagger.io; this page talks to its origin only.
  validatorUrl: null,
});
`;

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Uroboros API</title>
    <link rel="stylesheet" href="${DOCS}/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${DOCS}/swagger-ui-bundle.js"></script>
    <script src="${DOCS}/init.js"></script>
  </body>
</html>
`;

/** The directory holding swagger-ui-dist's files: beside the bundle, else the installed package. */
export function swaggerUiDir(): string {
  const bundled = join(import.meta.dirname, "swagger-ui");
  if (existsSync(join(bundled, "swagger-ui-bundle.js"))) return bundled;
  return dirname(createRequire(import.meta.url).resolve("swagger-ui-dist/package.json"));
}

/** Registers `/api/docs` and its assets. The files are read on first use and kept. */
export function registerDocs(app: OpenAPIHono, dir: string = swaggerUiDir()): void {
  const cache = new Map<string, Promise<Buffer>>();
  const load = (file: string) => {
    let body = cache.get(file);
    if (body === undefined) {
      body = readFile(join(dir, file));
      body.catch(() => cache.delete(file));
      cache.set(file, body);
    }
    return body;
  };
  app.get(DOCS, (c) => c.html(PAGE));
  app.get(`${DOCS}/init.js`, (c) =>
    c.body(INIT, 200, { "content-type": "text/javascript; charset=utf-8" }),
  );
  app.get(`${DOCS}/:asset`, async (c) => {
    const asset = ASSETS[c.req.param("asset")];
    if (asset === undefined) return c.notFound();
    const body = await load(asset.file);
    return c.body(new Uint8Array(body), 200, { "content-type": asset.type });
  });
}
