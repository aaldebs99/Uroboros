import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { pino } from "pino";
import type { Logger } from "pino";
import pkg from "../../package.json" with { type: "json" };
import { ConfigError, loadConfig } from "../config.ts";
import type { Config } from "../config.ts";
import { createDb } from "../db/kysely.ts";
import { createValkey, waitReady } from "../shared/valkey.ts";
import { createApp } from "./app.ts";

export interface RunningApi {
  port: number;
  close(): Promise<void>;
}

/** Wires deps and starts listening. Installs no process handlers; the caller owns shutdown. */
export async function startApi(config: Config, logger: Logger): Promise<RunningApi> {
  const db = createDb(config.databaseUrl, logger);
  const valkey = createValkey(config.valkeyUrl, "api", logger);
  // Not fatal if Valkey is down at boot: health reports it as degraded.
  await waitReady(valkey, 2000);
  const app = createApp({ db, valkey, version: pkg.version, logger }, { webDist: config.webDist });
  const server = await new Promise<ServerType>((resolve) => {
    const s = serve(
      { fetch: app.fetch, hostname: config.bind.host, port: config.bind.port },
      () => {
        resolve(s);
      },
    );
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : config.bind.port;
  logger.info({ host: config.bind.host, port }, "api listening");
  return {
    port,
    async close() {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        if ("closeAllConnections" in server) server.closeAllConnections();
      });
      await db.destroy();
      valkey.disconnect();
    },
  };
}

/** Runs the API until SIGTERM/SIGINT; resolves with the exit code (0 clean, 1 failed shutdown, 2 config). */
export async function main(_argv: string[] = []): Promise<number> {
  const logger = pino({ name: "uroboros-api" });
  let config: Config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.fatal(err.message);
      return 2;
    }
    throw err;
  }
  const api = await startApi(config, logger);
  return new Promise<number>((resolve) => {
    const shutdown = (signal: string) => {
      logger.info({ signal }, "shutting down");
      api.close().then(
        () => {
          resolve(0);
        },
        (err: unknown) => {
          logger.error({ err }, "shutdown failed");
          resolve(1);
        },
      );
    };
    process.once("SIGTERM", () => {
      shutdown("SIGTERM");
    });
    process.once("SIGINT", () => {
      shutdown("SIGINT");
    });
  });
}
