import type {
  PeopleShare,
  PeopleShareBody,
  PublicLink,
  PublicLinkBody,
  ShareKind,
  ShareState,
} from "@uroboros/contract";
import type { Kysely, Selectable } from "kysely";
import type { Database, ShareMode, SharesTable } from "../db/schema.ts";
import { newCode } from "./codes.ts";
import { checkGroups, checkPeople, peopleOf, reached, replacePeople } from "./people.ts";
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

async function toPeople(db: Db, row: ShareRow | undefined): Promise<PeopleShare | null> {
  if (row === undefined) return null;
  return {
    people: await peopleOf(db, "share_people", row.id),
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
    await checkGroups(tx, ownerId, groups);
    const existing = await shareRow(tx, ownerId, kind, id, "people");
    const before =
      existing === undefined ? new Set<string>() : await reached(tx, "share_people", existing.id);
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
    }
    await replacePeople(tx, "share_people", shareId, { userIds, groups });
    const after = await reached(tx, "share_people", shareId);
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
    .orderBy("id", "desc")
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
