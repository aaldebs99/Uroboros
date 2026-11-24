import {
  MAX_GROUP_MEMBERS,
  MAX_GROUPS_CREATED,
  type AdminGroup,
  type GroupDetail,
  type GroupRole,
  type GroupSummary,
} from "@uroboros/contract";
import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { lockKey } from "../shared/lockKeys.ts";

/**
 * Groups people make (docs/sharing.md "Groups"). Every change runs in one transaction that first
 * locks the group's row, so the caps and the rule that a group keeps an enabled manager hold when
 * two people act at once. Someone outside a group gets the same 404 as for one that doesn't exist.
 */

type Db = Kysely<Database>;

const NOT_FOUND = "no such group";
const LAST_MANAGER = "Make someone else a manager first, or delete the group";

const iso = (d: Date) => d.toISOString();
const roleOf = (manager: boolean): GroupRole => (manager ? "manager" : "member");

/** A group's enabled members, as a correlated count over `g`. */
const enabledMembers = sql<string>`(SELECT count(*) FROM group_members m
  JOIN users u ON u.id = m.user_id WHERE m.group_id = g.id AND u.disabled_at IS NULL)`;

/** Locks the group's row and reads the caller's place in it; 404 unless they are in it. */
async function lockGroup(tx: Db, userId: string, groupId: string) {
  const group = await tx
    .selectFrom("groups")
    .select(["id", "name"])
    .where("id", "=", groupId)
    .forUpdate()
    .executeTakeFirst();
  const me =
    group === undefined
      ? undefined
      : await tx
          .selectFrom("group_members")
          .select("manager")
          .where("group_id", "=", groupId)
          .where("user_id", "=", userId)
          .executeTakeFirst();
  if (group === undefined || me === undefined) throw new ApiError("not_found", NOT_FOUND);
  return { name: group.name, manager: me.manager };
}

function requireManager(me: { manager: boolean }): void {
  if (!me.manager) throw new ApiError("forbidden", "only a group's managers can change it");
}

/** Enabled managers of the group other than `except`. */
async function otherManagers(tx: Db, groupId: string, except: string): Promise<number> {
  const { n } = await tx
    .selectFrom("group_members as m")
    .innerJoin("users as u", "u.id", "m.user_id")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("m.group_id", "=", groupId)
    .where("m.manager", "=", true)
    .where("u.disabled_at", "is", null)
    .where("m.user_id", "<>", except)
    .executeTakeFirstOrThrow();
  return Number(n);
}

/** The caller's groups, by name. */
export async function listGroups(db: Db, userId: string): Promise<GroupSummary[]> {
  const rows = await db
    .selectFrom("group_members as me")
    .innerJoin("groups as g", "g.id", "me.group_id")
    .select(["g.id", "g.name", "me.manager", enabledMembers.as("members")])
    .where("me.user_id", "=", userId)
    .orderBy("g.name")
    .orderBy("g.id")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: roleOf(r.manager),
    members: Number(r.members),
  }));
}

/** A group as a member sees it: everyone in it, managers first, then by name. */
export async function groupDetail(db: Db, userId: string, groupId: string): Promise<GroupDetail> {
  const group = await db
    .selectFrom("groups")
    .select(["id", "name", "created_at"])
    .where("id", "=", groupId)
    .executeTakeFirst();
  const rows =
    group === undefined
      ? []
      : await db
          .selectFrom("group_members as m")
          .innerJoin("users as u", "u.id", "m.user_id")
          .select([
            "u.id",
            "u.display_name",
            sql<string | null>`coalesce(u.username, u.email)`.as("handle"),
            "u.disabled_at",
            "m.manager",
            "m.added_at",
          ])
          .where("m.group_id", "=", groupId)
          .orderBy("m.manager", "desc")
          .orderBy("u.display_name")
          .orderBy("u.id")
          .execute();
  const me = rows.find((r) => r.id === userId);
  if (group === undefined || me === undefined) throw new ApiError("not_found", NOT_FOUND);
  return {
    id: group.id,
    name: group.name,
    role: roleOf(me.manager),
    members: rows.map((r) => ({
      id: r.id,
      name: r.display_name,
      handle: r.handle,
      role: roleOf(r.manager),
      disabled: r.disabled_at !== null,
      addedAt: iso(r.added_at),
    })),
    createdAt: iso(group.created_at),
  };
}

/** Makes a group with its maker as its manager; at most MAX_GROUPS_CREATED they are still in. */
export async function createGroup(db: Db, userId: string, name: string): Promise<GroupDetail> {
  const id = await db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(${lockKey("GRPS", userId)})`.execute(tx);
    const { n } = await tx
      .selectFrom("groups as g")
      .innerJoin("group_members as m", (j) =>
        j.onRef("m.group_id", "=", "g.id").on("m.user_id", "=", userId),
      )
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("g.created_by", "=", userId)
      .executeTakeFirstOrThrow();
    if (Number(n) >= MAX_GROUPS_CREATED) {
      throw new ApiError(
        "conflict",
        `you can have made at most ${String(MAX_GROUPS_CREATED)} groups; leave or delete one first`,
      );
    }
    const group = await tx
      .insertInto("groups")
      .values({ name, created_by: userId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await tx
      .insertInto("group_members")
      .values({ group_id: group.id, user_id: userId, manager: true })
      .execute();
    return group.id;
  });
  return groupDetail(db, userId, id);
}

export async function renameGroup(
  db: Db,
  userId: string,
  groupId: string,
  name: string,
): Promise<GroupDetail> {
  await db.transaction().execute(async (tx) => {
    requireManager(await lockGroup(tx, userId, groupId));
    await tx
      .updateTable("groups")
      .set({ name, updated_at: new Date() })
      .where("id", "=", groupId)
      .execute();
  });
  return groupDetail(db, userId, groupId);
}

export async function deleteGroup(db: Db, userId: string, groupId: string): Promise<void> {
  await db.transaction().execute(async (tx) => {
    requireManager(await lockGroup(tx, userId, groupId));
    await tx.deleteFrom("groups").where("id", "=", groupId).execute();
  });
}

/**
 * Adds enabled accounts to the group (any already in it are skipped). Returns the group, its name,
 * and who was added (to tell them).
 */
export async function addMembers(
  db: Db,
  userId: string,
  groupId: string,
  userIds: readonly string[],
): Promise<{ detail: GroupDetail; name: string; added: string[] }> {
  const wanted = [...new Set(userIds)];
  const { name, added } = await db.transaction().execute(async (tx) => {
    const me = await lockGroup(tx, userId, groupId);
    requireManager(me);
    const found = await tx
      .selectFrom("users")
      .select("id")
      .where("id", "in", wanted)
      .where("disabled_at", "is", null)
      .execute();
    if (found.length !== wanted.length) throw new ApiError("bad_request", "no such user");
    const current = await tx
      .selectFrom("group_members")
      .select("user_id")
      .where("group_id", "=", groupId)
      .execute();
    const inside = new Set(current.map((r) => r.user_id));
    const fresh = wanted.filter((id) => !inside.has(id));
    if (current.length + fresh.length > MAX_GROUP_MEMBERS) {
      throw new ApiError("conflict", `a group holds at most ${String(MAX_GROUP_MEMBERS)} people`);
    }
    if (fresh.length > 0) {
      await tx
        .insertInto("group_members")
        .values(fresh.map((id) => ({ group_id: groupId, user_id: id })))
        .execute();
      await tx
        .updateTable("groups")
        .set({ updated_at: new Date() })
        .where("id", "=", groupId)
        .execute();
    }
    return { name: me.name, added: fresh };
  });
  return { detail: await groupDetail(db, userId, groupId), name, added };
}

/** Makes a member a manager or a manager a member; a group keeps an enabled manager. */
export async function setRole(
  db: Db,
  userId: string,
  groupId: string,
  memberId: string,
  role: GroupRole,
): Promise<GroupDetail> {
  await db.transaction().execute(async (tx) => {
    requireManager(await lockGroup(tx, userId, groupId));
    const target = await tx
      .selectFrom("group_members as m")
      .innerJoin("users as u", "u.id", "m.user_id")
      .select(["m.manager", "u.disabled_at"])
      .where("m.group_id", "=", groupId)
      .where("m.user_id", "=", memberId)
      .executeTakeFirst();
    if (target === undefined) throw new ApiError("not_found", "no such member");
    if (role === "manager" && target.disabled_at !== null) {
      throw new ApiError("bad_request", "a disabled account can't be a manager");
    }
    if (role === "member" && target.manager && (await otherManagers(tx, groupId, memberId)) === 0) {
      throw new ApiError("conflict", LAST_MANAGER);
    }
    await tx
      .updateTable("group_members")
      .set({ manager: role === "manager" })
      .where("group_id", "=", groupId)
      .where("user_id", "=", memberId)
      .execute();
  });
  return groupDetail(db, userId, groupId);
}

/**
 * Takes someone out of the group: themselves (leaving), or anyone, by a manager. The last enabled
 * manager can't leave while another enabled member remains; the last member leaving deletes the
 * group (a trigger).
 */
export async function removeMember(
  db: Db,
  userId: string,
  groupId: string,
  memberId: string,
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const me = await lockGroup(tx, userId, groupId);
    if (memberId !== userId) requireManager(me);
    const target = await tx
      .selectFrom("group_members as m")
      .innerJoin("users as u", "u.id", "m.user_id")
      .select(["m.manager", "u.disabled_at"])
      .where("m.group_id", "=", groupId)
      .where("m.user_id", "=", memberId)
      .executeTakeFirst();
    if (target === undefined) throw new ApiError("not_found", "no such member");
    if (target.manager && target.disabled_at === null) {
      const { n } = await tx
        .selectFrom("group_members as m")
        .innerJoin("users as u", "u.id", "m.user_id")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("m.group_id", "=", groupId)
        .where("m.user_id", "<>", memberId)
        .where("u.disabled_at", "is", null)
        .executeTakeFirstOrThrow();
      if (Number(n) > 0 && (await otherManagers(tx, groupId, memberId)) === 0) {
        throw new ApiError("conflict", LAST_MANAGER);
      }
    }
    await tx
      .deleteFrom("group_members")
      .where("group_id", "=", groupId)
      .where("user_id", "=", memberId)
      .execute();
  });
}

/** Every group, for admins: its name, enabled members and managers' names. */
export async function listAllGroups(db: Db): Promise<AdminGroup[]> {
  const rows = await db
    .selectFrom("groups as g")
    .select([
      "g.id",
      "g.name",
      "g.created_at",
      enabledMembers.as("members"),
      sql<string[]>`coalesce((SELECT array_agg(u.display_name ORDER BY u.display_name)
        FROM group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = g.id AND m.manager), '{}')`.as("managers"),
    ])
    .orderBy("g.name")
    .orderBy("g.id")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    members: Number(r.members),
    managers: r.managers,
    createdAt: iso(r.created_at),
  }));
}

/** Deletes any group (admins); 404 when there is none. */
export async function adminDeleteGroup(db: Db, groupId: string): Promise<void> {
  const res = await db.deleteFrom("groups").where("id", "=", groupId).executeTakeFirst();
  if (res.numDeletedRows === 0n) throw new ApiError("not_found", NOT_FOUND);
}
