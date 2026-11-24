import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { downloadHarness } from "../../test/downloads.ts";
import { queuedData } from "../../test/jobs.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import type { PreviewJob } from "../downloads/queues.ts";
import { previewKey, queuePreview } from "./queue.ts";
import { PREVIEW_SWEEP_BATCH, sweepPreviews } from "./sweep.ts";

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

/** A media with one rendition: a video unless `video` is false. */
async function media(
  over: { video?: boolean; orphaned?: boolean; preview?: boolean; failed?: boolean } = {},
): Promise<string> {
  const me = await signedIn(t.db, { username: `ps${String(++n)}` });
  const e = await seedEntry(t.db, me.userId);
  await t.db
    .updateTable("renditions")
    .set({
      video_codec: over.video === false ? null : "h264",
      audio_codec: "aac",
      orphaned_at: over.orphaned === true ? new Date() : null,
    })
    .where("id", "=", e.renditionId)
    .execute();
  await t.db
    .updateTable("media")
    .set({
      preview_key: over.preview === true ? previewKey(e.mediaId) : null,
      preview_failed_at: over.failed === true ? new Date() : null,
    })
    .where("id", "=", e.mediaId)
    .execute();
  return e.mediaId;
}

const queued = async () =>
  new Set((await queuedData<PreviewJob>(t.db, "preview")).map((j) => j.mediaId));

describe("sweepPreviews", () => {
  it("queues the stored videos with no preview, and nothing else", async () => {
    const due = await media();
    const done = await media({ preview: true });
    const failed = await media({ failed: true });
    const audio = await media({ video: false });
    const orphaned = await media({ orphaned: true });
    const waiting = await media();
    await queuePreview(h.ctx, waiting);
    expect(await sweepPreviews(h.ctx)).toBe(1);
    const ids = await queued();
    expect(ids.has(due)).toBe(true);
    expect(ids.has(waiting)).toBe(true);
    for (const skipped of [done, failed, audio, orphaned]) expect(ids.has(skipped)).toBe(false);
    // Each is queued once: a second pass finds nothing new.
    expect(await sweepPreviews(h.ctx)).toBe(0);
  });

  it("never queues a video that has its preview (a second profile of it, say)", async () => {
    const done = await media({ preview: true });
    await queuePreview(h.ctx, done);
    expect((await queued()).has(done)).toBe(false);
  });

  it("queues at most a batch per pass", async () => {
    await t.db.deleteFrom("jobs").where("queue", "=", "preview").execute();
    const before = (await queued()).size;
    for (let i = 0; i < PREVIEW_SWEEP_BATCH + 2; i++) await media();
    const first = await sweepPreviews(h.ctx);
    expect(first).toBe(PREVIEW_SWEEP_BATCH);
    expect((await queued()).size).toBe(before + PREVIEW_SWEEP_BATCH);
    expect(await sweepPreviews(h.ctx)).toBeGreaterThanOrEqual(2);
  });
});
