import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import type { Kysely } from "kysely";
import type { Redis } from "ioredis";
import { pino } from "pino";
import type { Logger } from "pino";
import type { Database } from "../db/schema.ts";
import { ApiError, errorHandler, errorResponse } from "./errors.ts";
import { checkHealth, healthRoute } from "./health.ts";
import { infoRoute } from "./info.ts";
import { createSpaHandler } from "./spa.ts";

export interface Deps {
  db: Kysely<Database>;
  valkey: Redis;
  version: string;
  /** Defaults to a JSON-to-stdout pino logger; tests pass a silent one. */
  logger?: Logger;
}

export function createApp(deps: Deps, opts: { webDist: string | null }): OpenAPIHono {
  const logger = deps.logger ?? pino({ name: "uroboros-api" });
  const app = new OpenAPIHono({
    defaultHook: (result) => {
      if (!result.success) throw new ApiError("bad_request", "invalid request");
    },
  });
  const spa = opts.webDist === null ? null : createSpaHandler(opts.webDist);

  app.use("*", async (c, next) => {
    const start = performance.now();
    await next();
    logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - start),
      },
      "request",
    );
  });

  app.onError(errorHandler(logger));
  app.notFound(async (c) => {
    if (spa !== null && c.req.method === "GET" && !c.req.path.startsWith("/api/")) {
      const response = await spa(c.req.path);
      if (response) return response;
    }
    return errorResponse(c, "not_found", "not found");
  });

  app.openapi(healthRoute, async (c) => c.json(await checkHealth(deps.db, deps.valkey), 200));
  app.openapi(infoRoute, (c) => c.json({ name: "uroboros" as const, version: deps.version }, 200));
  app.doc("/api/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Uroboros API", version: deps.version },
  });
  app.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }));

  return app;
}
