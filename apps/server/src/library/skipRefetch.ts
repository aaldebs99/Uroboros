import { sql, type Kysely } from "kysely";
import { ApiError } from "../api/errors.ts";
import type { Database } from "../db/schema.ts";
import { ownEntry } from "../downloads/library.ts";
import { shiftsTimeline, type ProfileArgs } from "../downloads/profiles.ts";
import type { DownloadQueues } from "../downloads/queues.ts";

/**
 * Fetching a video's SponsorBlock segments again (docs/automation.md#sponsorblock): the segments a
 * download stored can be missing or out of date, as SponsorBlock's users keep submitting them.
 */

/** One refetch per entry at a time: a second ask while one is live adds none. */
export const skipsJobKey = (entryId: string): string => `skips:${entryId}`;
/** The quiet refresh's own key, so a Refetch asked meanwhile still runs and says how it went. */
export const quietSkipsJobKey = (entryId: string): string => `skips-quiet:${entryId}`;
/** How often opening a file refreshes its segments, at most. */
export const QUIET_REFRESH_EVERY_S = 60 * 60;

/** What a refetch asks SponsorBlock about: the YouTube video the file is of. */
export interface RefetchSource {
  videoId: string;
}

/**
 * The latest download that made a YouTube file: every item page asks, so it reads
 * `downloads_rendition_idx` rather than the whole download history.
 */
export function latestDownload(db: Kysely<Database>, renditionId: string) {
  return db
    .selectFrom("renditions as r")
    .innerJoin("media as m", "m.id", "r.media_id")
    .innerJoin("downloads as d", "d.rendition_id", "r.id")
    .where("r.id", "=", renditionId)
    .where("m.extractor", "=", "youtube")
    .select(["d.args", "m.video_id"])
    .orderBy("d.created_at", "desc")
    .limit(1);
}

/**
 * Whether a file's segments can be fetched again, and of which video: a YouTube file a download
 * made (every download of one file shares its profile revision, so its arguments). Null for a file
 * no download made (an upload), a site SponsorBlock doesn't cover (it has YouTube's alone), or one
 * whose extra arguments cut or trimmed it, so SponsorBlock's times no longer fit it.
 */
export async function refetchSource(
  db: Kysely<Database>,
  renditionId: string,
): Promise<RefetchSource | null> {
  const row = await latestDownload(db, renditionId).executeTakeFirst();
  if (row === undefined) return null;
  const args = row.args as ProfileArgs;
  if (shiftsTimeline(args.extraArgs)) return null;
  return { videoId: row.video_id };
}

/**
 * Queues a refetch of the caller's own entry's segments, on the probe queue (`skips`; one attempt,
 * since the person can ask again): 404 for anyone else's entry (shared with them or not), 409 when
 * there is nothing to fetch. A second ask while one waits or runs is the same refetch.
 */
export async function requestSkipsRefetch(
  db: Kysely<Database>,
  probe: DownloadQueues["probe"] | undefined,
  userId: string,
  entryId: string,
): Promise<void> {
  const entry = await ownEntry(db, userId, entryId);
  if (probe === undefined) throw new ApiError("unavailable", "downloads are not available");
  if ((await refetchSource(db, entry.rendition_id)) === null) {
    throw new ApiError("conflict", "this video has no SponsorBlock segments to fetch");
  }
  await probe.add(
    "skips",
    { entryId: entry.id, userId },
    { key: skipsJobKey(entry.id), attempts: 1 },
  );
}

/**
 * The quiet refresh as the caller opens their own entry's page: when the file's segments can be
 * fetched and none was asked for in the last hour, claims the file's turn (`skips_refreshed_at`, so
 * two pages opening together queue one) and queues a quiet `skips` job with it. Answers whether it
 * queued one; 404 for anyone else's entry.
 */
export async function requestQuietRefresh(
  db: Kysely<Database>,
  probe: DownloadQueues["probe"] | undefined,
  userId: string,
  entryId: string,
): Promise<boolean> {
  const entry = await ownEntry(db, userId, entryId);
  if (probe === undefined || (await refetchSource(db, entry.rendition_id)) === null) return false;
  return db.transaction().execute(async (tx) => {
    const claimed = await tx
      .updateTable("renditions")
      .set({ skips_refreshed_at: sql<Date>`now()` })
      .where("id", "=", entry.rendition_id)
      .where((eb) =>
        eb.or([
          eb("skips_refreshed_at", "is", null),
          eb(
            "skips_refreshed_at",
            "<",
            sql<Date>`now() - make_interval(secs => ${QUIET_REFRESH_EVERY_S})`,
          ),
        ]),
      )
      .returning("id")
      .executeTakeFirst();
    if (claimed === undefined) return false;
    await probe.add(
      "skips",
      { entryId: entry.id, userId, quiet: true },
      { key: quietSkipsJobKey(entry.id), attempts: 1 },
      tx,
    );
    return true;
  });
}
