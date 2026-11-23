import type {
  PeopleShare,
  PeopleShareBody,
  PublicLink,
  PublicLinkBody,
  ShareKind,
  SharePerson,
  ShareState,
} from "@uroboros/contract";
import { sql, type Kysely, type Selectable } from "kysely";
import type { Database, ShareMode, SharesTable } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { newCode } from "./codes.ts";
import { describeTarget } from "./targets.ts";

type Db = Kysely<Database>;
type ShareRow = Selectable<SharesTable>;

/** The `shares` column naming each kind of target. */
const COLUMN = { entry: "entry_id", playlist: "playlist_id", youtube: "source_id" } as const;

const kindOf = (r: ShareRow): ShareKind =>
  r.entry_id !== null ? "entry" : r.playlist_id !== null ? "playlist" : "youtube";
const targetOf = (r: ShareRow): string => r.entry_id ?? r.playlist_id ?? r.source_id ?? "";

const expired = (at: Date | null) => at !== null && at.getTime() <= Date.now();
const iso = (at: Date | null) => (at === null ? null : at.toISOString());

function shareRow(db: Db, ownerId: string, kind: ShareKind, id: string, mode: ShareMode) {
  return db
    .selectFrom("shares")
    .selectAll()
    .where("owner_id", "=", ownerId)
    .where("mode", "=", mode)
    .where(COLUMN[kind], "=", id)
    .executeTakeFirst();
}

async function peopleOf(db: Db, shareId: string): Promise<SharePerson[]> {
  const [users, groups] = await Promise.all([
    db
      .selectFrom("share_people as sp")
      .innerJoin("users as u", "u.id", "sp.user_id")
      .select([
        "u.id",
        "u.display_name",
        sql<string | null>`coalesce(u.username, u.email)`.as("handle"),
      ])
      .where("sp.share_id", "=", shareId)
      .orderBy("u.display_name")
      .execute(),
    db
      .selectFrom("share_people as sp")
      .select([
        "sp.group_name",
        sql<string>`(SELECT count(*) FROM users u
          WHERE u.disabled_at IS NULL AND u.groups ? sp.group_name)`.as("members"),
      ])
      .where("sp.share_id", "=", shareId)
      .where("sp.group_name", "is not", null)
      .orderBy("sp.group_name")
      .execute(),
  ]);
  return [
    ...users.map((u) => ({
      kind: "user" as const,
      id: u.id,
      name: u.display_name,
      handle: u.handle,
    })),
    ...groups.map((g) => ({
      kind: "group" as const,
      name: g.group_name ?? "",
      members: Number(g.members),
    })),
  ];
}

async function toPeople(db: Db, row: ShareRow | undefined): Promise<PeopleShare | null> {
  if (row === undefined) return null;
  return {
    people: await peopleOf(db, row.id),
    expiresAt: iso(row.expires_at),
    expired: expired(row.expires_at),
  };
}

function toLink(row: ShareRow | undefined): PublicLink | null {
  if (row?.code == null) return null;
  return {
    code: row.code,
    path: `/s/${row.code}`,
    allowDownload: row.allow_download,
    expiresAt: iso(row.expires_at),
    expired: expired(row.expires_at),
  };
}

/** How one of the owner's things is shared; 404 when it is not theirs. */
export async function shareState(
  db: Db,
  ownerId: string,
  kind: ShareKind,
  id: string,
): Promise<ShareState> {
  const facts = await describeTarget(db, ownerId, kind, id);
  const [people, link] = await Promise.all([
    shareRow(db, ownerId, kind, id, "people"),
    shareRow(db, ownerId, kind, id, "link"),
  ]);
  const changed = [people?.updated_at, link?.updated_at].filter((d): d is Date => d !== undefined);
  return {
    kind,
    id,
    title: facts.title,
    thumbnailUrl: facts.thumbnailUrl,
    people: await toPeople(db, people),
    link: toLink(link),
    updatedAt:
      changed.length === 0 ? null : new Date(Math.max(...changed.map(Number))).toISOString(),
  };
}

/** Everyone a people-share reaches now: its users and its groups' members, enabled ones only. */
async function reached(db: Db, shareId: string): Promise<Set<string>> {
  const rows = await sql<{ id: string }>`
    SELECT u.id FROM users u
    WHERE u.disabled_at IS NULL AND EXISTS (
      SELECT 1 FROM share_people sp
      WHERE sp.share_id = ${shareId}
        AND (sp.user_id = u.id OR (sp.group_name IS NOT NULL AND u.groups ? sp.group_name)))`.execute(
    db,
  );
  return new Set(rows.rows.map((r) => r.id));
}

/** The named users exist, are enabled and are not the owner; groups are kept once each. */
async function checkPeople(db: Db, ownerId: string, body: PeopleShareBody) {
  const userIds = [...new Set(body.people.flatMap((p) => (p.kind === "user" ? [p.id] : [])))];
  const groups = [...new Set(body.people.flatMap((p) => (p.kind === "group" ? [p.name] : [])))];
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

/**
 * Sets who a people-share reaches (an empty list removes it) and its expiry. Returns the state,
 * the share's id, and who it newly reaches (for "shared with you": never the owner, never
 * someone it already reached).
 */
export async function setPeople(
  db: Db,
  ownerId: string,
  kind: ShareKind,
  id: string,
  body: PeopleShareBody,
): Promise<{ state: ShareState; shareId: string | null; newlyReached: string[] }> {
  await describeTarget(db, ownerId, kind, id);
  const { userIds, groups } = await checkPeople(db, ownerId, body);
  const result = await db.transaction().execute(async (tx) => {
    const existing = await shareRow(tx, ownerId, kind, id, "people");
    const before = existing === undefined ? new Set<string>() : await reached(tx, existing.id);
    if (userIds.length === 0 && groups.length === 0) {
      if (existing !== undefined)
        await tx.deleteFrom("shares").where("id", "=", existing.id).execute();
      return { shareId: null, newlyReached: [] };
    }
    const expiresAt = body.expiresAt === null ? null : new Date(body.expiresAt);
    const shareId =
      existing === undefined
        ? (
            await tx
              .insertInto("shares")
              .values({
                owner_id: ownerId,
                mode: "people",
                [COLUMN[kind]]: id,
                expires_at: expiresAt,
              })
              .returning("id")
              .executeTakeFirstOrThrow()
          ).id
        : existing.id;
    if (existing !== undefined) {
      await tx
        .updateTable("shares")
        .set({ expires_at: expiresAt, updated_at: new Date() })
        .where("id", "=", shareId)
        .execute();
      await tx.deleteFrom("share_people").where("share_id", "=", shareId).execute();
    }
    await tx
      .insertInto("share_people")
      .values([
        ...userIds.map((user_id) => ({ share_id: shareId, user_id })),
        ...groups.map((group_name) => ({ share_id: shareId, group_name })),
      ])
      .execute();
    const after = await reached(tx, shareId);
    after.delete(ownerId);
    return { shareId, newlyReached: [...after].filter((u) => !before.has(u)) };
  });
  return { ...result, state: await shareState(db, ownerId, kind, id) };
}

/** Turns the public link on (a new code) or changes it (the same code). */
export async function setLink(
  db: Db,
  ownerId: string,
  kind: ShareKind,
  id: string,
  body: PublicLinkBody,
): Promise<ShareState> {
  await describeTarget(db, ownerId, kind, id);
  const expiresAt = body.expiresAt === null ? null : new Date(body.expiresAt);
  const existing = await shareRow(db, ownerId, kind, id, "link");
  if (existing === undefined) {
    await db
      .insertInto("shares")
      .values({
        owner_id: ownerId,
        mode: "link",
        code: newCode(),
        [COLUMN[kind]]: id,
        allow_download: body.allowDownload,
        expires_at: expiresAt,
      })
      .execute();
  } else {
    await db
      .updateTable("shares")
      .set({ allow_download: body.allowDownload, expires_at: expiresAt, updated_at: new Date() })
      .where("id", "=", existing.id)
      .execute();
  }
  return shareState(db, ownerId, kind, id);
}

/** Stops one mode of sharing (a link's code dies with it). */
export async function stopSharing(
  db: Db,
  ownerId: string,
  kind: ShareKind,
  id: string,
  mode: ShareMode,
): Promise<void> {
  await describeTarget(db, ownerId, kind, id);
  await db
    .deleteFrom("shares")
    .where("owner_id", "=", ownerId)
    .where("mode", "=", mode)
    .where(COLUMN[kind], "=", id)
    .execute();
}

/** Everything the owner shares, one row per thing, the latest change first (Shared › By me). */
export async function listMyShares(db: Db, ownerId: string): Promise<ShareState[]> {
  const rows = await db
    .selectFrom("shares")
    .selectAll()
    .where("owner_id", "=", ownerId)
    .orderBy("updated_at", "desc")
    .execute();
  const seen = new Set<string>();
  const things = rows.flatMap((r) => {
    const key = `${kindOf(r)}|${targetOf(r)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ kind: kindOf(r), id: targetOf(r) }];
  });
  return Promise.all(things.map((x) => shareState(db, ownerId, x.kind, x.id)));
}
