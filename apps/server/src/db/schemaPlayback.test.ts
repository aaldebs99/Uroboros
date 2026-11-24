import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";

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

async function setup() {
  const owner = { id: await insertUser(t.db, { username: "owner" }) };
  const e = await seedEntry(t.db, owner.id);
  return { owner, ...e };
}

const session = (
  s: { renditionId: string; entryId: string },
  who: { user_id?: string | null; share_code?: string | null },
) =>
  t.db
    .insertInto("playback_sessions")
    .values({
      rendition_id: s.renditionId,
      entry_id: s.entryId,
      user_id: who.user_id ?? null,
      share_code: who.share_code ?? null,
      quality: "720",
      mode: "encode",
      plan: JSON.stringify({ width: 1280 }),
      boundaries: [0, 6, 9],
    })
    .returning(["id", "state", "encoder", "boundaries"])
    .executeTakeFirstOrThrow();

describe("schema: playback sessions", () => {
  it("starts a viewer's session queued, with its boundaries", async () => {
    const s = await setup();
    expect(await session(s, { user_id: s.owner.id })).toMatchObject({
      state: "queued",
      encoder: null,
      boundaries: [0, 6, 9],
    });
  });

  it("belongs to exactly one viewer: a person or a link (23514)", async () => {
    const s = await setup();
    expect(await errCode(session(s, {}))).toBe("23514");
    const link = await t.db
      .insertInto("shares")
      .values({ owner_id: s.owner.id, entry_id: s.entryId, mode: "link", code: "c0de" })
      .returning("id")
      .executeTakeFirstOrThrow();
    expect(link.id).toBeDefined();
    expect(await errCode(session(s, { user_id: s.owner.id, share_code: "c0de" }))).toBe("23514");
    await session(s, { share_code: "c0de" });
  });

  it("goes with its entry, and with its link when the link is turned off", async () => {
    const s = await setup();
    await t.db
      .insertInto("shares")
      .values({ owner_id: s.owner.id, entry_id: s.entryId, mode: "link", code: "c0de" })
      .execute();
    await session(s, { share_code: "c0de" });
    await session(s, { user_id: s.owner.id });
    await t.db.deleteFrom("shares").where("code", "=", "c0de").execute();
    expect(await t.db.selectFrom("playback_sessions").select("id").execute()).toHaveLength(1);
    await t.db.deleteFrom("library_entries").where("id", "=", s.entryId).execute();
    expect(await t.db.selectFrom("playback_sessions").select("id").execute()).toHaveLength(0);
  });

  it("puts a deleted session's folder in the trash, however it went (cascades too)", async () => {
    const s = await setup();
    const a = await session(s, { user_id: s.owner.id });
    const b = await session(s, { user_id: s.owner.id });
    await t.db.deleteFrom("playback_sessions").where("id", "=", a.id).execute();
    await t.db.deleteFrom("library_entries").where("id", "=", s.entryId).execute();
    const trash = (await t.db.selectFrom("storage_trash").select("key").execute()).map(
      (r) => r.key,
    );
    expect(trash.sort()).toEqual([`.transcodes/${a.id}/`, `.transcodes/${b.id}/`].sort());
  });

  it("allows only known states, modes and encoders (23514)", async () => {
    const s = await setup();
    const { id } = await session(s, { user_id: s.owner.id });
    const set = (v: Record<string, string>) =>
      t.db.updateTable("playback_sessions").set(v).where("id", "=", id).execute();
    expect(await errCode(set({ state: "done" }))).toBe("23514");
    expect(await errCode(set({ encoder: "qsv" }))).toBe("23514");
    expect(await errCode(set({ mode: "copy" }))).toBe("23514");
    await set({ state: "running", encoder: "vaapi" });
  });
});

describe("schema: renditions for playback", () => {
  it("keeps codec strings and a keyframe index, which goes with the rendition", async () => {
    const s = await setup();
    await t.db
      .updateTable("renditions")
      .set({ video_codecs: "vp09.00.40.08", audio_codecs: "opus" })
      .where("id", "=", s.renditionId)
      .execute();
    await t.db
      .insertInto("rendition_keyframes")
      .values({ rendition_id: s.renditionId, times: [0, 2.5, 5.005] })
      .execute();
    const k = await t.db
      .selectFrom("rendition_keyframes")
      .select("times")
      .executeTakeFirstOrThrow();
    expect(k.times).toEqual([0, 2.5, 5.005]);
    await t.db.deleteFrom("library_entries").where("id", "=", s.entryId).execute();
    await t.db.deleteFrom("renditions").where("id", "=", s.renditionId).execute();
    expect(await t.db.selectFrom("rendition_keyframes").select("rendition_id").execute()).toEqual(
      [],
    );
  });
});
