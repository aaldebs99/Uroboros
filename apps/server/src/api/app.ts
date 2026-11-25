import { OpenAPIHono } from "@hono/zod-openapi";
import { UPLOAD_PART_BYTES } from "@uroboros/contract";
import type { Context, Next } from "hono";
import type { Kysely } from "kysely";
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
import { openApiConfig, registerSecuritySchemes } from "./openapiDoc.ts";
import { registerSharingRoutes } from "../sharing/routes.ts";
import { registerGroupRoutes } from "../groups/routes.ts";
import { registerNotificationPrefRoutes } from "../push/prefsRoutes.ts";
import type { StorageConfig } from "../storage/config.ts";
import type { MediaStore } from "../storage/index.ts";
import { registerUploadRoutes } from "../uploads/routes.ts";
import { registerExportRoutes, type ExportContext } from "../exports/routes.ts";
import { registerNoticeRoutes } from "../notices/routes.ts";
import { registerSettingsRoutes } from "../settings/routes.ts";
import { registerMcpRoute } from "../mcp/route.ts";
import { registerPreviewRoutes } from "../previews/routes.ts";
import type { UploadContext } from "../uploads/store.ts";
import { registerSubscriptionRoutes } from "../subscriptions/routes.ts";
import { registerSiteLoginRoutes } from "../siteLogins/routes.ts";
import type { PlaybackBus } from "../transcode/bus.ts";
import {
  registerPlaybackSessionRoutes,
  SEGMENT_WAIT_MS,
  type SessionContext,
} from "../transcode/sessionRoutes.ts";
import { oidcEndSessionUrl, registerOidcRoutes } from "../auth/oidc/routes.ts";
import type { OidcProvider } from "../auth/oidc/provider.ts";
import { registerSessionRoutes } from "../auth/sessionRoutes.ts";
import { registerTokenRoutes, resolveToken } from "../auth/tokens.ts";
import type { Database } from "../db/schema.ts";
import { disabledPush, type PushService } from "../push/service.ts";
import { registerDocs } from "./docs.ts";
import { ApiError, errorHandler, errorResponse } from "./errors.ts";
import { checkHealth, healthRoute, readyRoute } from "./health.ts";
import { infoRoute } from "./info.ts";
import { registerPushRoutes } from "./push.ts";
import { apiBodyLimit, DEFAULT_BODY_LIMIT_BYTES, securityHeaders } from "./security.ts";
import { loggedPath } from "./logPath.ts";
import { createSpaHandler } from "./spa.ts";

export interface Deps {
  db: Kysely<Database>;
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
  /** The replica's playback bus; without it (or downloads or a store) playback answers 503. */
  playbackBus?: PlaybackBus;
  /** How long a segment request waits for its runner (tests shorten it). */
  playbackWaitMs?: number;
  /** `UROBOROS_SECRETS_KEY`, for saved site logins; without it none can be saved. */
  secretsKey?: Buffer | null;
  /** The store's settings (upload keys follow its layout); without them uploads answer 503. */
  storage?: StorageConfig;
  /** An upload's part size; 8 MiB unless a test sends smaller parts. */
  uploadPartBytes?: number;
  /** Whether videos get hover previews (`UROBOROS_GENERATE_PREVIEWS`); on unless said. */
  generatePreviews?: boolean;
}

export interface AuthDeps {
  /** Mark cookies `Secure` (the public base URL is https). */
  secureCookies: boolean;
  /** API-token lookup; defaults to the `api_tokens` table (tests may stub it). */
  resolveToken?: ResolveToken;
  /** Sign-in settings; defaults to local sign-in only (what `gen` documents). */
  settings?: AuthConfig;
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
    autoCreate: false,
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

export interface AppOptions {
  webDist: string | null;
  /** The largest request body `/api/*` accepts. Default 64 KiB. */
  bodyLimitBytes?: number;
  /** Origins the player may load media from besides the app's own (the S3 public URL). */
  mediaOrigins?: string[];
  /** `UROBOROS_PUBLIC_BASE_URL`: absolute links in public link previews (else the request's origin). */
  publicBaseUrl?: string | null;
}

/** What uploads need; without downloads, a store or its settings they answer 503. */
function uploadContext(deps: Deps): UploadContext | undefined {
  if (deps.downloads === undefined || deps.store === undefined || deps.storage === undefined) {
    return undefined;
  }
  return {
    ...deps.downloads,
    store: deps.store,
    storage: deps.storage,
    partBytes: deps.uploadPartBytes ?? UPLOAD_PART_BYTES,
  };
}

/** What copies to save need; without downloads or a store they answer 503. */
function exportContext(deps: Deps): ExportContext | undefined {
  if (deps.downloads === undefined || deps.store === undefined) return undefined;
  return { ...deps.downloads, store: deps.store };
}

/** What playback sessions need; without downloads, a store or the bus they answer 503. */
function playbackContext(deps: Deps): SessionContext | undefined {
  if (deps.downloads === undefined || deps.store === undefined || deps.playbackBus === undefined) {
    return undefined;
  }
  return {
    ...deps.downloads,
    store: deps.store,
    bus: deps.playbackBus,
    waitMs: deps.playbackWaitMs ?? SEGMENT_WAIT_MS,
  };
}

function registerAuthRoutes(app: OpenAPIHono, deps: Deps, logger: Logger): void {
  const settings = deps.auth?.settings ?? DEFAULT_AUTH_SETTINGS;
  const secureCookies = deps.auth?.secureCookies ?? false;
  const provider = deps.auth?.oidc;
  const oidc = settings.oidc;
  registerSessionRoutes(app, {
    db: deps.db,
    settings,
    limiter: createLimiter(deps.db),
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
        path: loggedPath(c.req.path),
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
    return c.json(await checkHealth(deps.db), 200);
  });
  const info = {
    name: "uroboros" as const,
    version: deps.version,
    publicBaseUrl: opts.publicBaseUrl ?? null,
  };
  app.openapi(infoRoute, (c) => c.json(info, 200));
  registerAuthRoutes(app, deps, logger);
  registerProfileRoutes(app, deps.db);
  registerDownloadRoutes(app, deps.downloads);
  registerEventRoutes(app, deps.downloads, deps.downloadEvents);
  registerLibraryRoutes(app, deps.db, deps.store);
  registerItemRoutes(app, deps.db, deps.store, deps.storage, deps.downloads?.queues.probe);
  registerPlaylistRoutes(app, deps.db);
  registerSharingRoutes(app, deps.db, deps.downloads?.queues.notify);
  registerGroupRoutes(app, deps.db, deps.downloads?.queues.notify);
  registerNotificationPrefRoutes(app, deps.db);
  registerNoticeRoutes(app, deps.db);
  registerSettingsRoutes(app, deps.db);
  registerPreviewRoutes(app, deps.db, deps.generatePreviews);
  registerSiteLoginRoutes(app, deps.db, deps.secretsKey ?? null);
  registerSubscriptionRoutes(app, deps.downloads);
  registerUploadRoutes(app, uploadContext(deps));
  registerExportRoutes(app, exportContext(deps));
  const playback = playbackContext(deps);
  registerPlaybackSessionRoutes(app, playback);
  registerPublicRoutes(app, deps.db, deps.store, playback);
  registerPushRoutes(app, deps.db, deps.push ?? disabledPush);
  registerMcpRoute(app, { db: deps.db, downloads: deps.downloads, logger, version: deps.version });
  registerSecuritySchemes(app);
  app.doc("/api/openapi.json", openApiConfig(deps.version));
  registerDocs(app);

  return app;
}
