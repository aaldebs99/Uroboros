import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { sleep } from "../../test/listings.ts";
import { TestDb } from "../../test/testDb.ts";
import { queueDownload } from "../downloads/dispatch.ts";
import { fetchKey } from "../downloads/fetchKey.ts";
import type { ProfileRow } from "../downloads/profiles.ts";
import { freeKey } from "../worker/fetch.ts";
import type { WorkerDeps } from "../worker/deps.ts";
import { DEFAULT_LAYOUT } from "./config.ts";
import { createStore, type MediaStore } from "./index.ts";
import { emptyTrash, markOrphans, reapOnce, sweepMedia, sweepRenditions } from "./reaper.ts";

const logger = pino({ level: "silent" });
const DAY = 86_400_000;
let t: TestDb;
let store: MediaStore;
let profile: ProfileRow;
let src: string;

beforeAll(async () => {
  t = await TestDb.create();
  const root = await mkdtemp(join(tmpdir(), "uroboros-reaper-"));
  store = createStore({ kind: "filesystem", root, layout: DEFAULT_LAYOUT });
  profile = await seededDefault(t.db);
  src = join(await mkdtemp(join(tmpdir(), "uroboros-reaper-src-")), "f");
  await writeFile(src, "bytes");
});
afterAll(async () => {
  await t.close();
});

/** A media row with one stored rendition, its file in the store. */
async function stored(opts: { orphanedHoursAgo?: number; updatedHoursAgo?: number } = {}) {
  const videoId = randomUUID();
  const ago = (h: number | undefined) =>
    h === undefined ? undefined : new Date(Date.now() - h * 3_600_000);
  const m = await t.db
    .insertInto("media")
    .values({
      extractor: "youtube",
      video_id: videoId,
      ...(opts.updatedHoursAgo === undefined ? {} : { updated_at: ago(opts.updatedHoursAgo) }),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const key = `media/${m.id}/video.mp4`;
  await store.put(key, src, "video/mp4");
  const r = await t.db
    .insertInto("renditions")
    .values({
      media_id: m.id,
      profile_id: profile.id,
      profile_revision: profile.revision,
      storage_key: key,
      size_bytes: 5,
      orphaned_at: ago(opts.orphanedHoursAgo) ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { mediaId: m.id, renditionId: r.id, key, videoId };
}

const exists = async (table: "renditions" | "media", id: string) =>
  (await t.db.selectFrom(table).select("id").where("id", "=", id).executeTakeFirst()) !== undefined;

async function entryOn(renditionId: string, mediaId: string) {
  const u = await signedIn(t.db, { username: `reap-${randomUUID().slice(0, 8)}` });
  await t.db
    .insertInto("library_entries")
    .values({ user_id: u.userId, media_id: mediaId, rendition_id: renditionId })
    .execute();
  return u;
}

describe("the reaper", () => {
  it("marks an unreferenced rendition and unmarks one that gained an entry", async () => {
    const a = await stored();
    await markOrphans(t.db);
    const marked = async () =>
      (
        await t.db
          .selectFrom("renditions")
          .select("orphaned_at")
          .where("id", "=", a.renditionId)
          .executeTakeFirstOrThrow()
      ).orphaned_at;
    expect(await marked()).not.toBeNull();
    await entryOn(a.renditionId, a.mediaId);
    await markOrphans(t.db);
    expect(await marked()).toBeNull();
  });

  it("deletes a rendition orphaned past the grace and trashes, then deletes, its file", async () => {
    const a = await stored({ orphanedHoursAgo: 25 });
    const young = await stored({ orphanedHoursAgo: 1 });
    await reapOnce(t.db, store, logger);
    expect(await exists("renditions", a.renditionId)).toBe(false);
    expect(await store.stat(a.key)).toBeNull();
    expect(await exists("renditions", young.renditionId)).toBe(true);
    expect(await store.stat(young.key)).not.toBeNull();
    expect(
      await t.db.selectFrom("storage_trash").selectAll().where("key", "=", a.key).execute(),
    ).toEqual([]);
  });

  it("reaper skips a rendition that gained an entry", async () => {
    const a = await stored({ orphanedHoursAgo: 48 });
    await entryOn(a.renditionId, a.mediaId);
    expect(await sweepRenditions(t.db, DAY)).toBe(0);
    expect(await exists("renditions", a.renditionId)).toBe(true);
  });

  it("keeps a rendition an active download is fetching", async () => {
    const a = await stored({ orphanedHoursAgo: 48 });
    const u = await signedIn(t.db, { username: `reap-active-${randomUUID().slice(0, 8)}` });
    await t.db
      .insertInto("downloads")
      .values({
        user_id: u.userId,
        profile_id: profile.id,
        profile_revision: profile.revision,
        args: JSON.stringify({}),
        extractor: "youtube",
        video_id: a.videoId,
        url: "https://www.youtube.com/watch?v=x",
        fetch_key: fetchKey("youtube", a.videoId, profile.id, profile.revision),
        state: "running",
      })
      .execute();
    expect(await sweepRenditions(t.db, DAY)).toBe(0);
    expect(await exists("renditions", a.renditionId)).toBe(true);
  });

  it("queueDownload waits for the reaper and fetches anew", async () => {
    const a = await stored({ orphanedHoursAgo: 48 });
    const u = await signedIn(t.db, { username: `reap-race-${randomUUID().slice(0, 8)}` });
    const reaper = await t.db.startTransaction().execute();
    await reaper
      .selectFrom("renditions")
      .select("id")
      .where("id", "=", a.renditionId)
      .forUpdate()
      .execute();
    const queued = t.db.transaction().execute((tx) =>
      queueDownload(tx, {
        userId: u.userId,
        requestId: null,
        extractor: "youtube",
        videoId: a.videoId,
        url: "https://www.youtube.com/watch?v=x",
        title: null,
        profile,
      }),
    );
    await sleep(200);
    await reaper.deleteFrom("renditions").where("id", "=", a.renditionId).execute();
    await reaper.commit().execute();
    expect((await queued).outcome).toBe("queued");
  });

  it("deletes media with no renditions, its sidecar keys and subtitles", async () => {
    const m = await t.db
      .insertInto("media")
      .values({
        extractor: "youtube",
        video_id: randomUUID(),
        updated_at: new Date(Date.now() - 2 * DAY),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const keys = [
      `media/${m.id}/thumb.jpg`,
      `media/${m.id}/info.json`,
      `media/${m.id}/subs/en.vtt`,
    ];
    for (const k of keys) await store.put(k, src, "application/octet-stream");
    await t.db
      .updateTable("media")
      .set({ thumbnail_key: keys[0], info_key: keys[1] })
      .where("id", "=", m.id)
      .execute();
    await t.db
      .insertInto("subtitles")
      .values({ media_id: m.id, lang: "en", storage_key: keys[2] ?? "" })
      .execute();
    expect(await sweepMedia(t.db, DAY)).toBeGreaterThanOrEqual(1);
    expect(await exists("media", m.id)).toBe(false);
    await emptyTrash(t.db, store, logger);
    for (const k of keys) expect(await store.stat(k)).toBeNull();
  });

  it("empties the trash and retries a failed delete", async () => {
    const key = `trash/${randomUUID()}`;
    await store.put(key, src, "application/octet-stream");
    await t.db.insertInto("storage_trash").values({ key }).execute();
    let failOnce = true;
    const flaky: MediaStore = {
      ...store,
      async delete(k) {
        if (failOnce) {
          failOnce = false;
          throw new Error("storage is down");
        }
        await store.delete(k);
      },
    };
    await emptyTrash(t.db, flaky, logger);
    expect(
      await t.db.selectFrom("storage_trash").select("key").where("key", "=", key).execute(),
    ).toHaveLength(1);
    await emptyTrash(t.db, flaky, logger);
    expect(
      await t.db.selectFrom("storage_trash").select("key").where("key", "=", key).execute(),
    ).toEqual([]);
    expect(await store.stat(key)).toBeNull();
  });

  it("drops a trashed key a row uses again", async () => {
    const a = await stored();
    await t.db.insertInto("storage_trash").values({ key: a.key }).execute();
    await emptyTrash(t.db, store, logger);
    expect(
      await t.db.selectFrom("storage_trash").select("key").where("key", "=", a.key).execute(),
    ).toEqual([]);
    expect(await store.stat(a.key)).not.toBeNull();
  });

  it("never gives a new file a key still waiting in the trash", async () => {
    const key = `Channel/2026-01-01 T [x]/T [${randomUUID()}].mp4`;
    await t.db.insertInto("storage_trash").values({ key }).execute();
    const deps = { db: t.db } as WorkerDeps;
    const own = { mediaId: randomUUID(), profileId: profile.id, revision: profile.revision };
    expect(await freeKey(deps, key, own)).not.toBe(key);
  });
});
