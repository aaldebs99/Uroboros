import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { testBus } from "../../test/bus.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { previewJobKey, queuePreview } from "./queue.ts";
import { PREVIEW_STALL_AFTER_MS, previewsStalled } from "./stall.ts";
import { sweepPreviews } from "./sweep.ts";
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
beforeEach(async () => {
  await t.db.deleteFrom("jobs").where("queue", "=", "preview").execute();
});

/** A stored video in a fresh person's library. */
async function video() {
  const me = await signedIn(t.db, { username: `ps${String(++n)}` });
  const e = await seedEntry(t.db, me.userId);
  await t.db
    .updateTable("renditions")
    .set({ video_codec: "h264" })
    .where("id", "=", e.renditionId)
    .execute();
  return { userId: me.userId, mediaId: e.mediaId };
}

const overdue = (mediaId: string) =>
  t.db
    .updateTable("jobs")
    .set({ run_at: new Date(Date.now() - PREVIEW_STALL_AFTER_MS - 60_000) })
    .where("key", "=", previewJobKey(mediaId))
    .execute();

const running = (mediaId: string) =>
  t.db
    .updateTable("jobs")
    .set({
      state: "running",
      locked_by: crypto.randomUUID(),
      locked_until: new Date(Date.now() + 60_000),
    })
    .where("key", "=", previewJobKey(mediaId))
    .execute();

describe("stalled hover previews", () => {
  it("are previews overdue with none being made, never fresh ones or a queue being worked", async () => {
    expect(await previewsStalled(t.db)).toBe(false);
    const [a, b] = [await video(), await video()];
    await queuePreview(h.ctx, a.mediaId);
    expect(await previewsStalled(t.db)).toBe(false);
    await overdue(a.mediaId);
    expect(await previewsStalled(t.db)).toBe(true);
    await queuePreview(h.ctx, b.mediaId);
    await running(b.mediaId);
    expect(await previewsStalled(t.db)).toBe(false);
  });

  it("show nothing in progress in the bell, still counting what is left", async () => {
    const a = await video();
    await queuePreview(h.ctx, a.mediaId);
    expect((await previewWork(t.db, a.userId)).queued).toBe(1);
    await overdue(a.mediaId);
    expect(await previewWork(t.db, a.userId)).toEqual({
      queued: 0,
      left: 1,
      made: 0,
      next: null,
    });
  });

  it("stop the backfill, which says why once", async () => {
    const a = await video();
    await video();
    await queuePreview(h.ctx, a.mediaId);
    await overdue(a.mediaId);
    const warned: string[] = [];
    const logger = pino({ level: "silent" });
    logger.warn = (msg: string) => {
      warned.push(msg);
    };
    const ctx = { ...h.ctx, logger };
    expect(await sweepPreviews(ctx)).toBe(0);
    expect(await sweepPreviews(ctx)).toBe(0);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain("UROBOROS_TRANSCODE_CONCURRENCY");
    await t.db.deleteFrom("jobs").where("queue", "=", "preview").execute();
    expect(await sweepPreviews(ctx)).toBeGreaterThan(0);
  });
});

describe("the backfill's nudges", () => {
  it("reach each person once, however many of their videos it queues", async () => {
    const me = await signedIn(t.db, { username: `pn${String(++n)}` });
    for (let i = 0; i < 3; i++) {
      const e = await seedEntry(t.db, me.userId);
      await t.db
        .updateTable("renditions")
        .set({ video_codec: "h264" })
        .where("id", "=", e.renditionId)
        .execute();
    }
    const bus = testBus(t);
    await bus.ready;
    const heard: string[][] = [];
    bus.on("uroboros_downloads", (payload) => {
      const e = JSON.parse(payload) as { kind: string; userIds?: string[] };
      if (e.kind === "previews" && e.userIds?.includes(me.userId) === true) heard.push(e.userIds);
    });
    expect(await sweepPreviews(h.ctx)).toBeGreaterThanOrEqual(3);
    await expect.poll(() => heard.length).toBe(1);
    await new Promise((r) => setTimeout(r, 300));
    expect(heard).toEqual([[me.userId]]);
    await bus.close();
  });
});
