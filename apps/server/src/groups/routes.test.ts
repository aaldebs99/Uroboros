import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  AdminGroup,
  GroupDetail,
  GroupSummary,
  MAX_GROUP_MEMBERS,
  MAX_GROUPS_CREATED,
} from "@uroboros/contract";
import { sql } from "kysely";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { queuedData } from "../../test/jobs.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import type { NotifyJob } from "../downloads/queues.ts";

const logger = pino({ level: "silent" });
let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let ann: SignedIn;
let ben: SignedIn;
let cat: SignedIn;
let dan: SignedIn;
let root: SignedIn;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  ann = await signedIn(t.db, { username: "grann" });
  ben = await signedIn(t.db, { username: "grben" });
  cat = await signedIn(t.db, { username: "grcat" });
  dan = await signedIn(t.db, { username: "grdan" });
  root = await signedIn(t.db, { username: "grroot", role: "admin" });
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const app = (s: SignedIn): OpenAPIHono =>
  asUser(createApp({ db: t.db, version: "t", logger, downloads: h.ctx }, { webDist: null }), s);
const send = (s: SignedIn, method: string, path: string, json?: unknown) =>
  app(s).request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });

async function detail(res: Response, status = 200): Promise<GroupDetail> {
  expect(res.status).toBe(status);
  return GroupDetail.parse(await res.json());
}
const create = async (s: SignedIn, name: string) =>
  detail(await send(s, "POST", "/api/groups", { name }), 201);
const add = (s: SignedIn, id: string, userIds: string[]) =>
  send(s, "POST", `/api/groups/${id}/members`, { userIds });
const role = (s: SignedIn, id: string, userId: string, r: "manager" | "member") =>
  send(s, "PATCH", `/api/groups/${id}/members/${userId}`, { role: r });
const remove = (s: SignedIn, id: string, userId: string) =>
  send(s, "DELETE", `/api/groups/${id}/members/${userId}`);
async function mine(s: SignedIn): Promise<GroupSummary[]> {
  const res = await send(s, "GET", "/api/groups");
  expect(res.status).toBe(200);
  return z.array(GroupSummary).parse(await res.json());
}
const roleOf = (d: GroupDetail, userId: string) => d.members.find((m) => m.id === userId)?.role;
const groupExists = async (id: string) =>
  (await t.db.selectFrom("groups").select("id").where("id", "=", id).executeTakeFirst()) !==
  undefined;

/** A fresh local account, signed in. */
let n = 0;
const someone = () => signedIn(t.db, { username: `grx${String(++n)}` });

describe("making and seeing groups", () => {
  it("the creator manages a new group, alone in it", async () => {
    const g = await create(ann, "Family");
    expect(g).toMatchObject({ name: "Family", role: "manager" });
    expect(g.members).toEqual([
      expect.objectContaining({ id: ann.userId, name: "grann", role: "manager", disabled: false }),
    ]);
    expect(await mine(ann)).toContainEqual({
      id: g.id,
      name: "Family",
      role: "manager",
      members: 1,
    });
  });

  it("trims a name and keeps it to 1–100 characters", async () => {
    expect((await create(ann, "  Trip  ")).name).toBe("Trip");
    expect((await send(ann, "POST", "/api/groups", { name: "  " })).status).toBe(400);
    expect((await send(ann, "POST", "/api/groups", { name: "x".repeat(101) })).status).toBe(400);
  });

  it("people a manager adds join at once and see the group; adding them again is skipped", async () => {
    const g = await create(ann, "Friends");
    const after = await detail(await add(ann, g.id, [ben.userId, cat.userId]));
    expect(after.members).toHaveLength(3);
    expect(roleOf(after, ben.userId)).toBe("member");
    expect(await mine(ben)).toContainEqual({
      id: g.id,
      name: "Friends",
      role: "member",
      members: 3,
    });
    const seen = await detail(await send(ben, "GET", `/api/groups/${g.id}`));
    expect(seen.role).toBe("member");
    expect(seen.members.map((m) => m.id).sort()).toEqual(
      [ann.userId, ben.userId, cat.userId].sort(),
    );
    expect((await detail(await add(ann, g.id, [ben.userId]))).members).toHaveLength(3);
  });

  it("an unknown or disabled account can't be added", async () => {
    const g = await create(ann, "Club");
    const gone = await someone();
    await t.db
      .updateTable("users")
      .set({ disabled_at: new Date() })
      .where("id", "=", gone.userId)
      .execute();
    expect((await add(ann, g.id, [crypto.randomUUID()])).status).toBe(400);
    expect((await add(ann, g.id, [gone.userId])).status).toBe(400);
  });

  it("someone outside a group gets 404, and a member who isn't a manager 403", async () => {
    const g = await create(ann, "Team");
    await add(ann, g.id, [ben.userId, cat.userId]);
    expect((await send(dan, "GET", `/api/groups/${g.id}`)).status).toBe(404);
    expect((await send(dan, "PATCH", `/api/groups/${g.id}`, { name: "Mine" })).status).toBe(404);
    expect((await send(dan, "DELETE", `/api/groups/${g.id}`)).status).toBe(404);
    expect((await send(ben, "PATCH", `/api/groups/${g.id}`, { name: "Mine" })).status).toBe(403);
    expect((await add(ben, g.id, [dan.userId])).status).toBe(403);
    expect((await role(ben, g.id, cat.userId, "manager")).status).toBe(403);
    expect((await remove(ben, g.id, cat.userId)).status).toBe(403);
    expect((await send(ben, "DELETE", `/api/groups/${g.id}`)).status).toBe(403);
    expect((await send(ann, "GET", `/api/groups/${crypto.randomUUID()}`)).status).toBe(404);
  });
});

describe("managing a group", () => {
  it("a manager renames it, makes others managers and back, removes people, and deletes it", async () => {
    const g = await create(ann, "Band");
    await add(ann, g.id, [ben.userId, cat.userId]);
    expect(
      (await detail(await send(ann, "PATCH", `/api/groups/${g.id}`, { name: "The Band" }))).name,
    ).toBe("The Band");
    expect(roleOf(await detail(await role(ann, g.id, ben.userId, "manager")), ben.userId)).toBe(
      "manager",
    );
    // The new manager can manage too.
    expect(roleOf(await detail(await role(ben, g.id, ben.userId, "member")), ben.userId)).toBe(
      "member",
    );
    expect((await remove(ann, g.id, cat.userId)).status).toBe(204);
    expect((await mine(cat)).some((x) => x.id === g.id)).toBe(false);
    expect((await send(ann, "DELETE", `/api/groups/${g.id}`)).status).toBe(204);
    expect(await groupExists(g.id)).toBe(false);
    expect((await mine(ben)).some((x) => x.id === g.id)).toBe(false);
  });

  it("a member leaves", async () => {
    const g = await create(ann, "Choir");
    await add(ann, g.id, [ben.userId]);
    expect((await remove(ben, g.id, ben.userId)).status).toBe(204);
    expect((await mine(ben)).some((x) => x.id === g.id)).toBe(false);
    expect((await detail(await send(ann, "GET", `/api/groups/${g.id}`))).members).toHaveLength(1);
  });

  it("the last enabled manager can't leave or step down while others remain", async () => {
    const g = await create(ann, "Crew");
    await add(ann, g.id, [ben.userId]);
    const leave = await remove(ann, g.id, ann.userId);
    expect(leave.status).toBe(409);
    expect(((await leave.json()) as { message: string }).message).toMatch(
      /make someone else a manager first, or delete the group/i,
    );
    expect((await role(ann, g.id, ann.userId, "member")).status).toBe(409);
    await role(ann, g.id, ben.userId, "manager");
    expect((await remove(ann, g.id, ann.userId)).status).toBe(204);
    const left = await detail(await send(ben, "GET", `/api/groups/${g.id}`));
    expect(left.members.map((m) => [m.id, m.role])).toEqual([[ben.userId, "manager"]]);
  });

  it("the last member leaving deletes the group", async () => {
    const g = await create(ann, "Solo");
    expect((await remove(ann, g.id, ann.userId)).status).toBe(204);
    expect(await groupExists(g.id)).toBe(false);
  });

  it("a disabled member can't be made a manager, and doesn't count as one", async () => {
    const g = await create(ann, "Quiet");
    const sleepy = await someone();
    await add(ann, g.id, [sleepy.userId, ben.userId]);
    await role(ann, g.id, sleepy.userId, "manager");
    await t.db
      .updateTable("users")
      .set({ disabled_at: new Date() })
      .where("id", "=", sleepy.userId)
      .execute();
    // sleepy is a disabled manager: ann is still the last enabled one.
    expect((await remove(ann, g.id, ann.userId)).status).toBe(409);
    await role(ann, g.id, sleepy.userId, "member");
    expect((await role(ann, g.id, sleepy.userId, "manager")).status).toBe(400);
    const d = await detail(await send(ann, "GET", `/api/groups/${g.id}`));
    expect(d.members.find((m) => m.id === sleepy.userId)?.disabled).toBe(true);
    expect((await mine(ann)).find((x) => x.id === g.id)?.members).toBe(2);
  });
});

describe("a group always keeps a manager", () => {
  it("disabling its only manager promotes the earliest-added enabled member", async () => {
    const boss = await someone();
    const g = await create(boss, "Office");
    const first = await someone();
    const second = await someone();
    await add(boss, g.id, [first.userId]);
    await add(boss, g.id, [second.userId]);
    await t.db
      .updateTable("users")
      .set({ disabled_at: new Date() })
      .where("id", "=", boss.userId)
      .execute();
    const d = await detail(await send(first, "GET", `/api/groups/${g.id}`));
    expect(roleOf(d, first.userId)).toBe("manager");
    expect(roleOf(d, second.userId)).toBe("member");
  });

  it("deleting its manager's account promotes the earliest-added enabled member", async () => {
    const boss = await someone();
    const g = await create(boss, "Garage");
    const asleep = await someone();
    const awake = await someone();
    await add(boss, g.id, [asleep.userId]);
    await add(boss, g.id, [awake.userId]);
    await t.db
      .updateTable("users")
      .set({ disabled_at: new Date() })
      .where("id", "=", asleep.userId)
      .execute();
    await t.db.deleteFrom("users").where("id", "=", boss.userId).execute();
    const d = await detail(await send(awake, "GET", `/api/groups/${g.id}`));
    expect(roleOf(d, awake.userId)).toBe("manager");
    expect(roleOf(d, asleep.userId)).toBe("member");
  });

  it("deleting the account of a group's only member deletes the group", async () => {
    const loner = await someone();
    const g = await create(loner, "Alone");
    await t.db.deleteFrom("users").where("id", "=", loner.userId).execute();
    expect(await groupExists(g.id)).toBe(false);
  });
});

describe("caps", () => {
  it("a group holds at most MAX_GROUP_MEMBERS people, even when two adds race", async () => {
    const g = await create(ann, "Crowd");
    await sql`INSERT INTO users (username, password_hash, display_name, role)
      SELECT 'grcap' || n, 'unusable', 'grcap' || n, 'member'
      FROM generate_series(1, ${MAX_GROUP_MEMBERS - 2}) n`.execute(t.db);
    await sql`INSERT INTO group_members (group_id, user_id)
      SELECT ${g.id}, id FROM users WHERE username LIKE 'grcap%'`.execute(t.db);
    // ann plus MAX - 2: one more fits.
    const [a, b] = await Promise.all([add(ann, g.id, [ben.userId]), add(ann, g.id, [cat.userId])]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await add(ann, g.id, [dan.userId])).status).toBe(409);
  });

  it("a person makes at most MAX_GROUPS_CREATED groups, counting only those they're still in", async () => {
    const maker = await someone();
    await sql`INSERT INTO groups (name, created_by)
      SELECT 'Made ' || n, ${maker.userId}::uuid FROM generate_series(1, ${MAX_GROUPS_CREATED - 1}) n`.execute(
      t.db,
    );
    await sql`INSERT INTO group_members (group_id, user_id, manager)
      SELECT id, ${maker.userId}::uuid, true FROM groups WHERE created_by = ${maker.userId}::uuid`.execute(
      t.db,
    );
    // One they made and left doesn't count.
    const left = await create(maker, "Left");
    await add(maker, left.id, [ben.userId]);
    await role(maker, left.id, ben.userId, "manager");
    expect((await remove(maker, left.id, maker.userId)).status).toBe(204);
    const [a, b] = await Promise.all([
      send(maker, "POST", "/api/groups", { name: "One" }),
      send(maker, "POST", "/api/groups", { name: "Two" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });
});

describe("being added", () => {
  async function notices(userId: string) {
    const jobs = await queuedData<NotifyJob>(t.db, "notify");
    return jobs.filter((d) => d.userId === userId);
  }

  it("tells each person added, once, unless they turned group notices off", async () => {
    const quiet = await someone();
    const loud = await someone();
    const res = await send(quiet, "PUT", "/api/me/notifications", {
      downloads: true,
      shares: true,
      groups: false,
    });
    expect(res.status).toBe(200);
    const g = await create(ann, "Neighbours");
    await add(ann, g.id, [quiet.userId, loud.userId]);
    await add(ann, g.id, [loud.userId]);
    expect(await notices(quiet.userId)).toEqual([]);
    const got = await notices(loud.userId);
    expect(got).toHaveLength(1);
    expect(got[0]?.message).toEqual({
      title: "grann added you to Neighbours",
      path: `/shared/groups/${g.id}`,
      tag: `group-${g.id}`,
    });
    expect(await notices(ann.userId)).toEqual([]);
  });
});

describe("admins", () => {
  it("list every group and delete any; members can't", async () => {
    const g = await create(ann, "Audited");
    await add(ann, g.id, [ben.userId]);
    const res = await send(root, "GET", "/api/admin/groups");
    expect(res.status).toBe(200);
    const all = z.array(AdminGroup).parse(await res.json());
    expect(all.find((x) => x.id === g.id)).toMatchObject({
      name: "Audited",
      members: 2,
      managers: ["grann"],
    });
    expect((await send(ben, "GET", "/api/admin/groups")).status).toBe(403);
    expect((await send(ben, "DELETE", `/api/admin/groups/${g.id}`)).status).toBe(403);
    expect((await send(root, "DELETE", `/api/admin/groups/${g.id}`)).status).toBe(204);
    expect(await groupExists(g.id)).toBe(false);
    expect((await send(root, "DELETE", `/api/admin/groups/${g.id}`)).status).toBe(404);
  });
});
