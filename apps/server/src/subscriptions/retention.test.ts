import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { insertSubscription, listing } from "../../test/listings.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { checkProcessor } from "./check.ts";
import { applyRetention } from "./retention.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let profileId: string;

beforeAll(async () => {
  t = await TestDb.create();
  h = await workerHarness(t.db, 100);
  profileId = (await seededDefault(t.db)).id;
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const videos = "https://www.youtube.com/@BlenderOfficial/videos";
const day = 86_400_000;
let n = 0;

async function rule(
  userId: string,
  retention: { keep_last?: number; delete_watched_after_days?: number },
): Promise<string> {
  const id = await insertSubscription(t.db, {
    userId,
    profileId,
    feeds: [{ name: "Videos", url: videos, primedAt: new Date().toISOString() }],
    sourceId: `R${String(++n)}`,
  });
  if (Object.keys(retention).length > 0) {
    await t.db.updateTable("subscriptions").set(retention).where("id", "=", id).execute();
  }
  return id;
}

/** An entry of `userId`'s, optionally from a subscription, uploaded on `uploadDate`. */
async function entry(
  userId: string,
  opts: {
    subscriptionId?: string | null;
    uploadDate?: string;
    kept?: boolean;
    watchedDaysAgo?: number;
    videoId?: string;
  } = {},
): Promise<string> {
  const videoId = opts.videoId ?? randomUUID();
  const m = await t.db
    .insertInto("media")
    .values({ extractor: "youtube", video_id: videoId, upload_date: opts.uploadDate ?? null })
    .returning("id")
    .executeTakeFirstOrThrow();
  const r = await t.db
    .insertInto("renditions")
    .values({
      media_id: m.id,
      profile_id: profileId,
      profile_revision: "rev",
      storage_key: `media/${m.id}`,
      size_bytes: 1,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const e = await t.db
    .insertInto("library_entries")
    .values({
      user_id: userId,
      media_id: m.id,
      rendition_id: r.id,
      subscription_id: opts.subscriptionId ?? null,
      kept: opts.kept ?? false,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  if (opts.watchedDaysAgo !== undefined) {
    await t.db
      .insertInto("watch_progress")
      .values({
        user_id: userId,
        media_id: m.id,
        position_s: 100,
        duration_s: 100,
        watched: true,
        watched_at: new Date(Date.now() - opts.watchedDaysAgo * day),
      })
      .execute();
  }
  return e.id;
}

async function remaining(ids: string[]): Promise<string[]> {
  const rows = await t.db
    .selectFrom("library_entries")
    .select("id")
    .where("id", "in", ids)
    .execute();
  return ids.filter((id) => rows.some((r) => r.id === id));
}

describe("retention", () => {
  it("a video in one of its owner's playlists is spared like Keep", async () => {
    const u = await signedIn(t.db, { username: "r-listed" });
    const sub = await rule(u.userId, { keep_last: 1, delete_watched_after_days: 1 });
    const listed = await entry(u.userId, {
      subscriptionId: sub,
      uploadDate: "20250101",
      watchedDaysAgo: 30,
    });
    const newest = await entry(u.userId, { subscriptionId: sub, uploadDate: "20260301" });
    const older = await entry(u.userId, { subscriptionId: sub, uploadDate: "20260201" });
    const list = await t.db
      .insertInto("playlists")
      .values({ user_id: u.userId, name: "Favourites" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await t.db
      .insertInto("playlist_items")
      .values({ playlist_id: list.id, user_id: u.userId, entry_id: listed, position: 0 })
      .execute();
    await applyRetention(t.db);
    expect(await remaining([listed, newest, older])).toEqual([listed, newest]);
  });

  it("a video shared on its own is spared", async () => {
    const u = await signedIn(t.db, { username: "r-shared" });
    const sub = await rule(u.userId, { delete_watched_after_days: 1 });
    const shared = await entry(u.userId, { subscriptionId: sub, watchedDaysAgo: 30 });
    const plain = await entry(u.userId, { subscriptionId: sub, watchedDaysAgo: 30 });
    await t.db
      .insertInto("shares")
      .values({ owner_id: u.userId, entry_id: shared, mode: "link", code: `c-${shared}` })
      .execute();
    await applyRetention(t.db);
    expect(await remaining([shared, plain])).toEqual([shared]);
  });

  it("keeps the newest N by upload date", async () => {
    const u = await signedIn(t.db, { username: "r-keep" });
    const sub = await rule(u.userId, { keep_last: 2 });
    const jan = await entry(u.userId, { subscriptionId: sub, uploadDate: "20260101" });
    const mar = await entry(u.userId, { subscriptionId: sub, uploadDate: "20260301" });
    const feb = await entry(u.userId, { subscriptionId: sub, uploadDate: "20260201" });
    expect(await applyRetention(t.db)).toBeGreaterThanOrEqual(1);
    expect(await remaining([jan, feb, mar])).toEqual([feb, mar]);
  });

  it("removes videos watched more than D days ago", async () => {
    const u = await signedIn(t.db, { username: "r-watched" });
    const sub = await rule(u.userId, { delete_watched_after_days: 7 });
    const old = await entry(u.userId, { subscriptionId: sub, watchedDaysAgo: 10 });
    const recent = await entry(u.userId, { subscriptionId: sub, watchedDaysAgo: 2 });
    const unwatched = await entry(u.userId, { subscriptionId: sub });
    await applyRetention(t.db);
    expect(await remaining([old, recent, unwatched])).toEqual([recent, unwatched]);
  });

  it("never removes kept entries, and they do not count toward N", async () => {
    const u = await signedIn(t.db, { username: "r-kept" });
    const sub = await rule(u.userId, { keep_last: 1, delete_watched_after_days: 1 });
    const keptOld = await entry(u.userId, {
      subscriptionId: sub,
      uploadDate: "20250101",
      kept: true,
      watchedDaysAgo: 30,
    });
    const newest = await entry(u.userId, { subscriptionId: sub, uploadDate: "20260301" });
    const older = await entry(u.userId, { subscriptionId: sub, uploadDate: "20260201" });
    await applyRetention(t.db);
    expect(await remaining([keptOld, newest, older])).toEqual([keptOld, newest]);
  });

  it("leaves entries of other subscriptions and manual downloads alone", async () => {
    const u = await signedIn(t.db, { username: "r-others" });
    const strict = await rule(u.userId, { keep_last: 1 });
    const loose = await rule(u.userId, {});
    const a = await entry(u.userId, { subscriptionId: strict, uploadDate: "20260301" });
    const b = await entry(u.userId, { subscriptionId: loose, uploadDate: "20260101" });
    const manual = await entry(u.userId, { uploadDate: "20250101", watchedDaysAgo: 400 });
    await applyRetention(t.db);
    expect(await remaining([a, b, manual])).toEqual([a, b, manual]);
  });

  it("does not bring removed videos back on the next check", async () => {
    const u = await signedIn(t.db, { username: "r-again" });
    const sub = await rule(u.userId, { keep_last: 1 });
    for (const [v, date] of [
      ["again-old", "20260101"],
      ["again-new", "20260301"],
    ] as const) {
      await entry(u.userId, { subscriptionId: sub, uploadDate: date, videoId: v });
      await t.db
        .insertInto("subscription_items")
        .values({
          subscription_id: sub,
          extractor: "youtube",
          video_id: v,
          url: "u",
          outcome: "queued",
        })
        .execute();
    }
    await applyRetention(t.db);
    const deps = await h.deps({
      steps: [{ stdout: listing(videos, [{ id: "again-new" }, { id: "again-old" }]) }],
    });
    await checkProcessor(deps)({ data: { subscriptionId: sub } });
    const queued = await t.db
      .selectFrom("downloads")
      .select("video_id")
      .where("subscription_id", "=", sub)
      .execute();
    expect(queued).toEqual([]);
  });
});
