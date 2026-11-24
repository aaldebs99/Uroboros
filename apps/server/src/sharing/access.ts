import { sql, type Kysely, type RawBuilder } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { entryQuery } from "../downloads/library.ts";

/**
 * Who is asking (docs/sharing.md): a signed-in person, or whoever holds a public link's code.
 */
export type Viewer = { userId: string } | { code: string };

export type ShareTargetKind = "entry" | "playlist" | "youtube";

/** A share that works right now. */
export interface LiveShare {
  id: string;
  ownerId: string;
  ownerName: string;
  target: { kind: ShareTargetKind; id: string };
  allowDownload: boolean;
  expiresAt: Date | null;
  sharedAt: Date;
}

/** Usable now: not expired, and its owner neither disabled nor revoked. `s` and `o` are bound. */
const LIVE = sql<boolean>`(s.expires_at IS NULL OR s.expires_at > now())
  AND o.disabled_at IS NULL AND o.revoked_at IS NULL`;

/**
 * A people-share naming this user, or one of the owner's groups this user is in; never their own.
 * A group counts only while the owner is still in it too (leaving ends their shares to it).
 */
const reachesUser = (userId: string) => sql<boolean>`s.mode = 'people'
  AND s.owner_id <> ${userId}
  AND EXISTS (
    SELECT 1 FROM share_people sp
    WHERE sp.share_id = s.id AND (
      sp.user_id = ${userId}
      OR (sp.group_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM group_members gm
          WHERE gm.group_id = sp.group_id AND gm.user_id = ${userId})
        AND EXISTS (SELECT 1 FROM group_members gm
          WHERE gm.group_id = sp.group_id AND gm.user_id = s.owner_id))))`;

const reachesCode = (code: string) => sql<boolean>`s.mode = 'link' AND s.code = ${code}`;

const reaches = (viewer: Viewer): RawBuilder<boolean> =>
  "userId" in viewer ? reachesUser(viewer.userId) : reachesCode(viewer.code);

/** The share holds entry `e` (with its media `m`): the entry itself, or a playlist holding it. */
const COVERS = sql<boolean>`s.owner_id = e.user_id AND (
  s.entry_id = e.id
  OR EXISTS (SELECT 1 FROM playlist_items pi
    WHERE pi.playlist_id = s.playlist_id AND pi.entry_id = e.id)
  OR EXISTS (SELECT 1 FROM source_items si
    WHERE si.source_id = s.source_id AND si.extractor = m.extractor AND si.video_id = m.video_id))`;

/** The live shares reaching `viewer` that hold entry `e`. */
const reachingShares = (viewer: Viewer) => sql`FROM shares s JOIN users o ON o.id = s.owner_id
  WHERE ${LIVE} AND ${reaches(viewer)} AND ${COVERS}`;

/** The entry, its owner's name, and how `viewer` reaches it, when they may see it. */
function visibleRow(db: Kysely<Database>, viewer: Viewer, entryId: string) {
  const own = "userId" in viewer ? sql<boolean>`e.user_id = ${viewer.userId}` : sql<boolean>`false`;
  // People-shares always allow saving (Add to my library gives the file anyway); a link says.
  const download =
    "userId" in viewer
      ? sql<boolean>`true`
      : sql<boolean>`coalesce((SELECT bool_or(s.allow_download) ${reachingShares(viewer)}), false)`;
  return entryQuery(db)
    .innerJoin("users as owner", "owner.id", "e.user_id")
    .where("e.id", "=", entryId)
    .where(sql<boolean>`(${own} OR EXISTS (SELECT 1 ${reachingShares(viewer)}))`)
    .select([own.as("own"), "owner.display_name as owner_name", download.as("allow_download")])
    .executeTakeFirst();
}

/** An entry with what serving it needs, and how the viewer reaches it. */
export type VisibleEntry = NonNullable<Awaited<ReturnType<typeof visibleRow>>>;

/**
 * The entry if `viewer` may see it: their own, or held by a live share that reaches them. Anything
 * else is 404, the same for an entry that does not exist.
 */
export async function visibleEntry(
  db: Kysely<Database>,
  viewer: Viewer,
  entryId: string,
): Promise<VisibleEntry> {
  const row = await visibleRow(db, viewer, entryId);
  if (row === undefined) throw new ApiError("not_found", "no such library entry");
  return row;
}

interface ShareRow {
  id: string;
  owner_id: string;
  owner_name: string;
  entry_id: string | null;
  playlist_id: string | null;
  source_id: string | null;
  allow_download: boolean;
  expires_at: Date | null;
  created_at: Date;
}

function toLive(r: ShareRow): LiveShare {
  const target: LiveShare["target"] =
    r.entry_id !== null
      ? { kind: "entry", id: r.entry_id }
      : r.playlist_id !== null
        ? { kind: "playlist", id: r.playlist_id }
        : { kind: "youtube", id: r.source_id ?? "" };
  return {
    id: r.id,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    target,
    allowDownload: r.allow_download,
    expiresAt: r.expires_at,
    sharedAt: r.created_at,
  };
}

function sharesWhere(db: Kysely<Database>, where: RawBuilder<boolean>) {
  return db
    .selectFrom("shares as s")
    .innerJoin("users as o", "o.id", "s.owner_id")
    .where(LIVE)
    .where(where)
    .select([
      "s.id",
      "s.owner_id",
      "o.display_name as owner_name",
      "s.entry_id",
      "s.playlist_id",
      "s.source_id",
      "s.allow_download",
      "s.expires_at",
      "s.created_at",
    ]);
}

async function findShare(db: Kysely<Database>, where: RawBuilder<boolean>) {
  const row = await sharesWhere(db, where).executeTakeFirst();
  return row === undefined ? undefined : toLive(row);
}

/** Every live share that reaches this person, newest change first (Shared › With me). */
export async function sharesReaching(
  db: Kysely<Database>,
  viewer: { userId: string },
): Promise<LiveShare[]> {
  const rows = await sharesWhere(db, reachesUser(viewer.userId))
    .orderBy("s.updated_at", "desc")
    .orderBy("s.id")
    .execute();
  return rows.map(toLive);
}

/** A live people-share that reaches this person, by id; undefined otherwise. */
export function shareFor(
  db: Kysely<Database>,
  viewer: { userId: string },
  shareId: string,
): Promise<LiveShare | undefined> {
  return findShare(db, sql<boolean>`s.id = ${shareId} AND ${reachesUser(viewer.userId)}`);
}

/**
 * Every live people-share to this group by someone still in it, newest change first (the group's
 * page), the viewer's own included.
 */
export async function sharesToGroup(db: Kysely<Database>, groupId: string): Promise<LiveShare[]> {
  const rows = await sharesWhere(
    db,
    sql<boolean>`s.mode = 'people'
      AND EXISTS (SELECT 1 FROM share_people sp WHERE sp.share_id = s.id AND sp.group_id = ${groupId})
      AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = ${groupId} AND gm.user_id = s.owner_id)`,
  )
    .orderBy("s.updated_at", "desc")
    .orderBy("s.id")
    .execute();
  return rows.map(toLive);
}

/** The live public link with this code; undefined for a dead or unknown one. */
export function linkShare(db: Kysely<Database>, code: string): Promise<LiveShare | undefined> {
  return findShare(db, reachesCode(code));
}
