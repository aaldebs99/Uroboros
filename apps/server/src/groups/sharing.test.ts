import type { OpenAPIHono } from "@hono/zod-openapi";
import { GroupDetail, GroupShare } from "@uroboros/contract";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { asUser, signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { queuedData } from "../../test/jobs.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { createApp } from "../api/app.ts";
import type { NotifyJob } from "../downloads/queues.ts";

const logger = pino({ level: "silent" });
let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
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

let n = 0;
const someone = () => signedIn(t.db, { username: `gs${String(++n)}` });
const nameOf = async (s: SignedIn) =>
  (
    await t.db
      .selectFrom("users")
      .select("display_name")
      .where("id", "=", s.userId)
      .executeTakeFirstOrThrow()
  ).display_name;

/** A group made by `manager` holding `members` too. */
async function group(manager: SignedIn, members: SignedIn[], name = "Family"): Promise<string> {
  const res = await send(manager, "POST", "/api/groups", { name });
  expect(res.status).toBe(201);
  const g = GroupDetail.parse(await res.json());
  if (members.length > 0) {
    const added = await send(manager, "POST", `/api/groups/${g.id}/members`, {
      userIds: members.map((m) => m.userId),
    });
    expect(added.status).toBe(200);
  }
  return g.id;
}
const shareWith = async (
  owner: SignedIn,
  entryId: string,
  people: ({ kind: "user"; id: string } | { kind: "group"; id: string })[],
) => {
  const res = await send(owner, "PUT", `/api/shares/entry/${entryId}/people`, {
    people,
    expiresAt: null,
  });
  expect(res.status).toBe(200);
};
const sees = async (s: SignedIn, entryId: string) =>
  (await send(s, "GET", `/api/library/${entryId}`)).status === 200;
const shareCount = async (ownerId: string) =>
  Number(
    (
      await t.db
        .selectFrom("shares")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("owner_id", "=", ownerId)
        .executeTakeFirstOrThrow()
    ).n,
  );
async function groupShares(s: SignedIn, groupId: string) {
  const res = await send(s, "GET", `/api/groups/${groupId}/shares`);
  expect(res.status).toBe(200);
  return z.array(GroupShare).parse(await res.json());
}

describe("sharing with a group", () => {
  it("reaches its members, never the owner, and not disabled members", async () => {
    const [ann, ben, cat] = [await someone(), await someone(), await someone()];
    const g = await group(ann, [ben, cat]);
    const e = await seedEntry(t.db, ann.userId, { title: "Picnic" });
    await shareWith(ann, e.entryId, [{ kind: "group", id: g }]);
    expect(await sees(ben, e.entryId)).toBe(true);
    const withMe = await send(ann, "GET", "/api/shared");
    expect(((await withMe.json()) as unknown[]).length).toBe(0);
    await t.db
      .updateTable("users")
      .set({ disabled_at: new Date() })
      .where("id", "=", cat.userId)
      .execute();
    const state = (await (await send(ann, "GET", `/api/shares/entry/${e.entryId}`)).json()) as {
      people: { people: { kind: string; members?: number }[] };
    };
    expect(state.people.people).toEqual([
      expect.objectContaining({ kind: "group", id: g, name: "Family", members: 2 }),
    ]);
  });

  it("someone added later sees what was shared, and hears only that they were added", async () => {
    const [ann, ben] = [await someone(), await someone()];
    const g = await group(ann, []);
    const e = await seedEntry(t.db, ann.userId, { title: "Old news" });
    await shareWith(ann, e.entryId, [{ kind: "group", id: g }]);
    expect(await sees(ben, e.entryId)).toBe(false);
    await send(ann, "POST", `/api/groups/${g}/members`, { userIds: [ben.userId] });
    expect(await sees(ben, e.entryId)).toBe(true);
    const jobs = (await queuedData<NotifyJob>(t.db, "notify")).filter(
      (j) => j.userId === ben.userId,
    );
    expect(jobs.map((j) => j.message.title)).toEqual([`${await nameOf(ann)} added you to Family`]);
  });

  it("sharing with a group needs you to be in it", async () => {
    const [ann, ben] = [await someone(), await someone()];
    const g = await group(ben, []);
    const e = await seedEntry(t.db, ann.userId);
    const res = await send(ann, "PUT", `/api/shares/entry/${e.entryId}/people`, {
      people: [{ kind: "group", id: g }],
      expiresAt: null,
    });
    expect(res.status).toBe(400);
  });
});

describe("leaving and deleting", () => {
  it("leaving loses access, and ends the leaver's own shares to the group", async () => {
    const [ann, ben, cat] = [await someone(), await someone(), await someone()];
    const g = await group(ann, [ben, cat]);
    const annVideo = await seedEntry(t.db, ann.userId);
    const benVideo = await seedEntry(t.db, ben.userId);
    const benBoth = await seedEntry(t.db, ben.userId);
    await shareWith(ann, annVideo.entryId, [{ kind: "group", id: g }]);
    await shareWith(ben, benVideo.entryId, [{ kind: "group", id: g }]);
    await shareWith(ben, benBoth.entryId, [
      { kind: "group", id: g },
      { kind: "user", id: cat.userId },
    ]);
    expect((await send(ben, "DELETE", `/api/groups/${g}/members/${ben.userId}`)).status).toBe(204);
    expect(await sees(ben, annVideo.entryId)).toBe(false);
    expect(await sees(cat, benVideo.entryId)).toBe(false);
    // A share with nobody left ends; one that still names someone stays, without the group.
    expect(await shareCount(ben.userId)).toBe(1);
    expect(await sees(cat, benBoth.entryId)).toBe(true);
    const left = (await (
      await send(ben, "GET", `/api/shares/entry/${benBoth.entryId}`)
    ).json()) as { people: { people: { kind: string }[] } };
    expect(left.people.people.map((p) => p.kind)).toEqual(["user"]);
  });

  it("a manager removing someone takes their videos out of the group too", async () => {
    const [ann, ben, cat] = [await someone(), await someone(), await someone()];
    const g = await group(ann, [ben, cat]);
    const benVideo = await seedEntry(t.db, ben.userId);
    await shareWith(ben, benVideo.entryId, [{ kind: "group", id: g }]);
    expect(await sees(cat, benVideo.entryId)).toBe(true);
    expect((await send(ann, "DELETE", `/api/groups/${g}/members/${ben.userId}`)).status).toBe(204);
    expect(await sees(cat, benVideo.entryId)).toBe(false);
    expect(await shareCount(ben.userId)).toBe(0);
  });

  it("deleting a group ends shares that went only to it, and keeps the others", async () => {
    const [ann, ben, cat] = [await someone(), await someone(), await someone()];
    const g = await group(ann, [ben]);
    const only = await seedEntry(t.db, ann.userId);
    const also = await seedEntry(t.db, ann.userId);
    await shareWith(ann, only.entryId, [{ kind: "group", id: g }]);
    await shareWith(ann, also.entryId, [
      { kind: "group", id: g },
      { kind: "user", id: cat.userId },
    ]);
    expect((await send(ann, "DELETE", `/api/groups/${g}`)).status).toBe(204);
    expect(await shareCount(ann.userId)).toBe(1);
    expect(await sees(cat, also.entryId)).toBe(true);
    expect(await sees(ben, also.entryId)).toBe(false);
  });

  it("deleting the account of a group's only member, with a share to it, leaves neither", async () => {
    const loner = await someone();
    const g = await group(loner, []);
    const e = await seedEntry(t.db, loner.userId);
    await shareWith(loner, e.entryId, [{ kind: "group", id: g }]);
    await t.db.deleteFrom("users").where("id", "=", loner.userId).execute();
    expect(
      await t.db.selectFrom("groups").select("id").where("id", "=", g).executeTakeFirst(),
    ).toBeUndefined();
    expect(await shareCount(loner.userId)).toBe(0);
  });
});

describe("what's shared with a group", () => {
  it("lists every member's live shares to it, yours marked; outsiders get 404", async () => {
    const [ann, ben, out] = [await someone(), await someone(), await someone()];
    const g = await group(ann, [ben]);
    const mine = await seedEntry(t.db, ann.userId, { title: "Mine" });
    const theirs = await seedEntry(t.db, ben.userId, { title: "Theirs" });
    const elsewhere = await seedEntry(t.db, ben.userId, { title: "Elsewhere" });
    await shareWith(ann, mine.entryId, [{ kind: "group", id: g }]);
    await shareWith(ben, theirs.entryId, [{ kind: "group", id: g }]);
    await shareWith(ben, elsewhere.entryId, [{ kind: "user", id: ann.userId }]);
    const list = await groupShares(ann, g);
    expect(list.map((x) => [x.title, x.mine]).sort()).toEqual([
      ["Mine", true],
      ["Theirs", false],
    ]);
    expect(list.find((x) => x.title === "Theirs")).toMatchObject({
      kind: "entry",
      id: theirs.entryId,
      owner: await nameOf(ben),
    });
    expect((await send(out, "GET", `/api/groups/${g}/shares`)).status).toBe(404);
  });
});
