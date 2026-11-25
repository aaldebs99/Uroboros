import { basename, dirname } from "node:path";
import { downloadSubtitles, YtDlpError } from "@uroboros/ytdlp";
import type { SubtitlesJob } from "../downloads/queues.ts";
import {
  activeCooldown,
  clearRateLimit,
  noteRateLimit,
  requeueDelay,
  siteOf,
} from "../downloads/rateLimits.ts";
import { RequeueError } from "../jobs/errors.ts";
import type { WorkerDeps } from "./deps.ts";
import { withLoginsOf } from "./logins.ts";
import { ytdlpOptions } from "./probe.ts";
import { openScratch } from "./scratch.ts";
import { storeSubtitles, SUBTITLE_FAILED, subtitleArgs, subtitlesNamed } from "./subtitles.ts";

/** One subtitles job per media: a second ask while one waits adds none. */
export const subtitlesJobKey = (mediaId: string): string => `subtitles:${mediaId}`;

/** Failures other than a rate limit: tried this many times, this far apart. */
const ATTEMPTS = 2;
const RETRY_AFTER_MS = 5 * 60_000;

/** Queues the subtitles a rate limit held back, for just after their cooldown ends at `until`. */
export async function queueHeldSubtitles(
  deps: Pick<WorkerDeps, "queues">,
  data: SubtitlesJob,
  until: Date,
): Promise<void> {
  await deps.queues.probe.add("subtitles", data, {
    key: subtitlesJobKey(data.mediaId),
    delayMs: requeueDelay(until),
    attempts: ATTEMPTS,
    backoff: { type: "fixed", delayMs: RETRY_AFTER_MS },
  });
}

/** Until when the site, or its subtitles, are not to be asked; null when they may be now. */
async function cooling(deps: WorkerDeps, site: string): Promise<Date | null> {
  return (
    (await activeCooldown(deps.db, site, "site")) ??
    (await activeCooldown(deps.db, site, "subtitles"))
  );
}

/**
 * The probe queue's `subtitles` jobs (docs/downloads.md "Rate limits"): fetches the subtitles a
 * site's rate limit kept from a video's fetch, alone, once the cooldown is over, and stores them
 * beside the file as the fetch would have (searchable too). While the site still limits them the
 * job waits again, as long as it takes; a video gone meanwhile drops them.
 */
export function subtitlesProcessor(deps: WorkerDeps) {
  return async (job: { data: SubtitlesJob }): Promise<void> => {
    const { mediaId, renditionId, url, userId } = job.data;
    const rendition = await deps.db
      .selectFrom("renditions")
      .select("storage_key")
      .where("id", "=", renditionId)
      .where("media_id", "=", mediaId)
      .executeTakeFirst();
    const args = subtitleArgs(deps.subtitles);
    if (rendition === undefined || args.length === 0) return;
    const site = siteOf(url);
    const until = await cooling(deps, site);
    if (until !== null) throw new RequeueError(requeueDelay(until));
    // A folder of this run's own: a run that lost the job may still be writing in its folder.
    const scratch = await openScratch(deps.workDir, `subtitles-${mediaId}`);
    try {
      const got = await downloadSubtitles(url, {
        ...ytdlpOptions(await withLoginsOf(deps, userId)),
        workDir: scratch.dir,
        extraArgs: args,
      });
      const base = basename(got.infoJsonPath, ".info.json");
      const names = got.files.map((f) => basename(f));
      await storeSubtitles(
        deps,
        mediaId,
        rendition.storage_key,
        subtitlesNamed(dirname(got.infoJsonPath), base, names, got.info),
      );
      await clearRateLimit(deps.db, site, "subtitles");
    } catch (err) {
      if (err instanceof YtDlpError && err.kind === "rate_limited") {
        // The subtitle itself, or the video's page before it: whichever the site limited waits.
        const scope = err.stderrTail.some((l) => l.includes(SUBTITLE_FAILED))
          ? "subtitles"
          : "site";
        const next = await noteRateLimit(deps.db, site, scope, err.retryAfterMs);
        throw new RequeueError(requeueDelay(next), { cause: err });
      }
      deps.logger.warn({ err, mediaId }, "fetching held-back subtitles failed");
      throw err;
    } finally {
      await scratch.dispose();
    }
  };
}
