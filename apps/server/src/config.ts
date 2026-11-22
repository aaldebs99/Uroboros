import { z } from "zod";

/** Thrown for a bad environment; the message lists every offending variable. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export interface Config {
  bind: { host: string; port: number };
  databaseUrl: string;
  valkeyUrl: string;
  webDist: string | null;
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

const configSchema = z.object({
  UROBOROS_BIND: bindSchema.prefault(DEFAULT_BIND),
  DATABASE_URL: required("DATABASE_URL"),
  VALKEY_URL: required("VALKEY_URL"),
  UROBOROS_WEB_DIST: z.string().min(1).optional(),
});

const migrateSchema = z.object({ DATABASE_URL: required("DATABASE_URL") });

const workerSchema = z.object({
  VALKEY_URL: required("VALKEY_URL"),
  UROBOROS_WORKER_CONCURRENCY: z
    .string()
    .regex(/^[1-9]\d*$/, "UROBOROS_WORKER_CONCURRENCY must be a positive integer")
    .transform(Number)
    .pipe(z.number().int())
    .prefault(String(DEFAULT_WORKER_CONCURRENCY)),
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
