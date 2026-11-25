import { z } from "zod";

/** Sign-in settings (docs/auth.md). */
export interface AuthConfig {
  /** Fixed session lifetime. */
  sessionTtlHours: number;
  /** Read the client IP from `X-Forwarded-For` (behind an ingress or Caddy). */
  trustProxy: boolean;
  local: {
    enabled: boolean;
    /** The admin re-seeded on every start; null when unset. */
    /** `weak`: shorter than the minimum, allowed by UROBOROS_ALLOW_WEAK_BOOTSTRAP_PASSWORD (dev only). */
    bootstrap: { username: string; password: string; weak: boolean } | null;
  };
  oidc: OidcConfig | null;
}

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** The provider's name on the sign-in button. */
  displayName: string;
  /** Members of any of these groups are admins. */
  adminGroups: string[];
  /** The ID-token claim holding the groups. */
  groupsClaim: string;
  /** How old an SSO user's claims may get before the sync refreshes them; 0 turns sync off. */
  syncIntervalSecs: number;
  /** `<public base URL>/api/auth/oidc/callback`. */
  redirectUrl: string;
}

/** The shortest password Uroboros accepts, local accounts and the bootstrap admin alike. */
import { MIN_PASSWORD_CHARS } from "@uroboros/contract";
export { MIN_PASSWORD_CHARS };

const DEFAULT_SESSION_TTL_HOURS = 720;
const DEFAULT_SYNC_INTERVAL_SECS = 900;
const MIN_SYNC_INTERVAL_SECS = 60;

const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const flag = (name: string, fallback: boolean) =>
  z
    .preprocess(
      (v) => (v === "" || v === undefined ? String(fallback) : v),
      z.enum(["true", "false"], { error: `${name} must be true or false` }),
    )
    .transform((v) => v === "true");

const positiveInt = (name: string, fallback: number) =>
  z
    .preprocess(
      (v) => (v === "" || v === undefined ? String(fallback) : v),
      z.string().regex(/^[1-9]\d*$/, `${name} must be a positive integer`),
    )
    .transform(Number);

export const authEnvSchema = z.object({
  UROBOROS_SESSION_TTL_HOURS: positiveInt("UROBOROS_SESSION_TTL_HOURS", DEFAULT_SESSION_TTL_HOURS),
  UROBOROS_TRUST_PROXY: flag("UROBOROS_TRUST_PROXY", false),
  UROBOROS_LOCAL_LOGIN: flag("UROBOROS_LOCAL_LOGIN", true),
  UROBOROS_BOOTSTRAP_USERNAME: optional,
  UROBOROS_BOOTSTRAP_PASSWORD: optional,
  UROBOROS_ALLOW_WEAK_BOOTSTRAP_PASSWORD: flag("UROBOROS_ALLOW_WEAK_BOOTSTRAP_PASSWORD", false),
  UROBOROS_OIDC_ISSUER: optional,
  UROBOROS_OIDC_CLIENT_ID: optional,
  UROBOROS_OIDC_CLIENT_SECRET: optional,
  UROBOROS_OIDC_DISPLAY_NAME: optional,
  UROBOROS_OIDC_ADMIN_GROUPS: optional,
  UROBOROS_OIDC_GROUPS_CLAIM: optional,
  UROBOROS_OIDC_SYNC_INTERVAL_SECS: z.preprocess(
    (v) => (v === "" || v === undefined ? String(DEFAULT_SYNC_INTERVAL_SECS) : v),
    z
      .string()
      .regex(/^(0|[1-9]\d*)$/, "UROBOROS_OIDC_SYNC_INTERVAL_SECS must be a whole number of seconds")
      .transform(Number)
      .refine(
        (n) => n === 0 || n >= MIN_SYNC_INTERVAL_SECS,
        `UROBOROS_OIDC_SYNC_INTERVAL_SECS must be 0 (off) or at least ${String(MIN_SYNC_INTERVAL_SECS)}`,
      ),
  ),
});

type AuthEnv = z.output<typeof authEnvSchema>;

const OIDC_VARS = [
  "UROBOROS_OIDC_ISSUER",
  "UROBOROS_OIDC_CLIENT_ID",
  "UROBOROS_OIDC_CLIENT_SECRET",
] as const;

type Problem = [string, string];

/** The bootstrap pair's own rules: both or neither, the password's length, the username's shape. */
function bootstrapProblems(env: AuthEnv): Problem[] {
  const problems: Problem[] = [];
  const user = env.UROBOROS_BOOTSTRAP_USERNAME;
  const pass = env.UROBOROS_BOOTSTRAP_PASSWORD;
  if ((user === undefined) !== (pass === undefined)) {
    problems.push([
      user === undefined ? "UROBOROS_BOOTSTRAP_USERNAME" : "UROBOROS_BOOTSTRAP_PASSWORD",
      "UROBOROS_BOOTSTRAP_USERNAME and UROBOROS_BOOTSTRAP_PASSWORD are set together or not at all",
    ]);
  }
  if (
    pass !== undefined &&
    pass.length < MIN_PASSWORD_CHARS &&
    !env.UROBOROS_ALLOW_WEAK_BOOTSTRAP_PASSWORD
  ) {
    problems.push([
      "UROBOROS_BOOTSTRAP_PASSWORD",
      `UROBOROS_BOOTSTRAP_PASSWORD must be at least ${String(MIN_PASSWORD_CHARS)} characters (UROBOROS_ALLOW_WEAK_BOOTSTRAP_PASSWORD=true allows less, for local dev stacks only)`,
    ]);
  }
  if (user !== undefined && !/^[a-z0-9._-]{1,64}$/.test(user.trim().toLowerCase())) {
    problems.push([
      "UROBOROS_BOOTSTRAP_USERNAME",
      "UROBOROS_BOOTSTRAP_USERNAME must be 1–64 of a-z 0-9 . _ -",
    ]);
  }
  return problems;
}

/** OIDC's rules: all three variables or none, and a public base URL for the callback. */
function oidcProblems(env: AuthEnv, publicBaseUrl: string | undefined): Problem[] {
  const setOidc = OIDC_VARS.filter((name) => env[name] !== undefined);
  if (setOidc.length === 0) return [];
  if (setOidc.length < OIDC_VARS.length) {
    return OIDC_VARS.filter((n) => env[n] === undefined).map((name) => [
      name,
      `${name} is required with the other UROBOROS_OIDC_* settings`,
    ]);
  }
  return publicBaseUrl === undefined
    ? [["UROBOROS_PUBLIC_BASE_URL", "UROBOROS_PUBLIC_BASE_URL is required for OIDC sign-in"]]
    : [];
}

/**
 * Without OIDC, local sign-in is the only way in, and the bootstrap admin the only first admin: a
 * fresh install has no other account, and there is no account CLI. With OIDC the provider's groups
 * make the admins, so the bootstrap admin is optional.
 */
function signInProblems(env: AuthEnv): Problem[] {
  if (OIDC_VARS.some((name) => env[name] !== undefined)) return [];
  if (!env.UROBOROS_LOCAL_LOGIN) {
    return [["UROBOROS_LOCAL_LOGIN", "no sign-in method: enable local login or configure OIDC"]];
  }
  if (
    env.UROBOROS_BOOTSTRAP_USERNAME === undefined &&
    env.UROBOROS_BOOTSTRAP_PASSWORD === undefined
  ) {
    return [
      [
        "UROBOROS_BOOTSTRAP_USERNAME",
        "UROBOROS_BOOTSTRAP_USERNAME and UROBOROS_BOOTSTRAP_PASSWORD are required without OIDC: local sign-in needs a first admin",
      ],
    ];
  }
  return [];
}

/** Cross-variable rules; each problem is `[variable, message]`. */
export function authEnvProblems(env: AuthEnv, publicBaseUrl: string | undefined): Problem[] {
  return [...bootstrapProblems(env), ...oidcProblems(env, publicBaseUrl), ...signInProblems(env)];
}

/** Builds `AuthConfig` from an env that already passed `authEnvSchema` and `authEnvProblems`. */
export function toAuthConfig(env: AuthEnv, publicBaseUrl: string | undefined): AuthConfig {
  const user = env.UROBOROS_BOOTSTRAP_USERNAME;
  const pass = env.UROBOROS_BOOTSTRAP_PASSWORD;
  const issuer = env.UROBOROS_OIDC_ISSUER;
  const clientId = env.UROBOROS_OIDC_CLIENT_ID;
  const clientSecret = env.UROBOROS_OIDC_CLIENT_SECRET;
  const oidc =
    issuer !== undefined &&
    clientId !== undefined &&
    clientSecret !== undefined &&
    publicBaseUrl !== undefined
      ? {
          issuer,
          clientId,
          clientSecret,
          displayName: env.UROBOROS_OIDC_DISPLAY_NAME ?? "Authentik",
          adminGroups: (env.UROBOROS_OIDC_ADMIN_GROUPS ?? "authentik Admins")
            .split(",")
            .map((g) => g.trim())
            .filter((g) => g !== ""),
          groupsClaim: env.UROBOROS_OIDC_GROUPS_CLAIM ?? "groups",
          syncIntervalSecs: env.UROBOROS_OIDC_SYNC_INTERVAL_SECS,
          redirectUrl: `${publicBaseUrl}/api/auth/oidc/callback`,
        }
      : null;
  return {
    sessionTtlHours: env.UROBOROS_SESSION_TTL_HOURS,
    trustProxy: env.UROBOROS_TRUST_PROXY,
    local: {
      enabled: env.UROBOROS_LOCAL_LOGIN,
      bootstrap:
        user !== undefined && pass !== undefined
          ? {
              username: user.trim().toLowerCase(),
              password: pass,
              weak: pass.length < MIN_PASSWORD_CHARS,
            }
          : null,
    },
    oidc,
  };
}
