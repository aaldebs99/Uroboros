import {
  Chapter,
  type PublicItem,
  type PublicListItem,
  type PublicShare,
} from "@uroboros/contract";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { dashed } from "../library/query.ts";
import { playlistEntryIds } from "../playlists/listing.ts";
import { linkShare, visibleEntry, type LiveShare, type VisibleEntry } from "./access.ts";
import { describeTarget } from "./targets.ts";
import { playbackFacts } from "../transcode/itemFacts.ts";

type Db = Kysely<Database>;

/** One answer for every dead link: unknown, expired, turned off, or its owner disabled. */
export const DEAD = "this link doesn't work any more";

export const itemBase = (code: string, entryId: string) => `/api/public/s/${code}/items/${entryId}`;

export async function liveLink(db: Db, code: string): Promise<LiveShare> {
  const share = await linkShare(db, code);
  if (share === undefined) throw new ApiError("not_found", DEAD);
  return share;
}

/** An entry the link holds; anything else answers as a dead link. */
export async function linkEntry(db: Db, code: string, entryId: string): Promise<VisibleEntry> {
  try {
    return await visibleEntry(db, { code }, entryId);
  } catch (err) {
    if (err instanceof ApiError) throw new ApiError("not_found", DEAD);
    throw err;
  }
}

/** The owner's entries a link holds, in order. */
async function heldIds(db: Db, share: LiveShare): Promise<string[]> {
  const { kind, id } = share.target;
  if (kind === "entry") return [id];
  return playlistEntryIds(db, share.ownerId, {
    kind: kind === "playlist" ? "manual" : "youtube",
    id,
  });
}

async function listItems(db: Db, code: string, ids: string[]): Promise<PublicListItem[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .selectFrom("library_entries as e")
    .innerJoin("media as m", "m.id", "e.media_id")
    .select([
      "e.id",
      "m.title",
      "m.video_id",
      "m.channel",
      "m.uploader",
      "m.duration",
      "m.upload_date",
      "m.thumbnail_key",
    ])
    .where("e.id", "in", ids)
    .execute();
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    if (r === undefined) return [];
    return [
      {
        id,
        title: r.title ?? r.video_id,
        channel: r.channel ?? r.uploader,
        duration: r.duration,
        uploadDate: dashed(r.upload_date),
        thumbnailUrl: r.thumbnail_key === null ? null : `${itemBase(code, id)}/thumbnail`,
      },
    ];
  });
}

/** What a public link shows; it never names who shared it. */
export async function publicShare(db: Db, code: string): Promise<PublicShare> {
  const share = await liveLink(db, code);
  const facts = await describeTarget(db, share.ownerId, share.target.kind, share.target.id);
  return {
    kind: share.target.kind === "entry" ? "entry" : "playlist",
    title: facts.title,
    description: facts.description,
    allowDownload: share.allowDownload,
    items: await listItems(db, code, await heldIds(db, share)),
  };
}

const Chapters = z.array(Chapter);

/** One video of a link with its player's needs, every URL under the link. */
export async function publicItem(db: Db, code: string, entryId: string): Promise<PublicItem> {
  const e = await linkEntry(db, code, entryId);
  const base = itemBase(code, entryId);
  const [extra, subs] = await Promise.all([
    db
      .selectFrom("media as m")
      .innerJoin("renditions as r", "r.media_id", "m.id")
      .select([
        "m.description",
        "m.chapters",
        "r.video_codec",
        "r.audio_codec",
        "r.video_codecs",
        "r.audio_codecs",
        "r.width",
        "r.height",
      ])
      .where("m.id", "=", e.media_id)
      .where("r.id", "=", e.rendition_id)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("subtitles")
      .select(["id", "lang", "name", "automatic"])
      .where("media_id", "=", e.media_id)
      .orderBy("automatic")
      .orderBy("lang")
      .execute(),
  ]);
  const chapters = Chapters.safeParse(extra.chapters);
  return {
    id: entryId,
    title: e.title ?? e.video_id,
    channel: e.channel ?? e.uploader,
    duration: e.duration,
    uploadDate: dashed(e.upload_date),
    thumbnailUrl: e.thumbnail_key === null ? null : `${base}/thumbnail`,
    description: extra.description,
    chapters: chapters.success ? chapters.data : [],
    subtitles: subs.map((s) => ({ ...s, url: `${base}/subtitles/${s.id}` })),
    streamUrl: `${base}/stream`,
    fileUrl: e.allow_download ? `${base}/file` : null,
    container: e.container,
    videoCodec: extra.video_codec,
    audioCodec: extra.audio_codec,
    playbackUrl: `${base}/playback`,
    ...playbackFacts(extra),
  };
}
