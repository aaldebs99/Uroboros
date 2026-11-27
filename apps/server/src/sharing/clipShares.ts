import type { PeopleShareBody, PublicLinkBody, ShareState } from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database, ShareMode } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { clipOf, clipTitle } from "../exports/clip.ts";
import { thumbnailUrl } from "../library/thumbnailUrl.ts";
import { newCode } from "./codes.ts";
import { checkGroups, checkPeople, reached, replacePeople, toLink, toPeople } from "./people.ts";
import type { TargetFacts } from "./targets.ts";

/**
 * Sharing a clip on its own (docs/sharing.md#clips), by its owner: their own copy of one range of
 * their own video (`exports` with a clip), with people and groups or by a public link, as a video
 * is shared (manage.ts), in `clip_shares`. A clip can be shared while its copy is being made.
 */

type Db = Kysely<Database>;

/** The owner's clip copy of their own entry, as its shares show it; 404 when it is not that. */
export async function clipFacts(
  db: Db,
  ownerId: string,
  exportId: string,
): Promise<TargetFacts & { entryId: string }> {
  const row = await db
    .selectFrom("exports as x")
    .innerJoin("library_entries as e", (j) =>
      j.onRef("e.id", "=", "x.entry_id").on("e.user_id", "=", ownerId),
    )
    .innerJoin("renditions as r", "r.id", "x.rendition_id")
    .innerJoin("media as m", "m.id", "r.media_id")
    .select([
      "x.entry_id",
      "x.clip_start",
      "x.clip_end",
      "m.title",
      "m.video_id",
      "m.thumbnail_key",
      "r.video_codec",
    ])
    .where("x.id", "=", exportId)
    .where("x.user_id", "=", ownerId)
    .where("x.clip_start", "is not", null)
    .executeTakeFirst();
  const clip = row === undefined ? null : clipOf(row);
  if (row === undefined || clip === null) throw new ApiError("not_found", "no such clip");
  return {
    title: clipTitle(row.title ?? row.video_id, clip),
    // The video's own description can list moments of all of it: a clip goes without.
    description: null,
    thumbnailUrl: thumbnailUrl(`/api/clips/${exportId}/thumbnail`, row.thumbnail_key),
    previewUrl: null,
    hasVideo: row.video_codec !== null,
    count: null,
    coverEntryId: null,
    entryId: row.entry_id,
  };
}

function clipShareRow(db: Db, ownerId: string, exportId: string, mode: ShareMode) {
  return db
    .selectFrom("clip_shares")
    .selectAll()
    .where("owner_id", "=", ownerId)
    .where("export_id", "=", exportId)
    .where("mode", "=", mode)
    .executeTakeFirst();
}

/** How one of the owner's clips is shared; 404 when it is not theirs. */
export async function clipShareState(
  db: Db,
  ownerId: string,
  exportId: string,
): Promise<ShareState> {
  const facts = await clipFacts(db, ownerId, exportId);
  const [people, link] = await Promise.all([
    clipShareRow(db, ownerId, exportId, "people"),
    clipShareRow(db, ownerId, exportId, "link"),
  ]);
  const changed = [people?.updated_at, link?.updated_at].filter(
    (d): d is Date | string => d !== undefined,
  );
  return {
    kind: "clip",
    id: exportId,
    title: facts.title,
    thumbnailUrl: facts.thumbnailUrl,
    people: await toPeople(db, "clip_share_people", people),
    link: toLink(link),
    updatedAt:
      changed.length === 0
        ? null
        : new Date(Math.max(...changed.map((d) => new Date(d).getTime()))).toISOString(),
  };
}

/** Sets who a clip's people-share reaches (an empty list removes it), as `setPeople` does a video's. */
export async function setClipPeople(
  db: Db,
  ownerId: string,
  exportId: string,
  body: PeopleShareBody,
): Promise<{ state: ShareState; shareId: string | null; newlyReached: string[] }> {
  const { entryId } = await clipFacts(db, ownerId, exportId);
  const { userIds, groups } = await checkPeople(db, ownerId, body);
  const result = await db.transaction().execute(async (tx) => {
    await checkGroups(tx, ownerId, groups);
    const existing = await clipShareRow(tx, ownerId, exportId, "people");
    const before =
      existing === undefined
        ? new Set<string>()
        : await reached(tx, "clip_share_people", existing.id);
    if (userIds.length === 0 && groups.length === 0) {
      if (existing !== undefined)
        await tx.deleteFrom("clip_shares").where("id", "=", existing.id).execute();
      return { shareId: null, newlyReached: [] };
    }
    const expiresAt = body.expiresAt === null ? null : new Date(body.expiresAt);
    const shareId =
      existing === undefined
        ? (
            await tx
              .insertInto("clip_shares")
              .values({
                owner_id: ownerId,
                export_id: exportId,
                entry_id: entryId,
                mode: "people",
                expires_at: expiresAt,
              })
              .returning("id")
              .executeTakeFirstOrThrow()
          ).id
        : existing.id;
    if (existing !== undefined) {
      await tx
        .updateTable("clip_shares")
        .set({ expires_at: expiresAt, updated_at: new Date() })
        .where("id", "=", shareId)
        .execute();
    }
    await replacePeople(tx, "clip_share_people", shareId, { userIds, groups });
    const after = await reached(tx, "clip_share_people", shareId);
    after.delete(ownerId);
    return { shareId, newlyReached: [...after].filter((u) => !before.has(u)) };
  });
  return { ...result, state: await clipShareState(db, ownerId, exportId) };
}

/** Turns a clip's public link on (a new code) or changes it (the same code). */
export async function setClipLink(
  db: Db,
  ownerId: string,
  exportId: string,
  body: PublicLinkBody,
): Promise<ShareState> {
  const { entryId } = await clipFacts(db, ownerId, exportId);
  const expiresAt = body.expiresAt === null ? null : new Date(body.expiresAt);
  const existing = await clipShareRow(db, ownerId, exportId, "link");
  if (existing === undefined) {
    await db
      .insertInto("clip_shares")
      .values({
        owner_id: ownerId,
        export_id: exportId,
        entry_id: entryId,
        mode: "link",
        code: newCode(),
        allow_download: body.allowDownload,
        expires_at: expiresAt,
      })
      .execute();
  } else {
    await db
      .updateTable("clip_shares")
      .set({ allow_download: body.allowDownload, expires_at: expiresAt, updated_at: new Date() })
      .where("id", "=", existing.id)
      .execute();
  }
  return clipShareState(db, ownerId, exportId);
}

/** Stops one mode of sharing a clip (a link's code dies with it). */
export async function stopClipSharing(
  db: Db,
  ownerId: string,
  exportId: string,
  mode: ShareMode,
): Promise<void> {
  await clipFacts(db, ownerId, exportId);
  await db
    .deleteFrom("clip_shares")
    .where("owner_id", "=", ownerId)
    .where("export_id", "=", exportId)
    .where("mode", "=", mode)
    .execute();
}

/** The owner's shared clips, one row each (Shared › By me). */
export async function listMyClipShares(db: Db, ownerId: string): Promise<ShareState[]> {
  const rows = await db
    .selectFrom("clip_shares")
    .select("export_id")
    .distinct()
    .where("owner_id", "=", ownerId)
    .execute();
  return Promise.all(rows.map((r) => clipShareState(db, ownerId, r.export_id)));
}

/** A member leaving a group ends their clips' shares to it, as their videos' (groups/store.ts). */
export async function endClipPeopleInGroup(
  tx: Db,
  groupId: string,
  memberId: string,
): Promise<void> {
  await tx
    .deleteFrom("clip_share_people")
    .where("group_id", "=", groupId)
    .where("share_id", "in", (eb) =>
      eb.selectFrom("clip_shares").select("id").where("owner_id", "=", memberId),
    )
    .execute();
}
