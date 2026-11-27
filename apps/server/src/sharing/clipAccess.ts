import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { LIVE, reachesUserIn, type Viewer } from "./access.ts";

/**
 * Who reaches a clip shared on its own (docs/sharing.md#clips): its owner, the people a live
 * people-share of it reaches, and whoever holds a live link's code. A clip share reaches the copy
 * alone, never the video it was cut from (`visibleEntry` reads only `shares`).
 */

type Db = Kysely<Database>;

/** A clip share that works right now. */
export interface LiveClipShare {
  id: string;
  ownerId: string;
  ownerName: string;
  exportId: string;
  entryId: string;
  allowDownload: boolean;
  expiresAt: Date | null;
  sharedAt: Date;
}

function liveClipShares(db: Db) {
  return db
    .selectFrom("clip_shares as s")
    .innerJoin("users as o", "o.id", "s.owner_id")
    .select([
      "s.id",
      "s.owner_id",
      "o.display_name as owner_name",
      "s.export_id",
      "s.entry_id",
      "s.allow_download",
      "s.expires_at",
      "s.updated_at",
    ])
    .where(LIVE);
}

type Row = Awaited<ReturnType<ReturnType<typeof liveClipShares>["execute"]>>[number];

const toLive = (r: Row): LiveClipShare => ({
  id: r.id,
  ownerId: r.owner_id,
  ownerName: r.owner_name,
  exportId: r.export_id,
  entryId: r.entry_id,
  allowDownload: r.allow_download,
  expiresAt: r.expires_at,
  sharedAt: new Date(r.updated_at),
});

/** The live clip link with this code; undefined for a dead or unknown one. */
export async function clipLinkShare(db: Db, code: string): Promise<LiveClipShare | undefined> {
  const row = await liveClipShares(db)
    .where("s.mode", "=", "link")
    .where("s.code", "=", code)
    .executeTakeFirst();
  return row === undefined ? undefined : toLive(row);
}

/** The live clip shares reaching this person, newest change first (Shared › With me). */
export async function clipSharesReaching(db: Db, userId: string): Promise<LiveClipShare[]> {
  const rows = await liveClipShares(db)
    .where(reachesUserIn("clip_share_people", userId))
    .orderBy("s.updated_at", "desc")
    .orderBy("s.id")
    .execute();
  return rows.map(toLive);
}

/** The live clip shares to this group by someone still in it, newest change first (its page). */
export async function clipSharesToGroup(db: Db, groupId: string): Promise<LiveClipShare[]> {
  const rows = await liveClipShares(db)
    .where(
      sql<boolean>`s.mode = 'people'
        AND EXISTS (SELECT 1 FROM clip_share_people sp
          WHERE sp.share_id = s.id AND sp.group_id = ${groupId})
        AND EXISTS (SELECT 1 FROM group_members gm
          WHERE gm.group_id = ${groupId} AND gm.user_id = s.owner_id)`,
    )
    .orderBy("s.updated_at", "desc")
    .orderBy("s.id")
    .execute();
  return rows.map(toLive);
}

const reaches = (viewer: Viewer) =>
  "userId" in viewer
    ? reachesUserIn("clip_share_people", viewer.userId)
    : sql<boolean>`s.mode = 'link' AND s.code = ${viewer.code}`;

/** The live clip shares of copy `x` reaching `viewer`. */
const reachingShares = (viewer: Viewer) => sql`FROM clip_shares s JOIN users o ON o.id = s.owner_id
  WHERE s.export_id = x.id AND ${LIVE} AND ${reaches(viewer)}`;

function visibleRow(db: Db, viewer: Viewer, exportId: string) {
  const own = "userId" in viewer ? sql<boolean>`x.user_id = ${viewer.userId}` : sql<boolean>`false`;
  // People-shares always allow saving; a link says.
  const download =
    "userId" in viewer
      ? sql<boolean>`true`
      : sql<boolean>`coalesce((SELECT bool_or(s.allow_download) ${reachingShares(viewer)}), false)`;
  return db
    .selectFrom("exports as x")
    .innerJoin("renditions as r", "r.id", "x.rendition_id")
    .innerJoin("media as m", "m.id", "r.media_id")
    .innerJoin("users as owner", "owner.id", "x.user_id")
    .select([
      "x.id",
      "x.user_id",
      "x.state",
      "x.progress",
      "x.error",
      "x.storage_key",
      "x.format",
      "x.clip_start",
      "x.clip_end",
      "m.title",
      "m.video_id",
      "m.channel",
      "m.chapters",
      "m.thumbnail_key",
      "r.video_codec",
      sql<number | null>`coalesce(r.duration, m.duration)`.as("duration"),
      "owner.display_name as owner_name",
      own.as("own"),
      download.as("allow_download"),
    ])
    .where("x.id", "=", exportId)
    .where("x.clip_start", "is not", null)
    .where(sql<boolean>`(${own} OR EXISTS (SELECT 1 ${reachingShares(viewer)}))`)
    .executeTakeFirst();
}

/** A clip copy with what serving it needs, and how the viewer reaches it. */
export type VisibleClip = NonNullable<Awaited<ReturnType<typeof visibleRow>>>;

/** The clip copy if `viewer` may see it: their own, or reached by a live clip share; else 404. */
export async function visibleClip(db: Db, viewer: Viewer, exportId: string): Promise<VisibleClip> {
  const row = await visibleRow(db, viewer, exportId);
  if (row === undefined) throw new ApiError("not_found", "no such clip");
  return row;
}
