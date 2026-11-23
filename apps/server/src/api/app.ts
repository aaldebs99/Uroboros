import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, Next } from "hono";
import type { Kysely } from "kysely";
import type { Redis } from "ioredis";
import { pino } from "pino";
import type { Logger } from "pino";
import type { AuthConfig } from "../auth/config.ts";
import { registerAccountRoutes } from "../auth/accountRoutes.ts";
import { registerAdminUserRoutes } from "../auth/adminUserRoutes.ts";
import { authGuard, type ResolveToken } from "../auth/guard.ts";
import { createLimiter } from "../auth/limiter.ts";
import type { DownloadContext } from "../downloads/dispatch.ts";
import { registerLibraryRoutes } from "../downloads/libraryRoutes.ts";
import { registerProfileRoutes } from "../downloads/profileRoutes.ts";
import { registerDownloadRoutes } from "../downloads/routes.ts";
import { registerEventRoutes, type EventHub } from "../downloads/sse.ts";
import { registerItemRoutes } from "../library/itemRoutes.ts";
import { registerPlaylistRoutes } from "../playlists/routes.ts";
import { linkPreviews } from "../sharing/previews.ts";
import { registerPublicRoutes } from "../sharing/publicRoutes.ts";
import { registerSharingRoutes } from "../sharing/routes.ts";
import { registerNotificationPrefRoutes } from "../push/prefsRoutes.ts";
import type { MediaStore } from "../storage/index.ts";
import { registerSubscriptionRoutes } from "../subscriptions/routes.ts";
import { registerPlaybackRoutes } from "../transcode/routes.ts";
import { oidcEndSessionUrl, registerOidcRoutes } from "../auth/oidc/routes.ts";
import type { OidcProvider } from "../auth/oidc/provider.ts";
import { registerSessionRoutes } from "../auth/sessionRoutes.ts";
import { registerTokenRoutes, resolveToken } from "../auth/tokens.ts";
import type { Database, TranscodeEncoder } from "../db/schema.ts";
import { disabledPush, type PushService } from "../push/service.ts";
import { registerDocs } from "./docs.ts";
import { ApiError, errorHandler, errorResponse } from "./errors.ts";
import { checkHealth, healthRoute, readyRoute } from "./health.ts";
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
  /**
   * Whether migrations ran and the database may be used. Until then readiness is 503 `starting`
   * and every route that needs the database 503 `unavailable`. Defaults to always.
   */
  attached?: () => boolean;
  /** Sign-in wiring; defaults suit `gen` and tests that only hit public routes. */
  auth?: AuthDeps;
  /** Download queues and limits; without them the download routes answer 503 (what `gen` uses). */
  downloads?: DownloadContext;
  /** Where media is stored; without it the file and thumbnail routes answer 503. */
  store?: MediaStore;
  /** The replica's download event subscription; without it the event stream answers 503. */
  downloadEvents?: EventHub;
  /** The encoder new playback copies are made with (`UROBOROS_TRANSCODE_HWACCEL`). */
  transcodeEncoder?: TranscodeEncoder;
}

export interface AuthDeps {
  /** Mark cookies `Secure` (the public base URL is https). */
  secureCookies: boolean;
  /** API-token lookup; defaults to the `api_tokens` table (tests may stub it). */
  resolveToken?: ResolveToken;
  /** Sign-in settings; defaults to local sign-in only (what `gen` documents). */
  settings?: AuthConfig;
  /** Valkey key prefix for the failed sign-in counters. */
  limiterPrefix?: string;
  /** The OIDC provider when `settings.oidc` is set. */
  oidc?: OidcProvider;
  /** For advisory locks on connections of their own (the claims sync); empty disables those routes' work. */
  databaseUrl?: string;
}

const DEFAULT_AUTH_SETTINGS: AuthConfig = {
  sessionTtlHours: 720,
  trustProxy: false,
  local: { enabled: true, bootstrap: null },
  oidc: null,
};

/** Stands in when OIDC is not configured: never ready, so its routes answer "unavailable". */
const noOidcProvider: OidcProvider = {
  settings: {
    issuer: "",
    clientId: "",
    clientSecret: "",
    displayName: "",
    adminGroups: [],
    groupsClaim: "groups",
    syncIntervalSecs: 0,
    redirectUrl: "",
  },
  ready: () => false,
  configuration: () => null,
  start: () => undefined,
};

/** What a replica serves before its database is attached: nothing here touches Postgres. */
function servedWhileStarting(path: string): boolean {
  return (
    path === "/api/health" ||
    path === "/api/ready" ||
    path === "/api/info" ||
    path === "/api/openapi.json" ||
    path === "/api/docs" ||
    path.startsWith("/api/docs/")
  );
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
  /** Origins the player may load media from besides the app's own (the S3 public URL). */
  mediaOrigins?: string[];
  /** `UROBOROS_PUBLIC_BASE_URL`: absolute links in public link previews (else the request's origin). */
  publicBaseUrl?: string | null;
}

function registerAuthRoutes(app: OpenAPIHono, deps: Deps, logger: Logger): void {
  const settings = deps.auth?.settings ?? DEFAULT_AUTH_SETTINGS;
  const secureCookies = deps.auth?.secureCookies ?? false;
  const provider = deps.auth?.oidc;
  const oidc = settings.oidc;
  registerSessionRoutes(app, {
    db: deps.db,
    settings,
    limiter: createLimiter(deps.valkey, deps.auth?.limiterPrefix ?? "uroboros"),
    secureCookies,
    oidcMethod: () =>
      oidc === null ? null : { displayName: oidc.displayName, ready: provider?.ready() ?? false },
    endSessionUrl: (userId) =>
      provider === undefined || oidc === null
        ? Promise.resolve(null)
        : oidcEndSessionUrl(deps.db, provider, new URL(oidc.redirectUrl).origin, userId),
  });
  registerTokenRoutes(app, deps.db);
  registerAccountRoutes(app, deps.db);
  registerAdminUserRoutes(app, {
    db: deps.db,
    provider: provider ?? noOidcProvider,
    databaseUrl: deps.auth?.databaseUrl ?? "",
    logger,
  });
  // Registered even without OIDC (answering "unavailable"), so the API document lists them.
  registerOidcRoutes(app, {
    db: deps.db,
    provider: provider ?? noOidcProvider,
    settings,
    secureCookies,
    logger,
  });
}

export function createApp(deps: Deps, opts: AppOptions): OpenAPIHono {
  const logger = deps.logger ?? pino({ name: "uroboros" });
  const app = new OpenAPIHono({
    defaultHook: (result) => {
      if (!result.success) throw new ApiError("bad_request", "invalid request");
    },
  });
  const spa =
    opts.webDist === null
      ? null
      : createSpaHandler(opts.webDist, linkPreviews(deps.db, opts.publicBaseUrl ?? null));
  const attached = deps.attached ?? (() => true);

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

  app.use("*", ...securityHeaders({ mediaOrigins: opts.mediaOrigins ?? [] }));
  app.use("/api/*", apiBodyLimit(opts.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES));

  app.use("/api/*", async (c: Context, next: Next) => {
    if (attached() || servedWhileStarting(c.req.path)) {
      await next();
      return;
    }
    return errorResponse(c, "unavailable", "the server is starting");
  });
  app.use(
    "/api/*",
    authGuard({ db: deps.db, resolveToken: deps.auth?.resolveToken ?? resolveToken }),
  );

  app.onError(errorHandler(logger));
  app.notFound(async (c) => {
    if (spa !== null && c.req.method === "GET" && !c.req.path.startsWith("/api/")) {
      const response = await spa(c.req.path, new URL(c.req.url).origin);
      if (response) return response;
    }
    return errorResponse(c, "not_found", "not found");
  });

  app.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));
  app.openapi(readyRoute, async (c) => {
    if (!attached()) return c.json({ status: "starting" as const, failing: [] }, 503);
    return c.json(await checkHealth(deps.db, deps.valkey), 200);
  });
  app.openapi(infoRoute, (c) => c.json({ name: "uroboros" as const, version: deps.version }, 200));
  registerAuthRoutes(app, deps, logger);
  registerProfileRoutes(app, deps.db);
  registerDownloadRoutes(app, deps.downloads);
  registerEventRoutes(app, deps.downloads, deps.downloadEvents);
  registerLibraryRoutes(app, deps.db, deps.store);
  registerItemRoutes(app, deps.db, deps.store);
  registerPlaylistRoutes(app, deps.db);
  registerSharingRoutes(app, deps.db, deps.downloads?.queues.notify);
  registerNotificationPrefRoutes(app, deps.db);
  registerSubscriptionRoutes(app, deps.downloads);
  const playback =
    deps.downloads === undefined
      ? undefined
      : { ...deps.downloads, encoder: deps.transcodeEncoder ?? "libx264" };
  registerPlaybackRoutes(app, playback, deps.store);
  registerPublicRoutes(app, deps.db, deps.store, playback);
  registerPushRoutes(app, deps.db, deps.push ?? disabledPush);
  app.doc("/api/openapi.json", openApiConfig(deps.version));
  registerDocs(app);

  return app;
}
