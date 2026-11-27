import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { authEnvProblems, authEnvSchema, toAuthConfig, type AuthConfig } from "./auth/config.ts";
import { DEFAULT_ALLOWED_HOSTS } from "./push/endpoint.ts";
import { vapidPairProblem } from "./push/keys.ts";
import { secretsKeyFrom } from "./secrets/key.ts";
import {
  storageEnvProblems,
  storageEnvSchema,
  toDownloadLimits,
  toStorageConfig,
  type DownloadLimits,
  type StorageConfig,
} from "./storage/config.ts";
import { DEFAULT_MAX_DEVICES, type PushSettings } from "./push/service.ts";

/** Thrown for a bad environment; the message lists every offending variable. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export interface Config {
  bind: { host: string; port: number };
  databaseUrl: string;
  webDist: string | null;
  /** The largest request body `/api/*` accepts. */
  bodyLimitBytes: number;
  /** How long a SIGTERM waits for in-flight requests before cutting them. */
  shutdownGraceMs: number;
  /** How long start-up retries an unreachable database, in seconds; 0 waits forever. */
  dbStartupGraceSecs: number;
  /** The migrations applied on start: `UROBOROS_MIGRATIONS_DIR`, absolute; null is the repo's. */
  migrationsDir: string | null;
  /** Web Push (docs/push.md); on only with an https `publicBaseUrl`. */
  push: PushSettings;
  /** Sign-in: sessions, local accounts, OIDC (docs/auth.md). */
  auth: AuthConfig;
  /** Where media is stored (docs/downloads.md). */
  storage: StorageConfig;
  downloads: DownloadLimits;
  /** The job consumers' settings (probe, download, notify): yt-dlp, scratch space, concurrency. */
  worker: WorkerSettings;
  /**
   * The 32-byte key saved site logins are sealed with (`src/secrets/seal.ts`), made from the
   * `UROBOROS_SECRETS_KEY` passphrase (`src/secrets/key.ts`); null leaves saving logins off.
   */
  secretsKey: Buffer | null;
  /**
   * Whether the MCP server answers at `/api/mcp` (`UROBOROS_MCP_ENABLED`, on unless false;
   * docs/mcp.md), read at start. Off, `/api/mcp` answers 404 and no token can be made for MCP.
   */
  mcpEnabled: boolean;
  /**
   * Whether people can make clips of their videos, to save or share (`UROBOROS_CLIPS_ENABLED`, on
   * unless false; docs/sharing.md#clips), read at start. Off, new clips and clip shares are refused
   * and clip links stop working; copies already made still save.
   */
  clipsEnabled: boolean;
}

/** What the manual migrate command needs: the database and where the SQL files are. */
export interface MigrateConfig {
  databaseUrl: string;
  /** `UROBOROS_MIGRATIONS_DIR`, absolute; null means the repo root's `migrations/`. */
  migrationsDir: string | null;
}

/** How this process's job consumers run yt-dlp and how many jobs they take at once. */
export interface WorkerSettings {
  /**
   * Scratch space for downloads in progress (`UROBOROS_WORK_DIR`; unset, a folder in the library
   * with filesystem storage, a temp folder with S3; docs/downloads.md "Scratch space").
   */
  workDir: string;
  /** Subtitles captured with each download: yt-dlp `--sub-langs` (null: none), and auto captions. */
  subtitles: { langs: string | null; automatic: boolean };
  /** Parallel download jobs per process. */
  concurrency: number;
  /** The yt-dlp to run: `YTDLP_PATH` (set in the image), else `yt-dlp` on PATH. */
  ytdlpPath: string;
  /** Playback sessions (docs/transcoding.md). */
  transcode: {
    /** Sessions run at once by this process (`UROBOROS_TRANSCODE_CONCURRENCY`; 0: none here). */
    concurrency: number;
    /** This replica's GPU (`UROBOROS_TRANSCODE_HWACCEL`): `none`, `nvenc` or `vaapi`. */
    hwaccel: "none" | "nvenc" | "vaapi";
    /** The VA-API render node (`UROBOROS_TRANSCODE_VAAPI_DEVICE`). */
    vaapiDevice: string;
    /** The tallest encode, on the short side (`UROBOROS_TRANSCODE_MAX_HEIGHT`, a rung). */
    maxShort: number;
  };
  /**
   * Whether videos get hover preview clips (`UROBOROS_GENERATE_PREVIEWS`, on by default): off, none
   * are made, new or backfilled; those already made still play.
   */
  generatePreviews: boolean;
  /**
   * How a hover preview is made (`UROBOROS_PREVIEW_METHOD`): `download`, a 480p copy fetched from
   * the video's site (the default), or `transcode`, encoded from the stored file. Ignored while
   * `generatePreviews` is off.
   */
  previewMethod: "download" | "transcode";
}

const DEFAULT_WORKER_CONCURRENCY = 4;
const DEFAULT_SUBTITLE_LANGS = "en.*";

const DEFAULT_BIND = "127.0.0.1:18081";
const DEFAULT_SHUTDOWN_GRACE_MS = 20_000;
const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;
/** Wait for the database as long as it takes. */
const DEFAULT_DB_STARTUP_GRACE_SECS = 0;

const bindSchema = z.string().transform((value, ctx) => {
  const idx = value.lastIndexOf(":");
  const host = value.slice(0, idx).replace(/^\[(.*)\]$/, "$1");
  const portText = value.slice(idx + 1);
  const port = Number(portText);
  if (idx < 1 || !/^\d+$/.test(portText) || port < 1 || port > 65535) {
    ctx.addIssue({ code: "custom", message: `expected host:port, got "${value}"` });
    return z.NEVER;
  }
  return { host, port };
});

const required = (name: string) =>
  z.string({ error: `${name} is required` }).min(1, `${name} is required`);

/** An optional variable where an empty value means unset, as `${VAR:-}` in compose passes one. */
const unsetIfEmpty = <S extends z.ZodType>(schema: S) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const nonNegativeInt = (name: string) =>
  z
    .string()
    .regex(/^(0|[1-9]\d*)$/, `${name} must be a whole number of seconds, 0 or more`)
    .transform(Number)
    .pipe(z.number().int());

const positiveInt = (name: string) =>
  z
    .string()
    .regex(/^[1-9]\d*$/, `${name} must be a positive integer`)
    .transform(Number)
    .pipe(z.number().int());

/**
 * The public origin (scheme, host and port), without a trailing slash: push builds every URL from
 * it, so a path would be silently dropped or doubled. http is kept (push then stays off).
 */
const publicBaseUrl = z
  .url({ protocol: /^https?$/, error: "UROBOROS_PUBLIC_BASE_URL must be an http(s) URL" })
  .refine((value) => {
    if (!URL.canParse(value)) return true; // reported by z.url above
    const url = new URL(value);
    return (
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === "" &&
      !/[?#]/.test(value)
    );
  }, "UROBOROS_PUBLIC_BASE_URL must be an origin only (https://host[:port]), with no path, query or credentials")
  .transform((value) => new URL(value).origin)
  .optional();

const pushSubject = z
  .string()
  .refine(
    (value) =>
      /^mailto:[^@\s]+@[^@\s]+$/.test(value) ||
      (URL.canParse(value) && value.startsWith("https://")),
    "UROBOROS_PUSH_SUBJECT must be a mailto: address or an https: URL",
  )
  .optional();

const allowedHosts = z
  .string()
  .transform((value) => value.split(",").map((host) => host.trim().toLowerCase()))
  .refine(
    (hosts) => hosts.every((host) => /^[a-z0-9.-]+$/.test(host)),
    "UROBOROS_PUSH_ALLOWED_HOSTS must be a comma-separated list of host names, none empty",
  )
  .optional();

/** The job consumers' variables. */
const workerEnvSchema = z.object({
  UROBOROS_WORK_DIR: unsetIfEmpty(z.string().optional()),
  UROBOROS_WORKER_CONCURRENCY: unsetIfEmpty(
    positiveInt("UROBOROS_WORKER_CONCURRENCY").prefault(String(DEFAULT_WORKER_CONCURRENCY)),
  ),
  YTDLP_PATH: unsetIfEmpty(z.string().optional()),
  // Unset: English; empty: no subtitles (so this one is not unsetIfEmpty). At most 190 characters,
  // so the ",-.*-orig" automatic captions add stays within yt-dlp's allowlist (worker/subtitles.ts).
  UROBOROS_SUBTITLE_LANGS: z
    .string()
    .regex(
      /^$|^[\w.,*+\-!^$|()]{1,190}$/,
      "UROBOROS_SUBTITLE_LANGS must be yt-dlp --sub-langs values, comma-separated",
    )
    .optional(),
  UROBOROS_AUTO_SUBTITLES: unsetIfEmpty(
    z
      .enum(["true", "false"], { error: "UROBOROS_AUTO_SUBTITLES must be true or false" })
      .optional(),
  ),
  UROBOROS_GENERATE_PREVIEWS: unsetIfEmpty(
    z
      .enum(["true", "false"], { error: "UROBOROS_GENERATE_PREVIEWS must be true or false" })
      .optional(),
  ),
  UROBOROS_PREVIEW_METHOD: unsetIfEmpty(
    z
      .enum(["download", "transcode"], {
        error: "UROBOROS_PREVIEW_METHOD must be download or transcode",
      })
      .prefault("download"),
  ),
  UROBOROS_MCP_ENABLED: unsetIfEmpty(
    z.enum(["true", "false"], { error: "UROBOROS_MCP_ENABLED must be true or false" }).optional(),
  ),
  UROBOROS_CLIPS_ENABLED: unsetIfEmpty(
    z.enum(["true", "false"], { error: "UROBOROS_CLIPS_ENABLED must be true or false" }).optional(),
  ),
  UROBOROS_TRANSCODE_CONCURRENCY: unsetIfEmpty(
    z
      .string()
      .regex(/^(0|[1-9]\d*)$/, "UROBOROS_TRANSCODE_CONCURRENCY must be 0 or a positive integer")
      .transform(Number)
      .prefault("10"),
  ),
  UROBOROS_TRANSCODE_HWACCEL: unsetIfEmpty(
    z
      .enum(["none", "nvenc", "vaapi"], {
        error: "UROBOROS_TRANSCODE_HWACCEL must be none, nvenc or vaapi",
      })
      .prefault("none"),
  ),
  UROBOROS_TRANSCODE_VAAPI_DEVICE: unsetIfEmpty(
    z
      .string()
      .regex(/^\//, "UROBOROS_TRANSCODE_VAAPI_DEVICE must be an absolute path (a render node)")
      .prefault("/dev/dri/renderD128"),
  ),
  UROBOROS_TRANSCODE_MAX_HEIGHT: unsetIfEmpty(
    z
      .enum(["2160", "1440", "1080", "720", "480", "360"], {
        error: "UROBOROS_TRANSCODE_MAX_HEIGHT must be 2160, 1440, 1080, 720, 480 or 360",
      })
      .transform(Number)
      .prefault("2160"),
  ),
});

/** Any passphrase of 8 or more characters, made into the 32-byte key by `secretsKeyFrom`. */
const secretsKey = z
  .string()
  .min(
    8,
    "UROBOROS_SECRETS_KEY must be at least 8 characters (openssl rand -hex 32 makes a strong one)",
  )
  .transform(secretsKeyFrom)
  .optional();

const configSchema = z
  .object({
    UROBOROS_BIND: bindSchema.prefault(DEFAULT_BIND),
    DATABASE_URL: required("DATABASE_URL"),
    UROBOROS_WEB_DIST: z.string().min(1).optional(),
    UROBOROS_BODY_LIMIT_BYTES: unsetIfEmpty(
      positiveInt("UROBOROS_BODY_LIMIT_BYTES").prefault(String(DEFAULT_BODY_LIMIT_BYTES)),
    ),
    UROBOROS_SHUTDOWN_GRACE_MS: unsetIfEmpty(
      positiveInt("UROBOROS_SHUTDOWN_GRACE_MS").prefault(String(DEFAULT_SHUTDOWN_GRACE_MS)),
    ),
    UROBOROS_DB_STARTUP_GRACE_SECS: unsetIfEmpty(
      nonNegativeInt("UROBOROS_DB_STARTUP_GRACE_SECS").prefault(
        String(DEFAULT_DB_STARTUP_GRACE_SECS),
      ),
    ),
    UROBOROS_PUBLIC_BASE_URL: unsetIfEmpty(publicBaseUrl),
    UROBOROS_PUSH_SUBJECT: unsetIfEmpty(pushSubject),
    UROBOROS_VAPID_PUBLIC_KEY: unsetIfEmpty(z.string().optional()),
    UROBOROS_VAPID_PRIVATE_KEY: unsetIfEmpty(z.string().optional()),
    UROBOROS_PUSH_ALLOWED_HOSTS: unsetIfEmpty(allowedHosts),
    UROBOROS_PUSH_MAX_DEVICES: unsetIfEmpty(
      positiveInt("UROBOROS_PUSH_MAX_DEVICES").prefault(String(DEFAULT_MAX_DEVICES)),
    ),
    UROBOROS_SECRETS_KEY: unsetIfEmpty(secretsKey),
    ...authEnvSchema.shape,
    ...storageEnvSchema.shape,
    ...workerEnvSchema.shape,
  })
  .superRefine((env, ctx) => {
    for (const [path, message] of storageEnvProblems(env)) {
      ctx.addIssue({ code: "custom", path: [path], message });
    }
    for (const [path, message] of authEnvProblems(env, env.UROBOROS_PUBLIC_BASE_URL)) {
      ctx.addIssue({ code: "custom", path: [path], message });
    }
    const pub = env.UROBOROS_VAPID_PUBLIC_KEY;
    const priv = env.UROBOROS_VAPID_PRIVATE_KEY;
    if (pub === undefined && priv === undefined) return;
    if (pub === undefined || priv === undefined) {
      const missing =
        pub === undefined ? "UROBOROS_VAPID_PUBLIC_KEY" : "UROBOROS_VAPID_PRIVATE_KEY";
      ctx.addIssue({
        code: "custom",
        path: [missing],
        message: `${missing} is required with its pair`,
      });
      return;
    }
    const problem = vapidPairProblem(pub, priv);
    if (problem !== null) {
      ctx.addIssue({ code: "custom", path: ["UROBOROS_VAPID_PRIVATE_KEY"], message: problem });
    }
  });

const migrationsDirSchema = z.object({
  UROBOROS_MIGRATIONS_DIR: unsetIfEmpty(z.string().optional()),
});

const migrateSchema = z.object({
  DATABASE_URL: required("DATABASE_URL"),
  ...migrationsDirSchema.shape,
});

function parse<S extends z.ZodType>(schema: S, env: NodeJS.ProcessEnv): z.output<S> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`invalid configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

/** The scratch folder for downloads in progress (docs/downloads.md "Scratch space"). */
function workDirOf(set: string | undefined, storage: StorageConfig): string {
  if (set !== undefined) return set;
  // On the library's own disk, a finished file is renamed into place rather than copied.
  return storage.kind === "filesystem"
    ? join(storage.root, ".uroboros-work")
    : join(tmpdir(), "uroboros-work");
}

/** Full configuration for the server process (HTTP and the job consumers). */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const e = parse(configSchema, env);
  const storage = toStorageConfig(e);
  return {
    bind: e.UROBOROS_BIND,
    databaseUrl: e.DATABASE_URL,
    webDist: e.UROBOROS_WEB_DIST ?? null,
    bodyLimitBytes: e.UROBOROS_BODY_LIMIT_BYTES,
    shutdownGraceMs: e.UROBOROS_SHUTDOWN_GRACE_MS,
    dbStartupGraceSecs: e.UROBOROS_DB_STARTUP_GRACE_SECS,
    migrationsDir: loadMigrationsDir(env),
    push: {
      publicBaseUrl: e.UROBOROS_PUBLIC_BASE_URL ?? null,
      subject: e.UROBOROS_PUSH_SUBJECT ?? null,
      vapid:
        e.UROBOROS_VAPID_PUBLIC_KEY !== undefined && e.UROBOROS_VAPID_PRIVATE_KEY !== undefined
          ? { publicKey: e.UROBOROS_VAPID_PUBLIC_KEY, privateKey: e.UROBOROS_VAPID_PRIVATE_KEY }
          : null,
      allowedHosts: e.UROBOROS_PUSH_ALLOWED_HOSTS ?? [...DEFAULT_ALLOWED_HOSTS],
      maxDevices: e.UROBOROS_PUSH_MAX_DEVICES,
    },
    auth: toAuthConfig(e, e.UROBOROS_PUBLIC_BASE_URL),
    storage,
    downloads: toDownloadLimits(e),
    worker: {
      workDir: workDirOf(e.UROBOROS_WORK_DIR, storage),
      subtitles: {
        langs:
          e.UROBOROS_SUBTITLE_LANGS === undefined
            ? DEFAULT_SUBTITLE_LANGS
            : e.UROBOROS_SUBTITLE_LANGS || null,
        automatic: e.UROBOROS_AUTO_SUBTITLES !== "false",
      },
      concurrency: e.UROBOROS_WORKER_CONCURRENCY,
      ytdlpPath: e.YTDLP_PATH ?? "yt-dlp",
      transcode: {
        concurrency: e.UROBOROS_TRANSCODE_CONCURRENCY,
        hwaccel: e.UROBOROS_TRANSCODE_HWACCEL,
        vaapiDevice: e.UROBOROS_TRANSCODE_VAAPI_DEVICE,
        maxShort: e.UROBOROS_TRANSCODE_MAX_HEIGHT,
      },
      generatePreviews: e.UROBOROS_GENERATE_PREVIEWS !== "false",
      previewMethod: e.UROBOROS_PREVIEW_METHOD,
    },
    secretsKey: e.UROBOROS_SECRETS_KEY ?? null,
    mcpEnabled: e.UROBOROS_MCP_ENABLED !== "false",
    clipsEnabled: e.UROBOROS_CLIPS_ENABLED !== "false",
  };
}

/** `UROBOROS_MIGRATIONS_DIR`, made absolute; null when unset (the repo root's `migrations/`). */
export function loadMigrationsDir(env: NodeJS.ProcessEnv): string | null {
  const dir = parse(migrationsDirSchema, env).UROBOROS_MIGRATIONS_DIR;
  return dir === undefined ? null : resolve(dir);
}

/** Configuration for the manual migrate command, which needs only the database. */
export function loadMigrateConfig(env: NodeJS.ProcessEnv): MigrateConfig {
  const e = parse(migrateSchema, env);
  return { databaseUrl: e.DATABASE_URL, migrationsDir: loadMigrationsDir(env) };
}
