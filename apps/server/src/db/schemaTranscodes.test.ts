import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";

let t: TestDb;
beforeEach(async () => {
  t = await TestDb.create();
});
afterEach(async () => {
  await t.close();
});

async function errCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

async function rendition(): Promise<string> {
  const p = await t.db.selectFrom("format_profiles").select("id").executeTakeFirstOrThrow();
  const m = await t.db
    .insertInto("media")
    .values({ extractor: "youtube", video_id: randomUUID() })
    .returning("id")
    .executeTakeFirstOrThrow();
  const r = await t.db
    .insertInto("renditions")
    .values({
      media_id: m.id,
      profile_id: p.id,
      profile_revision: "rev",
      storage_key: `media/${m.id}`,
      size_bytes: 1,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return r.id;
}

const copy = (renditionId: string, settings = "s1") =>
  t.db
    .insertInto("transcodes")
    .values({ source_rendition_id: renditionId, encoder: "libx264", settings })
    .returning(["id", "state", "attempt", "ready_segments", "progress"])
    .executeTakeFirstOrThrow();

describe("schema: transcodes", () => {
  it("starts a copy queued at its first attempt", async () => {
    const c = await copy(await rendition());
    expect(c).toMatchObject({ state: "queued", attempt: 1, ready_segments: 0, progress: 0 });
  });

  it("refuses a second copy of one rendition with the same settings (23505)", async () => {
    const r = await rendition();
    await copy(r);
    expect(await errCode(copy(r))).toBe("23505");
    await copy(r, "s2");
  });

  it("deletes a rendition's copies with it (cascade)", async () => {
    const r = await rendition();
    await copy(r);
    await t.db.deleteFrom("renditions").where("id", "=", r).execute();
    expect(await t.db.selectFrom("transcodes").selectAll().execute()).toEqual([]);
  });

  it("refuses an unknown encoder or state", async () => {
    const r = await rendition();
    expect(
      await errCode(
        t.db
          .insertInto("transcodes")
          .values({ source_rendition_id: r, encoder: "vaapi" as "nvenc", settings: "x" })
          .execute(),
      ),
    ).toBe("23514");
  });
});
