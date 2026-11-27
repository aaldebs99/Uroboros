import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";

/** Clip shares in the schema (docs/sharing.md#clips): the owner's own copy, of their own video. */

let testDb: TestDb;
let alice: string;
let bob: string;

beforeAll(async () => {
  testDb = await TestDb.create();
  alice = await insertUser(testDb.db, { username: "csalice" });
  bob = await insertUser(testDb.db, { username: "csbob" });
});
afterAll(async () => {
  await testDb.close();
});

const codeOf = (err: unknown) => (err as { code?: string }).code;

/** A clip copy of `userId`'s of an entry (`entryId`, else a fresh one of theirs). */
async function clipOf(userId: string, entryId?: string) {
  const e = entryId === undefined ? await seedEntry(testDb.db, userId) : null;
  const entry = entryId ?? e?.entryId ?? "";
  const rendition = await testDb.db
    .selectFrom("library_entries")
    .select("rendition_id")
    .where("id", "=", entry)
    .executeTakeFirstOrThrow();
  const row = await testDb.db
    .insertInto("exports")
    .values({
      user_id: userId,
      entry_id: entry,
      rendition_id: rendition.rendition_id,
      cuts: JSON.stringify([{ start: 0, end: 10 }]),
      clip_start: 10,
      clip_end: 20,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { exportId: row.id, entryId: entry };
}

const share = (owner: string, c: { exportId: string; entryId: string }, mode: "people" | "link") =>
  testDb.db
    .insertInto("clip_shares")
    .values({
      owner_id: owner,
      export_id: c.exportId,
      entry_id: c.entryId,
      mode,
      code: mode === "link" ? `c${String(Math.random()).slice(2)}` : null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

describe("clip shares in the schema", () => {
  it("are of their owner's own copy of their own video", async () => {
    const mine = await clipOf(alice);
    const err = await share(bob, mine, "link").catch((e: unknown) => e);
    expect(codeOf(err)).toBe("23503");
    // Bob's copy of a video shared with him: still not his video to share.
    const theirs = await clipOf(bob, mine.entryId).catch((e: unknown) => e);
    expect(codeOf(theirs)).toBeUndefined();
    const bobs = theirs as { exportId: string; entryId: string };
    expect(codeOf(await share(bob, bobs, "people").catch((e: unknown) => e))).toBe("23503");
  });

  it("are one with people and one link per clip, and a link has a code", async () => {
    const c = await clipOf(alice);
    await share(alice, c, "people");
    expect(codeOf(await share(alice, c, "people").catch((e: unknown) => e))).toBe("23505");
    const codeless = await testDb.db
      .insertInto("clip_shares")
      .values({ owner_id: alice, export_id: c.exportId, entry_id: c.entryId, mode: "link" })
      .execute()
      .catch((e: unknown) => e);
    expect(codeOf(codeless)).toBe("23514");
  });

  it("end once nobody is left on them, and with their copy or their video", async () => {
    const c = await clipOf(alice);
    const people = await share(alice, c, "people");
    await testDb.db
      .insertInto("clip_share_people")
      .values({ share_id: people.id, user_id: bob })
      .execute();
    await testDb.db.deleteFrom("clip_share_people").where("share_id", "=", people.id).execute();
    const left = await testDb.db
      .selectFrom("clip_shares")
      .select("id")
      .where("id", "=", people.id)
      .execute();
    expect(left).toEqual([]);
    const link = await share(alice, c, "link");
    await testDb.db.deleteFrom("exports").where("id", "=", c.exportId).execute();
    const after = await testDb.db
      .selectFrom("clip_shares")
      .select("id")
      .where("id", "=", link.id)
      .execute();
    expect(after).toEqual([]);
    const d = await clipOf(alice);
    const other = await share(alice, d, "link");
    await testDb.db.deleteFrom("library_entries").where("id", "=", d.entryId).execute();
    const gone = await testDb.db
      .selectFrom("clip_shares")
      .select("id")
      .where("id", "=", other.id)
      .execute();
    expect(gone).toEqual([]);
  });
});
