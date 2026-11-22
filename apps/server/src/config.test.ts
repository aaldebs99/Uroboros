import { generateVAPIDKeys } from "web-push";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, loadMigrateConfig, loadMigrationsDir } from "./config.ts";
import { DEFAULT_ALLOWED_HOSTS } from "./push/endpoint.ts";

const base = { DATABASE_URL: "postgres://u:p@h/db", VALKEY_URL: "redis://h:6379" };

describe("loadConfig", () => {
  it("lists every missing required var", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(
      /DATABASE_URL[\s\S]*VALKEY_URL|VALKEY_URL[\s\S]*DATABASE_URL/,
    );
  });

  it("parses a bind address", () => {
    const cfg = loadConfig({ ...base, UROBOROS_BIND: "0.0.0.0:9000" });
    expect(cfg.bind).toEqual({ host: "0.0.0.0", port: 9000 });
  });

  it("defaults the bind to 127.0.0.1:18081 and webDist to null", () => {
    const cfg = loadConfig(base);
    expect(cfg.bind).toEqual({ host: "127.0.0.1", port: 18081 });
    expect(cfg.webDist).toBeNull();
    expect(cfg.databaseUrl).toBe(base.DATABASE_URL);
    expect(cfg.valkeyUrl).toBe(base.VALKEY_URL);
  });

  it("reads UROBOROS_WEB_DIST", () => {
    expect(loadConfig({ ...base, UROBOROS_WEB_DIST: "/srv/web" }).webDist).toBe("/srv/web");
  });

  it.each(["nope", "host:0", "host:70000", "host:abc", ":80"])("rejects bind %j", (bind) => {
    expect(() => loadConfig({ ...base, UROBOROS_BIND: bind })).toThrow(/UROBOROS_BIND/);
  });
});

describe("loadConfig shutdown grace", () => {
  it("defaults to 20 s", () => {
    expect(loadConfig(base).shutdownGraceMs).toBe(20_000);
  });

  it("reads UROBOROS_SHUTDOWN_GRACE_MS", () => {
    expect(loadConfig({ ...base, UROBOROS_SHUTDOWN_GRACE_MS: "5000" }).shutdownGraceMs).toBe(5000);
  });

  it.each(["0", "-1", "1.5", "abc"])("rejects %j", (value) => {
    expect(() => loadConfig({ ...base, UROBOROS_SHUTDOWN_GRACE_MS: value })).toThrow(
      /UROBOROS_SHUTDOWN_GRACE_MS/,
    );
  });
});

describe("loadConfig body limit", () => {
  it("defaults to 64 KiB and reads UROBOROS_BODY_LIMIT_BYTES", () => {
    expect(loadConfig(base).bodyLimitBytes).toBe(65_536);
    expect(loadConfig({ ...base, UROBOROS_BODY_LIMIT_BYTES: "1024" }).bodyLimitBytes).toBe(1024);
  });

  it.each(["0", "64k", "-5"])("rejects %j", (value) => {
    expect(() => loadConfig({ ...base, UROBOROS_BODY_LIMIT_BYTES: value })).toThrow(
      /UROBOROS_BODY_LIMIT_BYTES/,
    );
  });
});

describe("loadMigrateConfig", () => {
  it("needs only DATABASE_URL", () => {
    expect(loadMigrateConfig({ DATABASE_URL: base.DATABASE_URL })).toEqual({
      databaseUrl: base.DATABASE_URL,
      migrationsDir: null,
    });
  });

  it("reads UROBOROS_MIGRATIONS_DIR as an absolute path", () => {
    const env = { DATABASE_URL: base.DATABASE_URL, UROBOROS_MIGRATIONS_DIR: "/app/migrations" };
    expect(loadMigrateConfig(env).migrationsDir).toBe("/app/migrations");
    expect(loadMigrationsDir({ UROBOROS_MIGRATIONS_DIR: "/app/migrations" })).toBe(
      "/app/migrations",
    );
    expect(loadMigrationsDir({})).toBeNull();
  });

  it("throws ConfigError without it", () => {
    expect(() => loadMigrateConfig({})).toThrow(/DATABASE_URL/);
  });
});

describe("loadConfig push", () => {
  const pair = generateVAPIDKeys();

  it("defaults to push off with the known push services and 10 devices", () => {
    expect(loadConfig(base).push).toEqual({
      publicBaseUrl: null,
      subject: null,
      vapid: null,
      allowedHosts: [...DEFAULT_ALLOWED_HOSTS],
      maxDevices: 10,
    });
  });

  it("reads every push variable", () => {
    const cfg = loadConfig({
      ...base,
      UROBOROS_PUBLIC_BASE_URL: "https://uroboros.example/",
      UROBOROS_PUSH_SUBJECT: "mailto:ops@uroboros.example",
      UROBOROS_VAPID_PUBLIC_KEY: pair.publicKey,
      UROBOROS_VAPID_PRIVATE_KEY: pair.privateKey,
      UROBOROS_PUSH_ALLOWED_HOSTS: " fcm.googleapis.com, Push.Apple.com ",
      UROBOROS_PUSH_MAX_DEVICES: "3",
    });
    expect(cfg.push).toEqual({
      publicBaseUrl: "https://uroboros.example",
      subject: "mailto:ops@uroboros.example",
      vapid: pair,
      allowedHosts: ["fcm.googleapis.com", "push.apple.com"],
      maxDevices: 3,
    });
  });

  it("keeps an http base URL (push then stays off) but refuses one that is not a URL", () => {
    expect(
      loadConfig({ ...base, UROBOROS_PUBLIC_BASE_URL: "http://h:18080" }).push.publicBaseUrl,
    ).toBe("http://h:18080");
    expect(() => loadConfig({ ...base, UROBOROS_PUBLIC_BASE_URL: "nope" })).toThrow(
      /UROBOROS_PUBLIC_BASE_URL/,
    );
    expect(() => loadConfig({ ...base, UROBOROS_PUBLIC_BASE_URL: "ftp://h" })).toThrow(
      /UROBOROS_PUBLIC_BASE_URL/,
    );
  });

  it.each([
    "https://h.example/uroboros",
    "https://h.example/app/",
    "https://h.example/?x=1",
    "https://h.example/#top",
    "https://user:pw@h.example",
  ])("refuses a base URL that is more than an origin (%j)", (url) => {
    expect(() => loadConfig({ ...base, UROBOROS_PUBLIC_BASE_URL: url })).toThrow(
      /UROBOROS_PUBLIC_BASE_URL must be an origin/,
    );
  });

  it.each(["http://ops.example", "ops@example.com", "mailto:"])("refuses the subject %j", (s) => {
    expect(() => loadConfig({ ...base, UROBOROS_PUSH_SUBJECT: s })).toThrow(
      /UROBOROS_PUSH_SUBJECT/,
    );
  });

  it("needs both VAPID halves, of one pair", () => {
    expect(() => loadConfig({ ...base, UROBOROS_VAPID_PRIVATE_KEY: pair.privateKey })).toThrow(
      /UROBOROS_VAPID_PUBLIC_KEY/,
    );
    expect(() => loadConfig({ ...base, UROBOROS_VAPID_PUBLIC_KEY: pair.publicKey })).toThrow(
      /UROBOROS_VAPID_PRIVATE_KEY/,
    );
    expect(() =>
      loadConfig({
        ...base,
        UROBOROS_VAPID_PUBLIC_KEY: generateVAPIDKeys().publicKey,
        UROBOROS_VAPID_PRIVATE_KEY: pair.privateKey,
      }),
    ).toThrow(/not the public half/);
  });

  it.each(["0", "-1", "x", "1.5"])("refuses UROBOROS_PUSH_MAX_DEVICES=%j", (n) => {
    expect(() => loadConfig({ ...base, UROBOROS_PUSH_MAX_DEVICES: n })).toThrow(
      /UROBOROS_PUSH_MAX_DEVICES/,
    );
  });

  it("treats an empty push variable as unset, as compose passes one", () => {
    const empty = Object.fromEntries(
      [
        "UROBOROS_PUBLIC_BASE_URL",
        "UROBOROS_PUSH_SUBJECT",
        "UROBOROS_VAPID_PUBLIC_KEY",
        "UROBOROS_VAPID_PRIVATE_KEY",
        "UROBOROS_PUSH_ALLOWED_HOSTS",
        "UROBOROS_PUSH_MAX_DEVICES",
      ].map((name) => [name, ""]),
    );
    expect(loadConfig({ ...base, ...empty }).push).toEqual(loadConfig(base).push);
  });

  it.each([" , ", "fcm.googleapis.com,,x", "a b"])(
    "refuses UROBOROS_PUSH_ALLOWED_HOSTS=%j",
    (h) => {
      expect(() => loadConfig({ ...base, UROBOROS_PUSH_ALLOWED_HOSTS: h })).toThrow(
        /UROBOROS_PUSH_ALLOWED_HOSTS/,
      );
    },
  );
});
