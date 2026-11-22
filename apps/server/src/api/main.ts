import { Server } from "node:http";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { pino } from "pino";
import type { Logger } from "pino";
import pkg from "../../package.json" with { type: "json" };
import { ConfigError, loadConfig } from "../config.ts";
import type { Config } from "../config.ts";
import { createDb } from "../db/kysely.ts";
import { createPushService } from "../push/service.ts";
import { createValkey, waitReady } from "../shared/valkey.ts";
import { createApp } from "./app.ts";

/** How often a draining server closes the keep-alive connections that have gone idle. */
const IDLE_SWEEP_MS = 100;

export interface RunningApi {
  port: number;
  /**
   * Stops accepting connections, closes idle ones and waits up to `shutdownGraceMs` for in-flight
   * requests. If they outlast it, cuts every connection and rejects, after releasing the database
   * and Valkey either way, so the caller can exit non-zero.
   */
  close(): Promise<void>;
}

/** Test seams. */
export interface StartApiOptions {
  /** Adds routes to the app before it listens (a slow route for the shutdown tests). */
  configure?: (app: OpenAPIHono) => void;
}

/** Resolves true once `server` has closed, false if connections remain after `graceMs`. */
async function drain(server: ServerType, graceMs: number): Promise<boolean> {
  const closed = new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  if (!(server instanceof Server)) {
    await closed;
    return true;
  }
  // close() alone leaves keep-alive connections open until their idle timeout. Closing the idle
  // ones now, and again as in-flight requests finish, lets the server close as soon as the last
  // response is written.
  server.closeIdleConnections();
  const sweep = setInterval(() => {
    server.closeIdleConnections();
  }, IDLE_SWEEP_MS);
  let deadline: NodeJS.Timeout | undefined;
  const expired = new Promise<"timeout">((resolve) => {
    deadline = setTimeout(() => {
      resolve("timeout");
    }, graceMs);
  });
  try {
    if ((await Promise.race([closed.then(() => "closed" as const), expired])) === "closed") {
      return true;
    }
    server.closeAllConnections();
    await closed;
    return false;
  } finally {
    clearInterval(sweep);
    clearTimeout(deadline);
  }
}

/** Wires deps and starts listening. Installs no process handlers; the caller owns shutdown. */
export async function startApi(
  config: Config,
  logger: Logger,
  opts: StartApiOptions = {},
): Promise<RunningApi> {
  const db = createDb(config.databaseUrl, logger);
  const valkey = createValkey(config.valkeyUrl, "api", logger);
  // Not fatal if Valkey is down at boot: health reports it as degraded.
  await waitReady(valkey, 2000);
  const push = createPushService(config.push, db, logger);
  const app = createApp(
    { db, valkey, version: pkg.version, logger, push },
    { webDist: config.webDist },
  );
  opts.configure?.(app);
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
  let closing: Promise<void> | undefined;
  const closeOnce = async () => {
    let drained: boolean;
    try {
      drained = await drain(server, config.shutdownGraceMs);
    } finally {
      await db.destroy();
      valkey.disconnect();
    }
    if (!drained) {
      throw new Error(
        `api did not drain within ${String(config.shutdownGraceMs)} ms; connections cut`,
      );
    }
  };
  return {
    port,
    close() {
      closing ??= closeOnce();
      return closing;
    },
  };
}

/**
 * Waits for SIGTERM or SIGINT, then closes `api`. Resolves 0 once it drained, 1 if the drain
 * timed out or failed. The listeners are removed once either signal arrives.
 */
export async function runUntilSignal(api: RunningApi, logger: Logger): Promise<number> {
  const signal = await new Promise<string>((resolve) => {
    const onTerm = () => {
      done("SIGTERM");
    };
    const onInt = () => {
      done("SIGINT");
    };
    const done = (name: string) => {
      process.off("SIGTERM", onTerm);
      process.off("SIGINT", onInt);
      resolve(name);
    };
    process.once("SIGTERM", onTerm);
    process.once("SIGINT", onInt);
  });
  logger.info({ signal }, "shutting down");
  try {
    await api.close();
    return 0;
  } catch (err) {
    logger.error({ err }, "shutdown failed");
    return 1;
  }
}

/**
 * Runs the API until SIGTERM/SIGINT; resolves with the exit code (0 clean, 1 failed or timed-out
 * drain, 2 config). bin/api.ts exits the process with it.
 */
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
  return runUntilSignal(api, logger);
}
