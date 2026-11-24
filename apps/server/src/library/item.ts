import { Chapter, SkipSegment, type LibraryItem } from "@uroboros/contract";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { playlistsHolding } from "../playlists/listing.ts";
import { visibleEntry } from "../sharing/access.ts";
import { UPLOAD_EXTRACTOR } from "./platform.ts";
import { base, ENTRY_COLUMNS, toEntry, type EntryRow } from "./query.ts";
import { refetchSource } from "./skipRefetch.ts";
import { playbackFacts, type RenditionPlayback } from "../transcode/itemFacts.ts";

const Chapters = z.array(Chapter);
const SkipSegments = z.array(SkipSegment);

/**
 * An entry with what its page and player need: the caller's own, or one a share reaches them
 * with (docs/sharing.md), which shows none of the owner's tags, Keep, subscription or playlists.
 * Anything else is 404.
 */
export async function getItem(
  db: Kysely<Database>,
  userId: string,
  entryId: string,
): Promise<LibraryItem> {
  const seen = await visibleEntry(db, { userId }, entryId);
  const row = (await base(db, userId, seen.user_id)
    .where("e.id", "=", entryId)
    .select([
      ...ENTRY_COLUMNS,
      "m.description",
      "m.chapters",
      "m.webpage_url",
      "m.uploaded_by",
      "e.rendition_id",
      "r.skip_segments",
      "r.video_codec",
      "r.audio_codec",
      "r.video_codecs",
      "r.audio_codecs",
      "r.width",
      "r.height",
    ] as never)
    .executeTakeFirst()) as
    | (EntryRow & {
        description: string | null;
        chapters: unknown;
        webpage_url: string | null;
        uploaded_by: string | null;
        rendition_id: string;
        skip_segments: unknown;
        video_codec: string | null;
        audio_codec: string | null;
      } & RenditionPlayback)
    | undefined;
  if (row === undefined) throw new ApiError("not_found", "no such library entry");
  const [subs, sources, playlists, refetchable] = await Promise.all([
    db
      .selectFrom("subtitles")
      .select(["id", "lang", "name", "automatic"])
      .where("media_id", "=", row.media_id)
      .orderBy("automatic")
      .orderBy("lang")
      .execute(),
    seen.own ? youtubePlaylists(db, userId, row) : [],
    seen.own ? playlistsHolding(db, userId, entryId) : [],
    seen.own ? refetchSource(db, row.rendition_id).then((s) => s !== null) : false,
  ]);
  const chapters = Chapters.safeParse(row.chapters);
  const skips = SkipSegments.safeParse(row.skip_segments);
  return {
    ...toEntry(row, seen.own),
    description: row.description,
    chapters: chapters.success ? chapters.data : [],
    skipSegments: skips.success ? skips.data : [],
    skipSegmentsRefetchable: refetchable,
    subtitles: subs.map((s) => ({ ...s, url: `/api/library/${entryId}/subtitles/${s.id}` })),
    streamUrl: `/api/library/${entryId}/stream`,
    webpageUrl: row.webpage_url,
    sources,
    playlists,
    videoCodec: row.video_codec,
    audioCodec: row.audio_codec,
    playbackUrl: `/api/library/${entryId}/playback`,
    sharedBy: seen.own ? null : seen.owner_name,
    editable: seen.own && row.extractor === UPLOAD_EXTRACTOR && row.uploaded_by === userId,
    ...playbackFacts(row),
  };
}

/** The caller's YouTube playlists holding this video. */
function youtubePlaylists(
  db: Kysely<Database>,
  userId: string,
  row: { extractor: string; video_id: string },
) {
  return db
    .selectFrom("source_items as si")
    .innerJoin("sources as s", "s.id", "si.source_id")
    .innerJoin("user_sources as us", (j) =>
      j.onRef("us.source_id", "=", "s.id").on("us.user_id", "=", userId),
    )
    .where("si.extractor", "=", row.extractor)
    .where("si.video_id", "=", row.video_id)
    .select(["s.id", "s.title"])
    .execute();
}
