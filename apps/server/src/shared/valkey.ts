import { Redis } from "ioredis";
import { pino } from "pino";
import type { Logger } from "pino";

/**
 * How long the api waits for any one Valkey reply. Without it, a server that vanishes without
 * closing the connection leaves every command pending until the OS gives up on the socket.
 */
export const API_COMMAND_TIMEOUT_MS = 5000;

/**
 * Builds a Valkey client. The `api` role fails fast (no offline queue, one retry per request, a
 * reply within `API_COMMAND_TIMEOUT_MS`) so an outage surfaces as an error instead of a hang; the
 * `worker` role uses `maxRetriesPerRequest:
 * null`, which BullMQ requires. Both log connection errors instead of raising them as unhandled
 * 'error' events. The caller owns the client and must `quit()` or `disconnect()` it.
 */
export function createValkey(
  url: string,
  role: "api" | "worker",
  log: Logger = pino({ name: "valkey" }),
): Redis {
  const client =
    role === "api"
      ? new Redis(url, {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          lazyConnect: false,
          commandTimeout: API_COMMAND_TIMEOUT_MS,
          keepAlive: 10_000,
        })
      : new Redis(url, { maxRetriesPerRequest: null });
  client.on("error", (err: Error) => {
    log.error({ err, role }, "valkey error");
  });
  return client;
}

/** Resolves true once the client is ready, false if it is not within `ms`. Never rejects. */
export async function waitReady(client: Redis, ms: number): Promise<boolean> {
  if (client.status === "ready") return true;
  return await new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      client.off("ready", onReady);
      resolve(ok);
    };
    const onReady = () => {
      done(true);
    };
    const timer = setTimeout(() => {
      done(false);
    }, ms);
    client.once("ready", onReady);
  });
}
