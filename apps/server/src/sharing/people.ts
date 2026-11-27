import type { PeopleShare, PeopleShareBody, PublicLink, SharePerson } from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";

/**
 * Who a people-share reaches (docs/sharing.md), for a video or playlist's share (`share_people`
 * of `shares`) and a clip's (`clip_share_people` of `clip_shares`, docs/sharing.md#clips) alike.
 */

type Db = Kysely<Database>;

export type PeopleTable = "share_people" | "clip_share_people";

/** The shares table a people table belongs to. */
const SHARES = { share_people: "shares", clip_share_people: "clip_shares" } as const;

/** The users and groups a share names, users by name, then groups by name. */
export async function peopleOf(
  db: Db,
  table: PeopleTable,
  shareId: string,
): Promise<SharePerson[]> {
  const people = sql.table(table);
  const [users, groups] = await Promise.all([
    sql<{ id: string; display_name: string; handle: string | null }>`
      SELECT u.id, u.display_name, coalesce(u.username, u.email) AS handle
      FROM ${people} sp JOIN users u ON u.id = sp.user_id
      WHERE sp.share_id = ${shareId}
      ORDER BY u.display_name`.execute(db),
    sql<{ id: string; name: string; members: string }>`
      SELECT g.id, g.name, (SELECT count(*) FROM group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = g.id AND u.disabled_at IS NULL) AS members
      FROM ${people} sp JOIN groups g ON g.id = sp.group_id
      WHERE sp.share_id = ${shareId}
      ORDER BY g.name, g.id`.execute(db),
  ]);
  return [
    ...users.rows.map((u) => ({
      kind: "user" as const,
      id: u.id,
      name: u.display_name,
      handle: u.handle,
    })),
    ...groups.rows.map((g) => ({
      kind: "group" as const,
      id: g.id,
      name: g.name,
      members: Number(g.members),
    })),
  ];
}

/**
 * Everyone a people-share reaches now, enabled ones only: its users, and the members of its groups
 * the owner is still in.
 */
export async function reached(db: Db, table: PeopleTable, shareId: string): Promise<Set<string>> {
  const rows = await sql<{ id: string }>`
    SELECT u.id FROM users u
    WHERE u.disabled_at IS NULL AND EXISTS (
      SELECT 1 FROM ${sql.table(table)} sp JOIN ${sql.table(SHARES[table])} s ON s.id = sp.share_id
      WHERE sp.share_id = ${shareId} AND (
        sp.user_id = u.id
        OR (sp.group_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM group_members gm
            WHERE gm.group_id = sp.group_id AND gm.user_id = u.id)
          AND EXISTS (SELECT 1 FROM group_members gm
            WHERE gm.group_id = sp.group_id AND gm.user_id = s.owner_id))))`.execute(db);
  return new Set(rows.rows.map((r) => r.id));
}

/**
 * The owner is in every group named. The groups are locked first (FOR KEY SHARE, in id order) so a
 * leave or a delete of one waits for this share to commit, and its own check then sees the share;
 * membership is read in a later statement, after any such change committed. Any miss is 400.
 */
export async function checkGroups(tx: Db, ownerId: string, groupIds: string[]): Promise<void> {
  if (groupIds.length === 0) return;
  const locked = await tx
    .selectFrom("groups")
    .select("id")
    .where("id", "in", groupIds)
    .orderBy("id")
    .forKeyShare()
    .execute();
  const inside = await tx
    .selectFrom("group_members")
    .select("group_id")
    .where("user_id", "=", ownerId)
    .where("group_id", "in", groupIds)
    .execute();
  if (locked.length !== groupIds.length || inside.length !== groupIds.length) {
    throw new ApiError("bad_request", "no such group");
  }
}

/** The named users exist, are enabled and are not the owner; groups are kept once each. */
export async function checkPeople(db: Db, ownerId: string, body: PeopleShareBody) {
  const userIds = [...new Set(body.people.flatMap((p) => (p.kind === "user" ? [p.id] : [])))];
  const groups = [...new Set(body.people.flatMap((p) => (p.kind === "group" ? [p.id] : [])))];
  if (userIds.includes(ownerId))
    throw new ApiError("bad_request", "you cannot share with yourself");
  if (userIds.length > 0) {
    const found = await db
      .selectFrom("users")
      .select("id")
      .where("id", "in", userIds)
      .where("disabled_at", "is", null)
      .execute();
    if (found.length !== userIds.length) throw new ApiError("bad_request", "no such user");
  }
  return { userIds, groups };
}

/** Puts these users and groups on a share in place of whoever it named (inside the caller's transaction). */
export async function replacePeople(
  tx: Db,
  table: PeopleTable,
  shareId: string,
  people: { userIds: string[]; groups: string[] },
): Promise<void> {
  await tx.deleteFrom(table).where("share_id", "=", shareId).execute();
  await tx
    .insertInto(table)
    .values([
      ...people.userIds.map((user_id) => ({ share_id: shareId, user_id })),
      ...people.groups.map((group_id) => ({ share_id: shareId, group_id })),
    ])
    .execute();
}

const expired = (at: Date | null) => at !== null && at.getTime() <= Date.now();
const iso = (at: Date | null) => (at === null ? null : at.toISOString());

/** A share's row as its people and link views need it, from `shares` or `clip_shares`. */
interface Row {
  id: string;
  code: string | null;
  allow_download: boolean;
  expires_at: Date | null;
}

/** A people-share as its owner sees it: who it names and its expiry. */
export async function toPeople(
  db: Db,
  table: PeopleTable,
  row: Row | undefined,
): Promise<PeopleShare | null> {
  if (row === undefined) return null;
  return {
    people: await peopleOf(db, table, row.id),
    expiresAt: iso(row.expires_at),
    expired: expired(row.expires_at),
  };
}

/** A public link as its owner sees it. */
export function toLink(row: Row | undefined): PublicLink | null {
  if (row?.code == null) return null;
  return {
    code: row.code,
    path: `/s/${row.code}`,
    allowDownload: row.allow_download,
    expiresAt: iso(row.expires_at),
    expired: expired(row.expires_at),
  };
}
