import type { Kysely } from "kysely";
import { ApiError } from "../api/errors.ts";
import type { Database } from "../db/schema.ts";
import { ownEntry } from "../downloads/library.ts";
import type { ProfileArgs } from "../downloads/profiles.ts";
import type { DownloadQueues } from "../downloads/queues.ts";

/**
 * Fetching a video's SponsorBlock segments again (docs/automation.md#sponsorblock): the segments a
 * download stored can be missing or out of date, as SponsorBlock's users keep submitting them.
 */

/** One refetch per entry at a time: a second ask while one is live adds none. */
export const skipsJobKey = (entryId: string): string => `skips:${entryId}`;

/** What a refetch asks yt-dlp with: the profile arguments the file was made with, and its link. */
export interface RefetchSource {
  args: ProfileArgs;
  url: string;
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
    .select(["d.args", "d.url"])
    .orderBy("d.created_at", "desc")
    .limit(1);
}

/**
 * Where a file's segments can be fetched again: from the latest download that made it (every
 * download of one file shares its profile revision, so its arguments). Null for a file no download
 * made (an upload), a site SponsorBlock doesn't cover (it has YouTube's alone), an audio file (its
 * segments were cut out), or a profile that skips no category.
 */
export async function refetchSource(
  db: Kysely<Database>,
  renditionId: string,
): Promise<RefetchSource | null> {
  const row = await latestDownload(db, renditionId).executeTakeFirst();
  if (row === undefined) return null;
  const args = row.args as ProfileArgs;
  if (args.audioOnly || (args.sponsorblockRemove ?? []).length === 0) return null;
  return { args, url: row.url };
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
