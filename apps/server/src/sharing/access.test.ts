import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";
import { linkShare, shareFor, visibleEntry, type Viewer } from "./access.ts";

let t: TestDb;
let alice: string;
let bob: string;
let carol: string;

beforeAll(async () => {
  t = await TestDb.create();
  alice = await insertUser(t.db, { username: "acalice" });
  bob = await insertUser(t.db, { username: "acbob" });
  carol = await insertUser(t.db, { username: "accarol" });
});
afterAll(async () => {
  await t.close();
});

const sees = async (viewer: Viewer, entryId: string) =>
  visibleEntry(t.db, viewer, entryId).then(
    (e) => e,
    (err: unknown) => {
      if ((err as { code?: string }).code === "not_found") return null;
      throw err;
    },
  );

type Target = { entry_id: string } | { playlist_id: string } | { source_id: string };

async function share(
  owner: string,
  target: Target,
  to: { users?: string[]; groups?: string[] } = {},
  over: { expires_at?: Date } = {},
) {
  const row = await t.db
    .insertInto("shares")
    .values({ owner_id: owner, mode: "people", ...target, ...over })
    .returning("id")
    .executeTakeFirstOrThrow();
  for (const user_id of to.users ?? []) {
    await t.db.insertInto("share_people").values({ share_id: row.id, user_id }).execute();
  }
  for (const group_id of to.groups ?? []) {
    await t.db.insertInto("share_people").values({ share_id: row.id, group_id }).execute();
  }
  return row.id;
}

async function link(owner: string, target: Target, code: string, allowDownload = false) {
  await t.db
    .insertInto("shares")
    .values({ owner_id: owner, mode: "link", code, allow_download: allowDownload, ...target })
    .execute();
}

async function playlist(owner: string, entryIds: string[]) {
  const p = await t.db
    .insertInto("playlists")
    .values({ user_id: owner, name: "Shared list" })
    .returning("id")
    .executeTakeFirstOrThrow();
  for (const [position, entry_id] of entryIds.entries()) {
    await t.db
      .insertInto("playlist_items")
      .values({ playlist_id: p.id, user_id: owner, entry_id, position })
      .execute();
  }
  return p.id;
}

const setGroups = (userId: string, groups: string[]) =>
  t.db
    .updateTable("users")
    .set({ groups: JSON.stringify(groups) })
    .where("id", "=", userId)
    .execute();

/** A group of these people, named Family. */
async function group(members: string[], name = "Family") {
  const g = await t.db
    .insertInto("groups")
    .values({ name })
    .returning("id")
    .executeTakeFirstOrThrow();
  await t.db
    .insertInto("group_members")
    .values(members.map((user_id) => ({ group_id: g.id, user_id })))
    .execute();
  return g.id;
}
const join = (groupId: string, userId: string) =>
  t.db.insertInto("group_members").values({ group_id: groupId, user_id: userId }).execute();
const leave = (groupId: string, userId: string) =>
  t.db
    .deleteFrom("group_members")
    .where("group_id", "=", groupId)
    .where("user_id", "=", userId)
    .execute();

describe("who may see an entry", () => {
  it("the owner sees their own", async () => {
    const e = await seedEntry(t.db, alice);
    expect(await sees({ userId: alice }, e.entryId)).toMatchObject({
      own: true,
      allow_download: true,
      user_id: alice,
    });
  });

  it("a stranger gets 404", async () => {
    const e = await seedEntry(t.db, alice);
    expect(await sees({ userId: bob }, e.entryId)).toBeNull();
  });

  it("a direct user share reaches", async () => {
    const e = await seedEntry(t.db, alice);
    await share(alice, { entry_id: e.entryId }, { users: [bob] });
    expect(await sees({ userId: bob }, e.entryId)).toMatchObject({
      own: false,
      owner_name: "acalice",
      allow_download: true,
    });
    expect(await sees({ userId: carol }, e.entryId)).toBeNull();
  });

  it("a group share reaches whoever is in the group when they ask", async () => {
    const e = await seedEntry(t.db, alice);
    const g = await group([alice, bob]);
    await share(alice, { entry_id: e.entryId }, { groups: [g] });
    expect(await sees({ userId: bob }, e.entryId)).not.toBeNull();
    expect(await sees({ userId: carol }, e.entryId)).toBeNull();
    await join(g, carol);
    expect(await sees({ userId: carol }, e.entryId)).not.toBeNull();
    await leave(g, bob);
    expect(await sees({ userId: bob }, e.entryId)).toBeNull();
  });

  it("a group share whose owner is no longer in the group reaches nobody", async () => {
    const e = await seedEntry(t.db, alice);
    const g = await group([bob, carol]);
    await share(alice, { entry_id: e.entryId }, { groups: [g] });
    expect(await sees({ userId: bob }, e.entryId)).toBeNull();
  });

  it("the sign-in provider's groups grant nothing", async () => {
    const e = await seedEntry(t.db, alice);
    const g = await group([alice], "staff");
    await share(alice, { entry_id: e.entryId }, { groups: [g] });
    await setGroups(bob, ["staff", g]);
    expect(await sees({ userId: bob }, e.entryId)).toBeNull();
  });

  it("an expired share no longer reaches", async () => {
    const e = await seedEntry(t.db, alice);
    await share(
      alice,
      { entry_id: e.entryId },
      { users: [bob] },
      { expires_at: new Date(Date.now() - 1000) },
    );
    expect(await sees({ userId: bob }, e.entryId)).toBeNull();
  });

  it("a disabled or revoked owner's shares stop working", async () => {
    const dave = await insertUser(t.db, { username: "acdave" });
    const e = await seedEntry(t.db, dave);
    await share(dave, { entry_id: e.entryId }, { users: [bob] });
    expect(await sees({ userId: bob }, e.entryId)).not.toBeNull();
    await t.db
      .updateTable("users")
      .set({ revoked_at: new Date() })
      .where("id", "=", dave)
      .execute();
    expect(await sees({ userId: bob }, e.entryId)).toBeNull();
    await t.db
      .updateTable("users")
      .set({ revoked_at: null, disabled_at: new Date() })
      .where("id", "=", dave)
      .execute();
    expect(await sees({ userId: bob }, e.entryId)).toBeNull();
  });

  it("an entry reached through a manual playlist share", async () => {
    const e = await seedEntry(t.db, alice);
    const other = await seedEntry(t.db, alice);
    const p = await playlist(alice, [e.entryId]);
    await share(alice, { playlist_id: p }, { users: [bob] });
    expect(await sees({ userId: bob }, e.entryId)).not.toBeNull();
    expect(await sees({ userId: bob }, other.entryId)).toBeNull();
  });

  it("an entry leaves a shared playlist", async () => {
    const e = await seedEntry(t.db, alice);
    const p = await playlist(alice, [e.entryId]);
    await share(alice, { playlist_id: p }, { users: [bob] });
    await t.db.deleteFrom("playlist_items").where("playlist_id", "=", p).execute();
    expect(await sees({ userId: bob }, e.entryId)).toBeNull();
  });

  it("an entry reached through a YouTube playlist share, and only the owner's", async () => {
    const inIt = await seedEntry(t.db, alice, { videoId: "ac-yt-1" });
    const notInIt = await seedEntry(t.db, alice, { videoId: "ac-yt-2" });
    const carolsCopy = await seedEntry(t.db, carol, { videoId: "ac-yt-1" });
    const source = await t.db
      .insertInto("sources")
      .values({ extractor: "youtube", source_id: "PLac", kind: "playlist", url: "https://x" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await t.db
      .insertInto("user_sources")
      .values({ user_id: alice, source_id: source.id })
      .execute();
    await t.db
      .insertInto("source_items")
      .values({ source_id: source.id, extractor: "youtube", video_id: "ac-yt-1", position: 0 })
      .execute();
    await share(alice, { source_id: source.id }, { users: [bob] });
    expect(await sees({ userId: bob }, inIt.entryId)).not.toBeNull();
    expect(await sees({ userId: bob }, notInIt.entryId)).toBeNull();
    expect(await sees({ userId: bob }, carolsCopy.entryId)).toBeNull();
  });

  it("a code reaches only its own target, with downloads as the link says", async () => {
    const e = await seedEntry(t.db, alice);
    const other = await seedEntry(t.db, alice);
    await link(alice, { entry_id: e.entryId }, "code-one", true);
    expect(await sees({ code: "code-one" }, e.entryId)).toMatchObject({
      own: false,
      allow_download: true,
    });
    expect(await sees({ code: "code-one" }, other.entryId)).toBeNull();
    expect(await sees({ code: "nope" }, e.entryId)).toBeNull();
    const p = await playlist(alice, [other.entryId]);
    await link(alice, { playlist_id: p }, "code-two");
    expect(await sees({ code: "code-two" }, other.entryId)).toMatchObject({
      allow_download: false,
    });
    expect(await linkShare(t.db, "code-two")).toMatchObject({
      ownerId: alice,
      target: { kind: "playlist", id: p },
      allowDownload: false,
    });
    expect(await linkShare(t.db, "nope")).toBeUndefined();
  });

  it("the owner is never a recipient of their own share", async () => {
    const e = await seedEntry(t.db, alice);
    const id = await share(alice, { entry_id: e.entryId }, { users: [alice, bob] });
    expect(await shareFor(t.db, { userId: alice }, id)).toBeUndefined();
    expect(await shareFor(t.db, { userId: bob }, id)).toMatchObject({
      id,
      ownerId: alice,
      ownerName: "acalice",
      target: { kind: "entry", id: e.entryId },
    });
  });
});
