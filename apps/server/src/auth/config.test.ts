import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../config.ts";

const base = { DATABASE_URL: "postgres://u:p@h/db", VALKEY_URL: "redis://h:6379" };
const oidc = {
  UROBOROS_PUBLIC_BASE_URL: "https://uro.example",
  UROBOROS_OIDC_ISSUER: "https://sso.example/application/o/uroboros/",
  UROBOROS_OIDC_CLIENT_ID: "uroboros",
  UROBOROS_OIDC_CLIENT_SECRET: "s3cret",
};

describe("auth config", () => {
  it("defaults: local login on, no bootstrap, no OIDC, 720 h sessions, proxy untrusted", () => {
    expect(loadConfig(base).auth).toEqual({
      sessionTtlHours: 720,
      trustProxy: false,
      local: { enabled: true, bootstrap: null },
      oidc: null,
    });
  });

  it("needs both bootstrap variables or neither, naming both", () => {
    const run = () => loadConfig({ ...base, UROBOROS_BOOTSTRAP_USERNAME: "admin" });
    expect(run).toThrow(ConfigError);
    expect(run).toThrow(/UROBOROS_BOOTSTRAP_USERNAME[\s\S]*UROBOROS_BOOTSTRAP_PASSWORD/);
  });

  it("reads the bootstrap pair, lower-casing the username", () => {
    const cfg = loadConfig({
      ...base,
      UROBOROS_BOOTSTRAP_USERNAME: " Admin ",
      UROBOROS_BOOTSTRAP_PASSWORD: "correct horse battery",
    });
    expect(cfg.auth.local.bootstrap).toEqual({
      username: "admin",
      password: "correct horse battery",
    });
  });

  it("refuses a bootstrap password shorter than 12 characters", () => {
    expect(() =>
      loadConfig({
        ...base,
        UROBOROS_BOOTSTRAP_USERNAME: "admin",
        UROBOROS_BOOTSTRAP_PASSWORD: "short",
      }),
    ).toThrow(/UROBOROS_BOOTSTRAP_PASSWORD/);
  });

  it("reads OIDC with its defaults and the callback URL", () => {
    expect(loadConfig({ ...base, ...oidc }).auth.oidc).toEqual({
      issuer: oidc.UROBOROS_OIDC_ISSUER,
      clientId: "uroboros",
      clientSecret: "s3cret",
      displayName: "Authentik",
      adminGroups: ["authentik Admins"],
      groupsClaim: "groups",
      syncIntervalSecs: 900,
      redirectUrl: "https://uro.example/api/auth/oidc/callback",
    });
  });

  it("needs all OIDC variables or none", () => {
    const run = () => loadConfig({ ...base, UROBOROS_OIDC_ISSUER: oidc.UROBOROS_OIDC_ISSUER });
    expect(run).toThrow(/UROBOROS_OIDC_CLIENT_ID/);
    expect(run).toThrow(/UROBOROS_OIDC_CLIENT_SECRET/);
  });

  it("needs the public base URL for OIDC", () => {
    const { UROBOROS_PUBLIC_BASE_URL: _drop, ...rest } = oidc;
    expect(() => loadConfig({ ...base, ...rest })).toThrow(/UROBOROS_PUBLIC_BASE_URL/);
  });

  it("splits admin groups on commas and trims them", () => {
    const cfg = loadConfig({
      ...base,
      ...oidc,
      UROBOROS_OIDC_ADMIN_GROUPS: " ops , media admins ",
    });
    expect(cfg.auth.oidc?.adminGroups).toEqual(["ops", "media admins"]);
  });

  it("allows sync interval 0 (off) and refuses 1–59", () => {
    expect(
      loadConfig({ ...base, ...oidc, UROBOROS_OIDC_SYNC_INTERVAL_SECS: "0" }).auth.oidc
        ?.syncIntervalSecs,
    ).toBe(0);
    expect(() => loadConfig({ ...base, ...oidc, UROBOROS_OIDC_SYNC_INTERVAL_SECS: "30" })).toThrow(
      /UROBOROS_OIDC_SYNC_INTERVAL_SECS/,
    );
  });

  it("refuses a config with no sign-in method", () => {
    expect(() => loadConfig({ ...base, UROBOROS_LOCAL_LOGIN: "false" })).toThrow(
      /no sign-in method/,
    );
    expect(loadConfig({ ...base, ...oidc, UROBOROS_LOCAL_LOGIN: "false" }).auth.local.enabled).toBe(
      false,
    );
  });

  it("reads the session TTL and proxy trust", () => {
    const auth = loadConfig({
      ...base,
      UROBOROS_SESSION_TTL_HOURS: "24",
      UROBOROS_TRUST_PROXY: "true",
    }).auth;
    expect(auth.sessionTtlHours).toBe(24);
    expect(auth.trustProxy).toBe(true);
    expect(() => loadConfig({ ...base, UROBOROS_TRUST_PROXY: "yes" })).toThrow(
      /UROBOROS_TRUST_PROXY/,
    );
  });
});
