import { isAbsolute } from "node:path";
import { z } from "zod";

/** The tokens a filesystem layout may use (docs/downloads.md). */
export const LAYOUT_TOKENS = [
  "channel",
  "uploader",
  "title",
  "id",
  "extractor",
  "upload_date",
  "year",
  "profile",
  "ext",
] as const;
export type LayoutToken = (typeof LAYOUT_TOKENS)[number];

export const DEFAULT_LAYOUT = "{channel}/{upload_date} {title} [{id}]/{title} [{profile}].{ext}";

export type StorageConfig =
  | {
      kind: "s3";
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle: boolean;
      /** The endpoint browsers can reach; set, the file route redirects to presigned URLs. */
      publicUrl: string | null;
    }
  | { kind: "filesystem"; root: string; layout: string };

export interface DownloadLimits {
  /** Downloads of one person dispatched to the download queue at once. */
  maxActivePerUser: number;
  /** Entries kept per preview group. */
  maxPlaylistEntries: number;
}

const DEFAULT_MAX_ACTIVE_PER_USER = 3;
const DEFAULT_MAX_PLAYLIST_ENTRIES = 1000;

const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const positive = (name: string, fallback: number) =>
  z
    .preprocess(
      (v) => (v === "" || v === undefined ? String(fallback) : v),
      z.string().regex(/^[1-9]\d*$/, `${name} must be a positive integer`),
    )
    .transform(Number);

export const storageEnvSchema = z.object({
  UROBOROS_STORAGE: z.enum(["s3", "filesystem"], {
    error: "UROBOROS_STORAGE must be s3 or filesystem",
  }),
  UROBOROS_S3_ENDPOINT: optional,
  UROBOROS_S3_REGION: optional,
  UROBOROS_S3_BUCKET: optional,
  UROBOROS_S3_ACCESS_KEY_ID: optional,
  UROBOROS_S3_SECRET_ACCESS_KEY: optional,
  UROBOROS_S3_FORCE_PATH_STYLE: z
    .preprocess(
      (v) => (v === "" || v === undefined ? "true" : v),
      z.enum(["true", "false"], { error: "UROBOROS_S3_FORCE_PATH_STYLE must be true or false" }),
    )
    .transform((v) => v === "true"),
  UROBOROS_S3_PUBLIC_URL: optional,
  UROBOROS_STORAGE_ROOT: optional,
  UROBOROS_STORAGE_LAYOUT: optional,
  UROBOROS_MAX_ACTIVE_DOWNLOADS_PER_USER: positive(
    "UROBOROS_MAX_ACTIVE_DOWNLOADS_PER_USER",
    DEFAULT_MAX_ACTIVE_PER_USER,
  ),
  UROBOROS_MAX_PLAYLIST_ENTRIES: positive(
    "UROBOROS_MAX_PLAYLIST_ENTRIES",
    DEFAULT_MAX_PLAYLIST_ENTRIES,
  ),
});

type StorageEnv = z.output<typeof storageEnvSchema>;

const S3_REQUIRED = [
  "UROBOROS_S3_ENDPOINT",
  "UROBOROS_S3_BUCKET",
  "UROBOROS_S3_ACCESS_KEY_ID",
  "UROBOROS_S3_SECRET_ACCESS_KEY",
] as const;

function isHttpUrl(value: string): boolean {
  return URL.canParse(value) && /^https?:$/.test(new URL(value).protocol);
}

function layoutProblems(layout: string): string[] {
  const known = new Set<string>(LAYOUT_TOKENS);
  const unknown = [...layout.matchAll(/\{([^}]*)\}/g)]
    .map((m) => m[1] ?? "")
    .filter((t) => !known.has(t));
  const problems = unknown.map(
    (t) =>
      `UROBOROS_STORAGE_LAYOUT has an unknown token {${t}} (known: ${LAYOUT_TOKENS.join(", ")})`,
  );
  for (const needed of ["{id}", "{profile}", "{ext}"]) {
    // Without these, two videos or two profiles could be stored on one path.
    if (!layout.includes(needed)) problems.push(`UROBOROS_STORAGE_LAYOUT must use ${needed}`);
  }
  return problems;
}

/** Cross-variable rules; each problem is `[variable, message]`. */
export function storageEnvProblems(env: StorageEnv): [string, string][] {
  const problems: [string, string][] = [];
  if (env.UROBOROS_STORAGE === "s3") {
    for (const name of S3_REQUIRED) {
      if (env[name] === undefined) problems.push([name, `${name} is required for S3 storage`]);
    }
    for (const name of ["UROBOROS_S3_ENDPOINT", "UROBOROS_S3_PUBLIC_URL"] as const) {
      const value = env[name];
      if (value !== undefined && !isHttpUrl(value)) {
        problems.push([name, `${name} must be an http(s) URL`]);
      }
    }
    return problems;
  }
  const root = env.UROBOROS_STORAGE_ROOT;
  if (root === undefined || !isAbsolute(root)) {
    problems.push([
      "UROBOROS_STORAGE_ROOT",
      "UROBOROS_STORAGE_ROOT must be an absolute path for filesystem storage",
    ]);
  }
  for (const message of layoutProblems(env.UROBOROS_STORAGE_LAYOUT ?? DEFAULT_LAYOUT)) {
    problems.push(["UROBOROS_STORAGE_LAYOUT", message]);
  }
  return problems;
}

/** Builds `StorageConfig` from an env that passed `storageEnvSchema` and `storageEnvProblems`. */
export function toStorageConfig(env: StorageEnv): StorageConfig {
  if (env.UROBOROS_STORAGE === "filesystem") {
    return {
      kind: "filesystem",
      root: env.UROBOROS_STORAGE_ROOT ?? "",
      layout: env.UROBOROS_STORAGE_LAYOUT ?? DEFAULT_LAYOUT,
    };
  }
  return {
    kind: "s3",
    endpoint: env.UROBOROS_S3_ENDPOINT ?? "",
    region: env.UROBOROS_S3_REGION ?? "us-east-1",
    bucket: env.UROBOROS_S3_BUCKET ?? "",
    accessKeyId: env.UROBOROS_S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.UROBOROS_S3_SECRET_ACCESS_KEY ?? "",
    forcePathStyle: env.UROBOROS_S3_FORCE_PATH_STYLE,
    publicUrl: env.UROBOROS_S3_PUBLIC_URL ?? null,
  };
}

export function toDownloadLimits(env: StorageEnv): DownloadLimits {
  return {
    maxActivePerUser: env.UROBOROS_MAX_ACTIVE_DOWNLOADS_PER_USER,
    maxPlaylistEntries: env.UROBOROS_MAX_PLAYLIST_ENTRIES,
  };
}
