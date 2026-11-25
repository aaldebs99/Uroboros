import { generateVAPIDKeys } from "web-push";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, loadMigrateConfig, loadMigrationsDir } from "./config.ts";
import { DEFAULT_ALLOWED_HOSTS } from "./push/endpoint.ts";

const base = {
  DATABASE_URL: "postgres://u:p@h/db",
  UROBOROS_STORAGE: "filesystem",
  UROBOROS_STORAGE_ROOT: "/media",
  // The bootstrap admin a config without OIDC must have (auth/config.test.ts).
  UROBOROS_BOOTSTRAP_USERNAME: "admin",
  UROBOROS_BOOTSTRAP_PASSWORD: "correct horse battery",
};

describe("loadConfig", () => {
  it("lists every missing required var", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("needs no Valkey", () => {
    expect(() => loadConfig(base)).not.toThrow();
    expect(Object.keys(loadConfig(base))).not.toContain("valkeyUrl");
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

describe("loadConfig database startup", () => {
  it("waits for the database forever by default, and reads UROBOROS_DB_STARTUP_GRACE_SECS", () => {
    expect(loadConfig(base).dbStartupGraceSecs).toBe(0);
    expect(loadConfig({ ...base, UROBOROS_DB_STARTUP_GRACE_SECS: "" }).dbStartupGraceSecs).toBe(0);
    expect(loadConfig({ ...base, UROBOROS_DB_STARTUP_GRACE_SECS: "0" }).dbStartupGraceSecs).toBe(0);
    expect(loadConfig({ ...base, UROBOROS_DB_STARTUP_GRACE_SECS: "90" }).dbStartupGraceSecs).toBe(
      90,
    );
  });

  it.each(["-1", "1.5", "soon"])("rejects UROBOROS_DB_STARTUP_GRACE_SECS %j", (value) => {
    expect(() => loadConfig({ ...base, UROBOROS_DB_STARTUP_GRACE_SECS: value })).toThrow(
      /UROBOROS_DB_STARTUP_GRACE_SECS/,
    );
  });

  it("reads UROBOROS_MIGRATIONS_DIR for the migrations it applies on start", () => {
    expect(loadConfig(base).migrationsDir).toBeNull();
    expect(loadConfig({ ...base, UROBOROS_MIGRATIONS_DIR: "/app/migrations" }).migrationsDir).toBe(
      "/app/migrations",
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

describe("loadConfig job consumers", () => {
  it("defaults to 4 parallel downloads and yt-dlp on PATH", () => {
    expect(loadConfig(base).worker).toMatchObject({ concurrency: 4, ytdlpPath: "yt-dlp" });
  });

  it("reads YTDLP_PATH, treating an empty one as unset", () => {
    expect(loadConfig({ ...base, YTDLP_PATH: "/opt/yt-dlp/bin/yt-dlp" }).worker.ytdlpPath).toBe(
      "/opt/yt-dlp/bin/yt-dlp",
    );
    expect(loadConfig({ ...base, YTDLP_PATH: "" }).worker.ytdlpPath).toBe("yt-dlp");
  });

  it("reads UROBOROS_WORKER_CONCURRENCY, treating an empty one as unset", () => {
    expect(loadConfig({ ...base, UROBOROS_WORKER_CONCURRENCY: "8" }).worker.concurrency).toBe(8);
    expect(loadConfig({ ...base, UROBOROS_WORKER_CONCURRENCY: "" }).worker.concurrency).toBe(4);
  });

  it.each(["0", "-1", "2.5", "abc", "4 "])("rejects concurrency %j", (bad) => {
    expect(() => loadConfig({ ...base, UROBOROS_WORKER_CONCURRENCY: bad })).toThrow(ConfigError);
  });
});

describe("loadConfig transcoding", () => {
  it("defaults to two sessions at a time on the CPU", () => {
    expect(loadConfig(base).worker.transcode).toEqual({
      concurrency: 2,
      hwaccel: "none",
      vaapiDevice: "/dev/dri/renderD128",
    });
  });

  it("reads the transcode settings, 0 meaning none", () => {
    expect(
      loadConfig({
        ...base,
        UROBOROS_TRANSCODE_CONCURRENCY: "0",
        UROBOROS_TRANSCODE_HWACCEL: "nvenc",
      }).worker.transcode,
    ).toMatchObject({ concurrency: 0, hwaccel: "nvenc" });
  });

  it("takes VA-API with its render node", () => {
    expect(
      loadConfig({
        ...base,
        UROBOROS_TRANSCODE_HWACCEL: "vaapi",
        UROBOROS_TRANSCODE_VAAPI_DEVICE: "/dev/dri/renderD129",
      }).worker.transcode,
    ).toMatchObject({ hwaccel: "vaapi", vaapiDevice: "/dev/dri/renderD129" });
  });

  it.each([
    ["UROBOROS_TRANSCODE_CONCURRENCY", "-1"],
    ["UROBOROS_TRANSCODE_HWACCEL", "qsv"],
    ["UROBOROS_TRANSCODE_VAAPI_DEVICE", "renderD128"],
    ["UROBOROS_GENERATE_PREVIEWS", "no"],
  ])("rejects %s=%j", (name, bad) => {
    expect(() => loadConfig({ ...base, [name]: bad })).toThrow(ConfigError);
  });

  it("makes hover previews unless UROBOROS_GENERATE_PREVIEWS is false", () => {
    expect(loadConfig(base).worker.generatePreviews).toBe(true);
    expect(loadConfig({ ...base, UROBOROS_GENERATE_PREVIEWS: "" }).worker.generatePreviews).toBe(
      true,
    );
    expect(
      loadConfig({ ...base, UROBOROS_GENERATE_PREVIEWS: "false" }).worker.generatePreviews,
    ).toBe(false);
  });
});

describe("loadConfig MCP server", () => {
  it("runs the MCP server unless UROBOROS_MCP_ENABLED is false", () => {
    expect(loadConfig(base).mcpEnabled).toBe(true);
    expect(loadConfig({ ...base, UROBOROS_MCP_ENABLED: "" }).mcpEnabled).toBe(true);
    expect(loadConfig({ ...base, UROBOROS_MCP_ENABLED: "true" }).mcpEnabled).toBe(true);
    expect(loadConfig({ ...base, UROBOROS_MCP_ENABLED: "false" }).mcpEnabled).toBe(false);
  });

  it("names UROBOROS_MCP_ENABLED when it is neither true nor false", () => {
    expect(() => loadConfig({ ...base, UROBOROS_MCP_ENABLED: "yes" })).toThrow(
      /UROBOROS_MCP_ENABLED must be true or false/,
    );
  });
});

describe("loadConfig secrets key", () => {
  const key = Buffer.alloc(32, 7).toString("base64");

  it("leaves saving site logins off without UROBOROS_SECRETS_KEY, or with an empty one", () => {
    expect(loadConfig(base).secretsKey).toBeNull();
    expect(loadConfig({ ...base, UROBOROS_SECRETS_KEY: "" }).secretsKey).toBeNull();
  });

  it("decodes 32 bytes of base64", () => {
    expect(loadConfig({ ...base, UROBOROS_SECRETS_KEY: key }).secretsKey).toEqual(
      Buffer.alloc(32, 7),
    );
  });

  it.each(["short", Buffer.alloc(16).toString("base64"), Buffer.alloc(48).toString("base64")])(
    "refuses %j",
    (value) => {
      expect(() => loadConfig({ ...base, UROBOROS_SECRETS_KEY: value })).toThrow(
        /UROBOROS_SECRETS_KEY/,
      );
    },
  );
});
