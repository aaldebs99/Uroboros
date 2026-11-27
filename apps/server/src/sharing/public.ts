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
import { eff } from "../library/edits.ts";
import { sponsorBlockOf } from "../library/preferences.ts";
import { dashed } from "../library/query.ts";
import { sponsorSegmentsFor } from "../library/sponsorSegments.ts";
import { playlistEntryIds } from "../playlists/listing.ts";
import { linkShare, visibleEntry, type LiveShare, type VisibleEntry } from "./access.ts";
import { publicClip } from "./clipPublic.ts";
import { describeTarget } from "./targets.ts";
import { playbackFacts } from "../transcode/itemFacts.ts";
import { platformName } from "../library/platform.ts";
import { thumbnailUrl } from "../library/thumbnailUrl.ts";

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
  // In the owner's own details (docs/library.md#your-own-details).
  const rows = await db
    .selectFrom("library_entries as e")
    .innerJoin("media as m", "m.id", "e.media_id")
    .leftJoin("media_edits as ed", (j) =>
      j.onRef("ed.media_id", "=", "e.media_id").onRef("ed.user_id", "=", "e.user_id"),
    )
    .select([
      "e.id",
      eff.title.as("title"),
      "m.video_id",
      "m.extractor",
      "m.webpage_url",
      eff.channel.as("channel"),
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
        channel: r.channel ?? r.uploader ?? platformName(r.extractor, r.webpage_url),
        duration: r.duration,
        uploadDate: dashed(r.upload_date),
        thumbnailUrl: thumbnailUrl(`${itemBase(code, id)}/thumbnail`, r.thumbnail_key),
      },
    ];
  });
}

/**
 * What a public link shows; it never names who shared it. A code that is no video's or playlist's
 * may be a clip's (docs/sharing.md#clips), while clips are on.
 */
export async function publicShare(db: Db, code: string, clips = true): Promise<PublicShare> {
  const share = await linkShare(db, code);
  if (share === undefined) {
    const clip = await publicClip(db, code, clips);
    if (clip === null) throw new ApiError("not_found", DEAD);
    return clip;
  }
  const facts = await describeTarget(db, share.ownerId, share.target.kind, share.target.id);
  return {
    kind: share.target.kind === "entry" ? "entry" : "playlist",
    title: facts.title,
    description: facts.description,
    allowDownload: share.allowDownload,
    items: await listItems(db, code, await heldIds(db, share)),
    clip: null,
  };
}

const Chapters = z.array(Chapter);

/**
 * One video of a link with its player's needs, every URL under the link. Its SponsorBlock segments
 * go by the link owner's setting: whoever opens it, signed in or not, sees it as its owner set it;
 * its highlight goes to everyone.
 */
export async function publicItem(
  db: Db,
  code: string,
  entryId: string,
  maxShort: number,
): Promise<PublicItem> {
  const e = await linkEntry(db, code, entryId);
  const base = itemBase(code, entryId);
  const [extra, subs, sponsorBlock] = await Promise.all([
    db
      .selectFrom("media as m")
      .innerJoin("renditions as r", "r.media_id", "m.id")
      .leftJoin("media_edits as ed", (j) =>
        j.onRef("ed.media_id", "=", "m.id").on("ed.user_id", "=", e.user_id),
      )
      .select([
        eff.description.as("description"),
        "m.chapters",
        "m.webpage_url",
        "r.skip_segments",
        "r.sponsor_highlight",
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
    sponsorBlockOf(db, e.user_id),
  ]);
  const chapters = Chapters.safeParse(extra.chapters);
  return {
    id: entryId,
    title: e.title ?? e.video_id,
    channel: e.channel ?? e.uploader ?? platformName(e.extractor, extra.webpage_url),
    duration: e.duration,
    uploadDate: dashed(e.upload_date),
    thumbnailUrl: thumbnailUrl(`${base}/thumbnail`, e.thumbnail_key),
    description: extra.description,
    chapters: chapters.success ? chapters.data : [],
    sponsorSegments: sponsorSegmentsFor(
      extra.skip_segments,
      sponsorBlock,
      extra.video_codec === null,
    ),
    sponsorHighlight: extra.sponsor_highlight,
    subtitles: subs.map((s) => ({ ...s, url: `${base}/subtitles/${s.id}` })),
    streamUrl: `${base}/stream`,
    fileUrl: e.allow_download ? `${base}/file` : null,
    container: e.container,
    videoCodec: extra.video_codec,
    audioCodec: extra.audio_codec,
    playbackUrl: `${base}/playback`,
    ...playbackFacts(extra, maxShort),
  };
}
