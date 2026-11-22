import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, loadMigrateConfig } from "./config.ts";

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

describe("loadMigrateConfig", () => {
  it("needs only DATABASE_URL", () => {
    expect(loadMigrateConfig({ DATABASE_URL: base.DATABASE_URL })).toEqual({
      databaseUrl: base.DATABASE_URL,
    });
  });

  it("throws ConfigError without it", () => {
    expect(() => loadMigrateConfig({})).toThrow(/DATABASE_URL/);
  });
});
