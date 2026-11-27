import type { PeopleShareBody, PublicLinkBody, ShareKind, ShareState } from "@uroboros/contract";
import type { Kysely, Selectable } from "kysely";
import type { Database, ShareMode, SharesTable } from "../db/schema.ts";
import { newCode } from "./codes.ts";
import {
  clipShareState,
  listMyClipShares,
  setClipLink,
  setClipPeople,
  stopClipSharing,
} from "./clipShares.ts";
import { checkGroups, checkPeople, reached, replacePeople, toLink, toPeople } from "./people.ts";
import { describeTarget } from "./targets.ts";

type Db = Kysely<Database>;
type ShareRow = Selectable<SharesTable>;

/** What `shares` holds: every kind but a clip, which `clip_shares` holds (clipShares.ts). */
type ThingKind = Exclude<ShareKind, "clip">;

/** The `shares` column naming each kind of target. */
const COLUMN = { entry: "entry_id", playlist: "playlist_id", youtube: "source_id" } as const;

const kindOf = (r: ShareRow): ThingKind =>
  r.entry_id !== null ? "entry" : r.playlist_id !== null ? "playlist" : "youtube";
const targetOf = (r: ShareRow): string => r.entry_id ?? r.playlist_id ?? r.source_id ?? "";

function shareRow(db: Db, ownerId: string, kind: ThingKind, id: string, mode: ShareMode) {
  return db
    .selectFrom("shares")
    .selectAll()
    .where("owner_id", "=", ownerId)
    .where("mode", "=", mode)
    .where(COLUMN[kind], "=", id)
    .executeTakeFirst();
}

/** How one of the owner's things is shared; 404 when it is not theirs. */
export async function shareState(
  db: Db,
  ownerId: string,
  kind: ShareKind,
  id: string,
): Promise<ShareState> {
  if (kind === "clip") return clipShareState(db, ownerId, id);
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
    people: await toPeople(db, "share_people", people),
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
  if (kind === "clip") return setClipPeople(db, ownerId, id, body);
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
  if (kind === "clip") return setClipLink(db, ownerId, id, body);
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
  if (kind === "clip") {
    await stopClipSharing(db, ownerId, id, mode);
    return;
  }
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
  const [states, clips] = await Promise.all([
    Promise.all(things.map((x) => shareState(db, ownerId, x.kind, x.id))),
    listMyClipShares(db, ownerId),
  ]);
  // Clips (docs/sharing.md#clips) among the rest, the latest change first.
  return [...states, ...clips].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}
