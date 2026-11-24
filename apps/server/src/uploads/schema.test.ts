import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedProfileless } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";

let t: TestDb;

beforeAll(async () => {
  t = await TestDb.create();
});
afterAll(async () => {
  await t.close();
});

const codeOf = (err: unknown) => (err as { code?: string }).code;

function upload(userId: string, over: Record<string, unknown> = {}) {
  return t.db
    .insertInto("uploads")
    .values({
      user_id: userId,
      filename: "clip.mp4",
      size_bytes: 10,
      part_bytes: 4,
      ext: "mp4",
      title: "Clip",
      creator: "Me",
      storage_key: `up/${String(Math.random())}.mp4`,
      store_upload_id: "abc",
      ...over,
    })
    .returning(["id", "media_id", "state"])
    .executeTakeFirstOrThrow();
}

describe("uploads in the schema", () => {
  it("starts receiving, with a media id of its own", async () => {
    const me = await insertUser(t.db, { username: "upschema1" });
    const row = await upload(me);
    expect(row.state).toBe("receiving");
    expect(row.media_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses an extension it does not take", async () => {
    const me = await insertUser(t.db, { username: "upschema2" });
    expect(codeOf(await upload(me, { ext: "exe" }).catch((e: unknown) => e))).toBe("23514");
  });

  it("keeps an upload whose person is gone (the sweep drops its storage), and its entry may go", async () => {
    const me = await insertUser(t.db, { username: "upschema3" });
    const entry = await seedProfileless(t.db, me);
    const row = await upload(me, { state: "done", entry_id: entry.entryId });
    await t.db.deleteFrom("library_entries").where("id", "=", entry.entryId).execute();
    const after = await t.db
      .selectFrom("uploads")
      .select(["entry_id"])
      .where("id", "=", row.id)
      .executeTakeFirstOrThrow();
    expect(after.entry_id).toBeNull();
    await t.db.deleteFrom("users").where("id", "=", me).execute();
    const orphan = await t.db
      .selectFrom("uploads")
      .select(["user_id"])
      .where("id", "=", row.id)
      .executeTakeFirstOrThrow();
    expect(orphan.user_id).toBeNull();
  });

  it("counts each part once, numbered 1 to 10000", async () => {
    const me = await insertUser(t.db, { username: "upschema4" });
    const row = await upload(me);
    const part = (n: number) =>
      t.db
        .insertInto("upload_parts")
        .values({ upload_id: row.id, n, size_bytes: 5, etag: "e" })
        .execute();
    await part(1);
    expect(codeOf(await part(1).catch((e: unknown) => e))).toBe("23505");
    expect(codeOf(await part(0).catch((e: unknown) => e))).toBe("23514");
    expect(codeOf(await part(10001).catch((e: unknown) => e))).toBe("23514");
  });

  it("names an uploader only on uploaded media, and forgets them with their account", async () => {
    const me = await insertUser(t.db, { username: "upschema5" });
    const media = (extractor: string) =>
      t.db
        .insertInto("media")
        .values({ extractor, video_id: String(Math.random()), uploaded_by: me })
        .returning("id")
        .executeTakeFirstOrThrow();
    expect(codeOf(await media("youtube").catch((e: unknown) => e))).toBe("23514");
    const mine = await media("upload");
    await t.db.deleteFrom("users").where("id", "=", me).execute();
    const row = await t.db
      .selectFrom("media")
      .select("uploaded_by")
      .where("id", "=", mine.id)
      .executeTakeFirstOrThrow();
    expect(row.uploaded_by).toBeNull();
  });

  it("has an upload job queue", async () => {
    await sql`INSERT INTO jobs (queue, name, data, max_stalls) VALUES ('upload', 'upload', '{}', 2)`.execute(
      t.db,
    );
  });
});
