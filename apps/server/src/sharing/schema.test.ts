import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";

let testDb: TestDb;
let alice: string;
let bob: string;

beforeAll(async () => {
  testDb = await TestDb.create();
  alice = await insertUser(testDb.db, { username: "schalice" });
  bob = await insertUser(testDb.db, { username: "schbob" });
});

afterAll(async () => {
  await testDb.close();
});

const codeOf = (err: unknown) => (err as { code?: string }).code;

async function playlistOf(userId: string): Promise<string> {
  const row = await testDb.db
    .insertInto("playlists")
    .values({ user_id: userId, name: "Mine" })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

describe("playlists and shares in the schema", () => {
  it("a playlist item must be its owner's entry", async () => {
    const list = await playlistOf(alice);
    const theirs = await seedEntry(testDb.db, bob);
    const err = await testDb.db
      .insertInto("playlist_items")
      .values({ playlist_id: list, user_id: alice, entry_id: theirs.entryId, position: 0 })
      .execute()
      .catch((e: unknown) => e);
    expect(codeOf(err)).toBe("23503");
  });

  it("a share names exactly one thing", async () => {
    const mine = await seedEntry(testDb.db, alice);
    const list = await playlistOf(alice);
    const none = await testDb.db
      .insertInto("shares")
      .values({ owner_id: alice, mode: "people" })
      .execute()
      .catch((e: unknown) => e);
    expect(codeOf(none)).toBe("23514");
    const two = await testDb.db
      .insertInto("shares")
      .values({ owner_id: alice, mode: "people", entry_id: mine.entryId, playlist_id: list })
      .execute()
      .catch((e: unknown) => e);
    expect(codeOf(two)).toBe("23514");
  });

  it("a link has a code and a people-share has none", async () => {
    const mine = await seedEntry(testDb.db, alice);
    const linkWithout = await testDb.db
      .insertInto("shares")
      .values({ owner_id: alice, mode: "link", entry_id: mine.entryId })
      .execute()
      .catch((e: unknown) => e);
    expect(codeOf(linkWithout)).toBe("23514");
    const peopleWith = await testDb.db
      .insertInto("shares")
      .values({ owner_id: alice, mode: "people", entry_id: mine.entryId, code: "abc" })
      .execute()
      .catch((e: unknown) => e);
    expect(codeOf(peopleWith)).toBe("23514");
  });

  it("only a link allows downloads", async () => {
    const mine = await seedEntry(testDb.db, alice);
    const err = await testDb.db
      .insertInto("shares")
      .values({ owner_id: alice, mode: "people", entry_id: mine.entryId, allow_download: true })
      .execute()
      .catch((e: unknown) => e);
    expect(codeOf(err)).toBe("23514");
  });

  it("one people-share per entry", async () => {
    const mine = await seedEntry(testDb.db, alice);
    await testDb.db
      .insertInto("shares")
      .values({ owner_id: alice, mode: "people", entry_id: mine.entryId })
      .execute();
    const err = await testDb.db
      .insertInto("shares")
      .values({ owner_id: alice, mode: "people", entry_id: mine.entryId })
      .execute()
      .catch((e: unknown) => e);
    expect(codeOf(err)).toBe("23505");
  });

  it("a share of an entry must be its owner's", async () => {
    const theirs = await seedEntry(testDb.db, bob);
    const err = await testDb.db
      .insertInto("shares")
      .values({ owner_id: alice, mode: "people", entry_id: theirs.entryId })
      .execute()
      .catch((e: unknown) => e);
    expect(codeOf(err)).toBe("23503");
  });

  it("removing the entry ends its shares and playlist items", async () => {
    const mine = await seedEntry(testDb.db, alice);
    const list = await playlistOf(alice);
    await testDb.db
      .insertInto("playlist_items")
      .values({ playlist_id: list, user_id: alice, entry_id: mine.entryId, position: 0 })
      .execute();
    const share = await testDb.db
      .insertInto("shares")
      .values({ owner_id: alice, mode: "people", entry_id: mine.entryId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await testDb.db
      .insertInto("share_people")
      .values({ share_id: share.id, user_id: bob })
      .execute();
    await testDb.db.deleteFrom("library_entries").where("id", "=", mine.entryId).execute();
    const items = await testDb.db
      .selectFrom("playlist_items")
      .select("entry_id")
      .where("playlist_id", "=", list)
      .execute();
    const shares = await testDb.db
      .selectFrom("shares")
      .select("id")
      .where("id", "=", share.id)
      .execute();
    expect(items).toEqual([]);
    expect(shares).toEqual([]);
  });
});
