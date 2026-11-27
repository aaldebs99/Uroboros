import type { ChannelSummary, EntryDetailsBody, OriginalDetails } from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { z } from "zod";
import { ApiError } from "../api/errors.ts";
import type { Database } from "../db/schema.ts";
import { listChannels } from "./channels.ts";
import { parseChannelKey } from "./channelKey.ts";
import { platformName, UPLOAD_EXTRACTOR } from "./platform.ts";

/**
 * A person's own details of a video they hold (docs/library.md#your-own-details): a title,
 * description and channel in place of its site's (or its uploader's), for them alone and whoever
 * they share it with, kept per person and video in `media_edits` until they reset them. Only what
 * differs from the site's is kept, so the rest follows the site.
 */

type Db = Kysely<Database>;
type Body = z.output<typeof EntryDetailsBody>;

/** A video's details as its site gives them, as the library shows them. */
interface SiteDetails {
  extractor: string;
  /** Its title, else its id. */
  title: string;
  description: string | null;
  /** Its channel, else its uploader, else the site's own name. */
  channel: string;
  channelId: string | null;
  /** What keys its channel when the site gives no id. */
  channelName: string | null;
}

/** Where a person moved a video: the channel's name, whose channels, and its id when keyed by one. */
interface MovedTo {
  channel: string;
  channel_extractor: string;
  channel_id: string | null;
}

const NOT_MOVED = { channel: null, channel_extractor: null, channel_id: null } as const;

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function siteDetails(db: Db, mediaId: string): Promise<SiteDetails> {
  const m = await db
    .selectFrom("media")
    .select([
      "extractor",
      "video_id",
      "title",
      "description",
      "channel",
      "uploader",
      "channel_id",
      "webpage_url",
    ])
    .where("id", "=", mediaId)
    .executeTakeFirstOrThrow();
  const name = m.channel ?? m.uploader;
  return {
    extractor: m.extractor,
    title: m.title ?? m.video_id,
    description: m.description === "" ? null : m.description,
    channel: name ?? platformName(m.extractor, m.webpage_url),
    channelId: m.channel_id,
    channelName: name,
  };
}

/** Compares rankings: the first place they differ decides. */
function byRank(a: readonly number[], b: readonly number[]): number {
  for (const [i, x] of a.entries()) {
    const d = x - (b.at(i) ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Of the person's channels named `typed` in any case, the one a video of `extractor` joins: one
 * named exactly so, then one of the video's own site, then one keyed by the site's id, then the
 * biggest, then by key.
 */
export function pickChannel(
  typed: string,
  extractor: string,
  channels: readonly ChannelSummary[],
): ChannelSummary | null {
  const rank = (c: ChannelSummary) => [
    c.name === typed ? 0 : 1,
    c.extractor === extractor ? 0 : 1,
    parseChannelKey(c.key)?.kind === "id" ? 0 : 1,
    -c.count,
  ];
  const named = channels.filter((c) => sameName(c.name, typed));
  named.sort((x, y) => byRank(rank(x), rank(y)) || x.key.localeCompare(y.key));
  return named[0] ?? null;
}

/**
 * Where naming a video's channel `typed` moves it: into the person's channel of that name (under
 * its own name and key), or into a new one of the video's site keyed by `typed`; nowhere (null)
 * when that is the site's own channel.
 */
async function resolveChannel(
  db: Db,
  userId: string,
  site: SiteDetails,
  typed: string,
): Promise<MovedTo | null> {
  if (sameName(typed, site.channel)) return null;
  const c = pickChannel(typed, site.extractor, await listChannels(db, userId));
  const key = c === null ? null : parseChannelKey(c.key);
  const to: MovedTo =
    c === null || key === null
      ? { channel: typed, channel_extractor: site.extractor, channel_id: null }
      : key.kind === "id"
        ? { channel: c.name, channel_extractor: key.extractor, channel_id: key.value }
        : { channel: key.value, channel_extractor: key.extractor, channel_id: null };
  const sites =
    to.channel_extractor === site.extractor &&
    (site.channelId === null
      ? to.channel_id === null && to.channel === site.channelName
      : to.channel_id === site.channelId);
  return sites ? null : to;
}

/** A person's edits of one video: each null where it is the site's. */
interface Edits {
  title: string | null;
  description: string | null;
  channel: string | null;
  channel_extractor: string | null;
  channel_id: string | null;
}

/** A title to keep: the one had when none is given, none when it is the site's. */
function ownTitle(given: string | undefined, had: string | null, site: string): string | null {
  if (given === undefined) return had;
  return given === site ? null : given;
}

/** A description to keep: as `ownTitle`, and '' when cleared over the site's. */
function ownDescription(
  given: string | null | undefined,
  had: string | null,
  site: string | null,
): string | null {
  if (given === undefined) return had;
  if (given === null) return site === null ? null : "";
  return given === site ? null : given;
}

/** The channel a row moved its video to, if any. */
function movedIn(had: Edits | undefined): MovedTo | null {
  if (had?.channel == null || had.channel_extractor === null) return null;
  return {
    channel: had.channel,
    channel_extractor: had.channel_extractor,
    channel_id: had.channel_id,
  };
}

/** The video the caller's entry holds, the entry held while the edit is written (a removal waits). */
async function lockedEntry(db: Db, userId: string, entryId: string): Promise<string> {
  const entry = await db
    .selectFrom("library_entries")
    .select("media_id")
    .where("id", "=", entryId)
    .where("user_id", "=", userId)
    .forKeyShare()
    .executeTakeFirst();
  if (entry === undefined) throw new ApiError("not_found", "no such library entry");
  return entry.media_id;
}

/** Writes a person's edits of a video; nothing that differs from the site's is no row. */
async function writeEdits(db: Db, userId: string, mediaId: string, next: Edits): Promise<void> {
  if (next.title === null && next.description === null && next.channel === null) {
    await db
      .deleteFrom("media_edits")
      .where("user_id", "=", userId)
      .where("media_id", "=", mediaId)
      .execute();
    return;
  }
  await db
    .insertInto("media_edits")
    .values({ user_id: userId, media_id: mediaId, ...next })
    .onConflict((oc) =>
      oc.columns(["user_id", "media_id"]).doUpdateSet({ ...next, updated_at: new Date() }),
    )
    .execute();
}

/**
 * Changes the caller's own details of the video their entry `entryId` holds, each field only when
 * given; 404 unless the entry is theirs.
 */
export async function saveOwnDetails(
  db: Db,
  userId: string,
  entryId: string,
  body: Body,
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const mediaId = await lockedEntry(tx, userId, entryId);
    const site = await siteDetails(tx, mediaId);
    const had = await tx
      .selectFrom("media_edits")
      .select(["title", "description", "channel", "channel_extractor", "channel_id"])
      .where("user_id", "=", userId)
      .where("media_id", "=", mediaId)
      .forUpdate()
      .executeTakeFirst();
    const moved =
      body.creator === undefined
        ? movedIn(had)
        : await resolveChannel(tx, userId, site, body.creator);
    await writeEdits(tx, userId, mediaId, {
      title: ownTitle(body.title, had?.title ?? null, site.title),
      description: ownDescription(body.description, had?.description ?? null, site.description),
      ...(moved ?? NOT_MOVED),
    });
  });
}

/** Drops the caller's own details of the video `entryId` holds; 404 unless the entry is theirs. */
export async function resetOwnDetails(db: Db, userId: string, entryId: string): Promise<void> {
  const entry = await db
    .selectFrom("library_entries")
    .select("media_id")
    .where("id", "=", entryId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (entry === undefined) throw new ApiError("not_found", "no such library entry");
  await db
    .deleteFrom("media_edits")
    .where("user_id", "=", userId)
    .where("media_id", "=", entry.media_id)
    .execute();
}

/** What an item's row brings for its editing facts (`getItem`). */
export interface DetailsRow {
  extractor: string;
  video_id: string;
  webpage_url: string | null;
  uploaded_by: string | null;
  edited: boolean;
  site_title: string | null;
  site_description: string | null;
  site_channel: string | null;
}

/**
 * Who may edit an item's details, and how: its uploader for everyone (`editable`), anyone else
 * holding it for themselves (`personalEditable`); and, with their own showing, the site's.
 */
export function detailsFacts(
  row: DetailsRow,
  userId: string,
  own: boolean,
): {
  editable: boolean;
  personalEditable: boolean;
  edited: boolean;
  original: OriginalDetails | null;
} {
  const editable = own && row.extractor === UPLOAD_EXTRACTOR && row.uploaded_by === userId;
  const edited = own && row.edited;
  return {
    editable,
    personalEditable: own && !editable,
    edited,
    original: edited
      ? {
          title: row.site_title ?? row.video_id,
          description: row.site_description === "" ? null : row.site_description,
          channel: row.site_channel ?? platformName(row.extractor, row.webpage_url),
        }
      : null,
  };
}
