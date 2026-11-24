import type { VideoInfo } from "@uroboros/ytdlp";
import type { Kysely, Transaction } from "kysely";
import type { Database } from "../db/schema.ts";
import { UnrecoverableError } from "../jobs/errors.ts";
import { UPLOAD_EXTRACTOR } from "../library/platform.ts";

/**
 * Creates or refreshes the media row for (extractor, video id) from yt-dlp's metadata; the key
 * comes from the caller (the job), the rest from `info`. Returns its id.
 */
export async function upsertMedia(
  db: Kysely<Database> | Transaction<Database>,
  key: { extractor: string; videoId: string },
  info: VideoInfo,
  extra: { thumbnailKey?: string | null; infoKey?: string | null } = {},
): Promise<string> {
  // An uploaded video's media row is its own (docs/uploads.md); no site may take its extractor.
  if (key.extractor.toLowerCase() === UPLOAD_EXTRACTOR) {
    throw new UnrecoverableError("a site's video can't have the upload extractor");
  }
  const fields = {
    title: info.title,
    channel: info.channel,
    channel_id: info.channelId,
    uploader: info.uploader,
    upload_date: info.uploadDate,
    duration: info.duration,
    description: info.description,
    webpage_url: info.url,
    chapters: JSON.stringify(
      info.chapters.map((c) => ({ start: c.startTime, end: c.endTime, title: c.title })),
    ),
    ...(extra.thumbnailKey === undefined ? {} : { thumbnail_key: extra.thumbnailKey }),
    ...(extra.infoKey === undefined ? {} : { info_key: extra.infoKey }),
  };
  const row = await db
    .insertInto("media")
    .values({ extractor: key.extractor, video_id: key.videoId, ...fields })
    .onConflict((oc) =>
      oc.columns(["extractor", "video_id"]).doUpdateSet({ ...fields, updated_at: new Date() }),
    )
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}
