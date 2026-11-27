import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";

/** A person's own details of a video in the schema (docs/library.md#your-own-details). */

let testDb: TestDb;

beforeAll(async () => {
  testDb = await TestDb.create();
});
afterAll(async () => {
  await testDb.close();
});

const codeOf = (err: unknown) => (err as { code?: string }).code;

async function held(username: string) {
  const userId = await insertUser(testDb.db, { username });
  const { mediaId } = await seedEntry(testDb.db, userId);
  return { userId, mediaId };
}

describe("media_edits", () => {
  it("keeps one row of a person's own details per video, with something in it", async () => {
    const { userId, mediaId } = await held("edalice");
    await testDb.db
      .insertInto("media_edits")
      .values({ user_id: userId, media_id: mediaId, title: "Mine" })
      .execute();
    await expect(
      testDb.db
        .insertInto("media_edits")
        .values({ user_id: userId, media_id: mediaId, title: "Again" })
        .execute(),
    ).rejects.toSatisfy((e) => codeOf(e) === "23505");
    const other = await held("edbob");
    await expect(
      testDb.db
        .insertInto("media_edits")
        .values({ user_id: other.userId, media_id: other.mediaId })
        .execute(),
    ).rejects.toSatisfy((e) => codeOf(e) === "23514");
  });

  it("refuses an empty title or channel, a channel without its site, and a channel id alone", async () => {
    const { userId, mediaId } = await held("edcarol");
    const bad = [
      { title: "" },
      { channel: "", channel_extractor: "youtube" },
      { channel: "Mine" },
      { title: "T", channel_extractor: "youtube" },
      { title: "T", channel_id: "UC1" },
    ];
    for (const values of bad) {
      await expect(
        testDb.db
          .insertInto("media_edits")
          .values({ user_id: userId, media_id: mediaId, ...values })
          .execute(),
      ).rejects.toSatisfy((e) => codeOf(e) === "23514");
    }
    // A cleared description is an edit of its own.
    await testDb.db
      .insertInto("media_edits")
      .values({ user_id: userId, media_id: mediaId, description: "" })
      .execute();
  });

  it("outlives the person's entries, and goes with the person or the video", async () => {
    const a = await held("eddave");
    const b = await held("ederin");
    for (const h of [a, b]) {
      await testDb.db
        .insertInto("media_edits")
        .values({ user_id: h.userId, media_id: h.mediaId, title: "Mine" })
        .execute();
    }
    const rows = (userId: string) =>
      testDb.db.selectFrom("media_edits").select("title").where("user_id", "=", userId).execute();
    await testDb.db.deleteFrom("library_entries").where("user_id", "=", a.userId).execute();
    expect(await rows(a.userId)).toHaveLength(1);
    await testDb.db.deleteFrom("users").where("id", "=", a.userId).execute();
    expect(await rows(a.userId)).toHaveLength(0);
    await testDb.db.deleteFrom("library_entries").where("user_id", "=", b.userId).execute();
    await testDb.db.deleteFrom("media").where("id", "=", b.mediaId).execute();
    expect(await rows(b.userId)).toHaveLength(0);
  });
});
