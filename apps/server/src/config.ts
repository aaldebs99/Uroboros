import { z } from "zod";
import { DEFAULT_ALLOWED_HOSTS } from "./push/endpoint.ts";
import { vapidPairProblem } from "./push/keys.ts";
import { DEFAULT_MAX_DEVICES, type PushSettings } from "./push/service.ts";

/** Thrown for a bad environment; the message lists every offending variable. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export interface Config {
  bind: { host: string; port: number };
  databaseUrl: string;
  valkeyUrl: string;
  webDist: string | null;
  /** The largest request body `/api/*` accepts. */
  bodyLimitBytes: number;
  /** How long a SIGTERM waits for in-flight requests before cutting them. */
  shutdownGraceMs: number;
  /** Web Push (docs/push.md); on only with an https `publicBaseUrl`. */
  push: PushSettings;
}

/** What the standalone migrate Job needs: the database and nothing else. */
export interface MigrateConfig {
  databaseUrl: string;
}

/** What the worker needs for now: Valkey. It gains `databaseUrl` when job processors need it. */
export interface WorkerConfig {
  valkeyUrl: string;
  /** Parallel jobs per worker process. */
  concurrency: number;
}

const DEFAULT_WORKER_CONCURRENCY = 4;

const DEFAULT_BIND = "127.0.0.1:18081";
const DEFAULT_SHUTDOWN_GRACE_MS = 20_000;
const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;

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

const configSchema = z
  .object({
    UROBOROS_BIND: bindSchema.prefault(DEFAULT_BIND),
    DATABASE_URL: required("DATABASE_URL"),
    VALKEY_URL: required("VALKEY_URL"),
    UROBOROS_WEB_DIST: z.string().min(1).optional(),
    UROBOROS_BODY_LIMIT_BYTES: unsetIfEmpty(
      positiveInt("UROBOROS_BODY_LIMIT_BYTES").prefault(String(DEFAULT_BODY_LIMIT_BYTES)),
    ),
    UROBOROS_SHUTDOWN_GRACE_MS: unsetIfEmpty(
      positiveInt("UROBOROS_SHUTDOWN_GRACE_MS").prefault(String(DEFAULT_SHUTDOWN_GRACE_MS)),
    ),
    UROBOROS_PUBLIC_BASE_URL: unsetIfEmpty(publicBaseUrl),
    UROBOROS_PUSH_SUBJECT: unsetIfEmpty(pushSubject),
    UROBOROS_VAPID_PUBLIC_KEY: unsetIfEmpty(z.string().optional()),
    UROBOROS_VAPID_PRIVATE_KEY: unsetIfEmpty(z.string().optional()),
    UROBOROS_PUSH_ALLOWED_HOSTS: unsetIfEmpty(allowedHosts),
    UROBOROS_PUSH_MAX_DEVICES: unsetIfEmpty(
      positiveInt("UROBOROS_PUSH_MAX_DEVICES").prefault(String(DEFAULT_MAX_DEVICES)),
    ),
  })
  .superRefine((env, ctx) => {
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

const migrateSchema = z.object({ DATABASE_URL: required("DATABASE_URL") });

const workerSchema = z.object({
  VALKEY_URL: required("VALKEY_URL"),
  UROBOROS_WORKER_CONCURRENCY: positiveInt("UROBOROS_WORKER_CONCURRENCY").prefault(
    String(DEFAULT_WORKER_CONCURRENCY),
  ),
});

function parse<S extends z.ZodType>(schema: S, env: NodeJS.ProcessEnv): z.output<S> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`invalid configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

/** Full configuration for the api and worker processes. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const e = parse(configSchema, env);
  return {
    bind: e.UROBOROS_BIND,
    databaseUrl: e.DATABASE_URL,
    valkeyUrl: e.VALKEY_URL,
    webDist: e.UROBOROS_WEB_DIST ?? null,
    bodyLimitBytes: e.UROBOROS_BODY_LIMIT_BYTES,
    shutdownGraceMs: e.UROBOROS_SHUTDOWN_GRACE_MS,
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
  };
}

/** Configuration for the migrate Job, which has no use for Valkey. */
export function loadMigrateConfig(env: NodeJS.ProcessEnv): MigrateConfig {
  return { databaseUrl: parse(migrateSchema, env).DATABASE_URL };
}

/** Configuration for the worker process. */
export function loadWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const e = parse(workerSchema, env);
  return { valkeyUrl: e.VALKEY_URL, concurrency: e.UROBOROS_WORKER_CONCURRENCY };
}
