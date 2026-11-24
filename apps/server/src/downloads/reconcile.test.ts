import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { downloadHarness, seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { dispatchFor, queueDownload } from "./dispatch.ts";
import { reconcileOnce } from "./reconcile.ts";

let testDb: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let n = 0;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await downloadHarness(testDb.db);
});
afterAll(async () => {
  await h.close();
  await testDb.close();
});

/** A dispatched download whose fetch job then vanished (a stall limit, a cancel race). */
async function orphan(videoId: string, dispatchedAgoMs: number): Promise<string> {
  const u = await signedIn(testDb.db, { username: `rc${String(++n)}` });
  const profile = await seededDefault(testDb.db);
  await testDb.db.transaction().execute((tx) =>
    queueDownload(tx, {
      userId: u.userId,
      requestId: null,
      extractor: "youtube",
      videoId,
      url: "https://x.example/v",
      title: videoId,
      profile,
    }),
  );
  await dispatchFor(h.ctx, u.userId);
  const row = await testDb.db
    .selectFrom("downloads")
    .select("fetch_key")
    .where("video_id", "=", videoId)
    .executeTakeFirstOrThrow();
  await testDb.db.deleteFrom("jobs").where("key", "=", row.fetch_key).execute();
  await testDb.db
    .updateTable("downloads")
    .set({ dispatched_at: new Date(Date.now() - dispatchedAgoMs), state: "running" })
    .where("video_id", "=", videoId)
    .execute();
  return row.fetch_key;
}

describe("reconcileOnce", () => {
  it("adds the job back for an active, dispatched download whose job is gone", async () => {
    const key = await orphan("rc-old", 5 * 60_000);
    expect(await reconcileOnce(h.ctx)).toBeGreaterThanOrEqual(1);
    expect(await h.queues.download.get(key)).toBeDefined();
  });

  it("leaves a download dispatched a moment ago alone", async () => {
    const key = await orphan("rc-new", 1000);
    await reconcileOnce(h.ctx);
    expect(await h.queues.download.get(key)).toBeUndefined();
  });

  it("does nothing for a key whose job exists", async () => {
    const key = await orphan("rc-live", 5 * 60_000);
    await reconcileOnce(h.ctx);
    expect(await reconcileOnce(h.ctx)).toBe(0);
    expect((await h.jobIds()).filter((k) => k === key)).toHaveLength(1);
  });
});
