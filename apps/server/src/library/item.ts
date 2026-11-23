import { Chapter, type LibraryItem } from "@uroboros/contract";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { base, ENTRY_COLUMNS, toEntry, type EntryRow } from "./query.ts";

const Chapters = z.array(Chapter);

/** The caller's entry with what its page and player need; another person's is 404. */
export async function getItem(
  db: Kysely<Database>,
  userId: string,
  entryId: string,
): Promise<LibraryItem> {
  const row = (await base(db, userId)
    .where("e.id", "=", entryId)
    .select([
      ...ENTRY_COLUMNS,
      "m.description",
      "m.chapters",
      "m.webpage_url",
      "r.video_codec",
      "r.audio_codec",
    ] as never)
    .executeTakeFirst()) as
    | (EntryRow & {
        description: string | null;
        chapters: unknown;
        webpage_url: string | null;
        video_codec: string | null;
        audio_codec: string | null;
      })
    | undefined;
  if (row === undefined) throw new ApiError("not_found", "no such library entry");
  const [subs, sources] = await Promise.all([
    db
      .selectFrom("subtitles")
      .select(["id", "lang", "name", "automatic"])
      .where("media_id", "=", row.media_id)
      .orderBy("automatic")
      .orderBy("lang")
      .execute(),
    db
      .selectFrom("source_items as si")
      .innerJoin("sources as s", "s.id", "si.source_id")
      .innerJoin("user_sources as us", (j) =>
        j.onRef("us.source_id", "=", "s.id").on("us.user_id", "=", userId),
      )
      .where("si.extractor", "=", row.extractor)
      .where("si.video_id", "=", row.video_id)
      .select(["s.id", "s.title"])
      .execute(),
  ]);
  const chapters = Chapters.safeParse(row.chapters);
  return {
    ...toEntry(row),
    description: row.description,
    chapters: chapters.success ? chapters.data : [],
    subtitles: subs.map((s) => ({ ...s, url: `/api/library/${entryId}/subtitles/${s.id}` })),
    streamUrl: `/api/library/${entryId}/stream`,
    webpageUrl: row.webpage_url,
    sources,
    videoCodec: row.video_codec,
    audioCodec: row.audio_codec,
    playbackUrl: `/api/library/${entryId}/playback`,
  };
}
