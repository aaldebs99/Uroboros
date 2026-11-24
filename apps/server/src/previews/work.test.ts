import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { previewKey, previewJobKey, queuePreview } from "./queue.ts";
import { previewWork } from "./work.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let n = 0;

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const person = async () => (await signedIn(t.db, { username: `pw${String(++n)}` })).userId;

/** A stored video in `userId`'s library, titled `title`. */
async function video(userId: string, title: string, over: { audio?: boolean } = {}) {
  const e = await seedEntry(t.db, userId, { title });
  await t.db
    .updateTable("renditions")
    .set({ video_codec: over.audio === true ? null : "h264" })
    .where("id", "=", e.renditionId)
    .execute();
  return e;
}

const made = (mediaId: string) =>
  t.db
    .updateTable("media")
    .set({ preview_key: previewKey(mediaId) })
    .where("id", "=", mediaId)
    .execute();

describe("previewWork", () => {
  it("counts every video still without a preview while previews are on, none queued when off", async () => {
    const me = await person();
    await video(me, "Plain");
    expect(await previewWork(t.db, me, true)).toEqual({ waiting: 1, next: null });
    expect(await previewWork(t.db, me, false)).toEqual({ waiting: 0, next: null });
  });

  it("counts the person's videos waiting, naming the one being made", async () => {
    const me = await person();
    const a = await video(me, "Alpha");
    const b = await video(me, "Bravo");
    const done = await video(me, "Charlie");
    await video(me, "Song", { audio: true });
    await made(done.mediaId);
    await queuePreview(h.ctx, a.mediaId);
    await queuePreview(h.ctx, b.mediaId);
    expect(await previewWork(t.db, me, false)).toEqual({
      waiting: 2,
      next: { entryId: a.entryId, title: "Alpha", running: false },
    });
    await t.db
      .updateTable("jobs")
      .set({
        state: "running",
        locked_by: crypto.randomUUID(),
        locked_until: new Date(Date.now() + 60_000),
      })
      .where("key", "=", previewJobKey(b.mediaId))
      .execute();
    expect((await previewWork(t.db, me, true)).next).toEqual({
      entryId: b.entryId,
      title: "Bravo",
      running: true,
    });
    // Made, while its job's row is still finishing: it no longer counts as waiting.
    await made(b.mediaId);
    expect(await previewWork(t.db, me, false)).toMatchObject({ waiting: 1 });
    expect(await previewWork(t.db, me, true)).toMatchObject({ waiting: 1 });
  });

  it("counts only the person's own library", async () => {
    const [me, them] = [await person(), await person()];
    const theirs = await video(them, "Theirs");
    await queuePreview(h.ctx, theirs.mediaId);
    expect(await previewWork(t.db, me, true)).toEqual({ waiting: 0, next: null });
    expect((await previewWork(t.db, them, true)).waiting).toBe(1);
  });
});
