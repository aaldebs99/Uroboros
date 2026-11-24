import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "../src/db/schema.ts";
import { seededDefault } from "./downloads.ts";

export interface SeededEntry {
  entryId: string;
  mediaId: string;
  renditionId: string;
}

/**
 * Gives `userId` a library entry: the video's media and its default-profile rendition (shared when
 * another person already has them), then the entry. `storageKey` names the file the store holds.
 */
export async function seedEntry(
  db: Kysely<Database>,
  userId: string,
  opts: { videoId?: string; title?: string; thumbnail?: boolean; storageKey?: string } = {},
): Promise<SeededEntry> {
  const p = await seededDefault(db);
  const videoId = opts.videoId ?? `v-${randomUUID()}`;
  await db
    .insertInto("media")
    .values({
      extractor: "youtube",
      video_id: videoId,
      title: opts.title ?? videoId,
      duration: 100,
      thumbnail_key: opts.thumbnail === true ? `thumbs/${videoId}.jpg` : null,
    })
    .onConflict((oc) => oc.columns(["extractor", "video_id"]).doNothing())
    .execute();
  const media = await db
    .selectFrom("media")
    .select("id")
    .where("extractor", "=", "youtube")
    .where("video_id", "=", videoId)
    .executeTakeFirstOrThrow();
  await db
    .insertInto("renditions")
    .values({
      media_id: media.id,
      profile_id: p.id,
      profile_revision: p.revision,
      storage_key: opts.storageKey ?? `media/${videoId}.mp4`,
      size_bytes: 10,
      container: "mp4",
    })
    .onConflict((oc) => oc.columns(["media_id", "profile_id", "profile_revision"]).doNothing())
    .execute();
  const rendition = await db
    .selectFrom("renditions")
    .select("id")
    .where("media_id", "=", media.id)
    .where("profile_id", "=", p.id)
    .where("profile_revision", "=", p.revision)
    .executeTakeFirstOrThrow();
  const entry = await db
    .insertInto("library_entries")
    .values({ user_id: userId, media_id: media.id, rendition_id: rendition.id })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { entryId: entry.id, mediaId: media.id, renditionId: rendition.id };
}

/**
 * Gives `userId` an entry whose rendition has no format profile: an upload (`extractor` "upload",
 * the default, docs/uploads.md) or a download whose profile went with its owner's account.
 */
export async function seedProfileless(
  db: Kysely<Database>,
  userId: string,
  opts: {
    extractor?: string;
    videoId?: string;
    title?: string;
    channel?: string;
    thumbnailKey?: string | null;
    storageKey?: string;
  } = {},
): Promise<SeededEntry> {
  const extractor = opts.extractor ?? "upload";
  const videoId = opts.videoId ?? randomUUID();
  const media = await db
    .insertInto("media")
    .values({
      extractor,
      video_id: videoId,
      title: opts.title ?? videoId,
      channel: opts.channel ?? null,
      uploader: opts.channel ?? null,
      duration: 100,
      thumbnail_key: opts.thumbnailKey === undefined ? `thumbs/${videoId}.jpg` : opts.thumbnailKey,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const rendition = await db
    .insertInto("renditions")
    .values({
      media_id: media.id,
      profile_id: null,
      profile_revision: extractor === "upload" ? "upload" : "gone",
      storage_key: opts.storageKey ?? `media/${media.id}/upload.mp4`,
      size_bytes: 10,
      container: "mp4",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const entry = await db
    .insertInto("library_entries")
    .values({ user_id: userId, media_id: media.id, rendition_id: rendition.id })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { entryId: entry.id, mediaId: media.id, renditionId: rendition.id };
}
