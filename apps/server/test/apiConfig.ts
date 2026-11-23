import { fileURLToPath } from "node:url";
import { pino } from "pino";
import type { Logger } from "pino";
import type { Config } from "../src/config.ts";
import { TestValkey } from "./testValkey.ts";

/** The repo's real migrations. */
export const MIGRATIONS = fileURLToPath(new URL("../../../migrations", import.meta.url));

/** A test fixture directory of migrations. */
export const fixtureMigrations = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** An api config on a free port against `databaseUrl` and the shared Valkey. */
export function apiConfig(databaseUrl: string, over: Partial<Config> = {}): Config {
  return {
    bind: { host: "127.0.0.1", port: 0 },
    databaseUrl,
    valkeyUrl: TestValkey.url(),
    webDist: null,
    bodyLimitBytes: 65_536,
    shutdownGraceMs: 20_000,
    dbStartupGraceSecs: 0,
    migrationsDir: MIGRATIONS,
    push: { publicBaseUrl: null, subject: null, vapid: null, allowedHosts: [], maxDevices: 10 },
    auth: {
      sessionTtlHours: 720,
      trustProxy: false,
      local: { enabled: true, bootstrap: null },
      oidc: null,
    },
    ...over,
  };
}

/** A logger that keeps every line it writes, parsed, for assertions on what was logged. */
export function recordingLogger(): { logger: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: "debug" },
    {
      write(line: string) {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  );
  return { logger, lines };
}
