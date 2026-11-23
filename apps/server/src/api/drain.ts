import { Server } from "node:http";
import type { ServerType } from "@hono/node-server";
import { withDeadline } from "../shared/deadline.ts";

/** How often a draining server closes the keep-alive connections that have gone idle. */
const IDLE_SWEEP_MS = 100;

/**
 * The bound on everything after the drain: closing the cut connections, giving up leadership,
 * ending the pool and Valkey. A database gone silent would otherwise hold `db.destroy()` until
 * every checked-out client's 30 s query timeout, well past the container's stop timeout.
 */
export const CLEANUP_MS = 2000;

/** Resolves true once `server` has closed, false if connections remain after `graceMs`. */
export async function drain(server: ServerType, graceMs: number): Promise<boolean> {
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
  try {
    await withDeadline(closed, graceMs, "drain");
    return true;
  } catch {
    server.closeAllConnections();
    // The sockets are destroyed; their close events are all that is left, but never wait on
    // them unbounded.
    await withDeadline(closed, CLEANUP_MS, "close after cut").catch(() => undefined);
    return false;
  } finally {
    clearInterval(sweep);
  }
}

/** True once `work` settled within `ms`, false if it is still running then. Never rejects. */
export async function settlesWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  try {
    await withDeadline(
      work.catch(() => undefined),
      ms,
      "cleanup",
    );
    return true;
  } catch {
    return false;
  }
}
