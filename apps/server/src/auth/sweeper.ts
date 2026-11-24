import type { Kysely } from "kysely";
import type { Logger } from "pino";
import type { Database } from "../db/schema.ts";
import { sweepExpiredProgress } from "../downloads/events.ts";
import { sweepExpiredRequests } from "../downloads/requests.ts";
import { sweepOldNotices } from "../notices/store.ts";
import { sweepExpiredFailures } from "./limiter.ts";
import { sweepExpired } from "./sessions.ts";

export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The leader's duty: delete expired sessions, pending OIDC logins, unfinished download previews,
 * stale download progress, ended sign-in windows and notices older than a month, at once, then
 * hourly, until leadership ends (`signal` aborts).
 */
export function sweeperDuty(db: Kysely<Database>, logger: Logger) {
  return async (signal: AbortSignal): Promise<void> => {
    const sweep = async () => {
      try {
        const removed = await sweepExpired(db);
        if (removed > 0) logger.info({ removed }, "swept expired sessions and sign-ins");
        const previews = await sweepExpiredRequests(db);
        if (previews > 0) logger.info({ previews }, "swept expired download previews");
        await sweepExpiredProgress(db);
        await sweepExpiredFailures(db);
        const notices = await sweepOldNotices(db);
        if (notices > 0) logger.info({ notices }, "swept old notices");
      } catch (err) {
        logger.warn({ err }, "sweeping expired sessions failed");
      }
    };
    await sweep();
    // Leadership may have ended during the first sweep: an abort that already fired never
    // reaches a listener added now.
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      const every = setInterval(() => {
        void sweep();
      }, SWEEP_INTERVAL_MS);
      signal.addEventListener(
        "abort",
        () => {
          clearInterval(every);
          resolve();
        },
        { once: true },
      );
    });
  };
}
