import { OpenAPIHono } from "@hono/zod-openapi";
import type { Kysely } from "kysely";
import type { Redis } from "ioredis";
import { pino } from "pino";
import type { Logger } from "pino";
import type { Database } from "../db/schema.ts";
import { disabledPush, type PushService } from "../push/service.ts";
import { registerDocs } from "./docs.ts";
import { ApiError, errorHandler, errorResponse } from "./errors.ts";
import { checkHealth, healthRoute } from "./health.ts";
import { infoRoute } from "./info.ts";
import { registerPushRoutes } from "./push.ts";
import { apiBodyLimit, DEFAULT_BODY_LIMIT_BYTES, securityHeaders } from "./security.ts";
import { createSpaHandler } from "./spa.ts";

export interface Deps {
  db: Kysely<Database>;
  valkey: Redis;
  version: string;
  /** Defaults to a JSON-to-stdout pino logger; tests pass a silent one. */
  logger?: Logger;
  /** Web Push; defaults to off (what `gen` uses). */
  push?: PushService;
}

/** The one OpenAPI document config, shared by the runtime route and `gen`. */
export function openApiConfig(version: string) {
  return {
    openapi: "3.1.0",
    info: { title: "Uroboros API", version },
  } as const;
}

export interface AppOptions {
  webDist: string | null;
  /** The largest request body `/api/*` accepts. Default 64 KiB. */
  bodyLimitBytes?: number;
}

export function createApp(deps: Deps, opts: AppOptions): OpenAPIHono {
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

  app.use("*", ...securityHeaders());
  app.use("/api/*", apiBodyLimit(opts.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES));

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
  registerPushRoutes(app, deps.db, deps.push ?? disabledPush);
  app.doc("/api/openapi.json", openApiConfig(deps.version));
  registerDocs(app);

  return app;
}
