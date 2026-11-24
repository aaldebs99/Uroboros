import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadHarness } from "../../test/downloads.ts";
import { seedEntry } from "../../test/library.ts";
import { liveJobs } from "../../test/jobs.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";
import type { PlaybackState } from "../db/schema.ts";
import { isStored, markStored, touchAlive } from "./bus.ts";
import { reconcileSessions } from "./sessionDuties.ts";
import { addPlaybackJob } from "./sessionQueue.ts";
import { insertSession, sessionPrefix, type StoredPlan } from "./sessions.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let entry: { entryId: string; renditionId: string };
let userId: string;

const plan: StoredPlan = {
  mode: "encode",
  quality: "720",
  width: 1280,
  height: 720,
  bitrate: 4_000_000,
  level: 32,
  audio: "aac",
  codecs: ["avc1.640020", "mp4a.40.2"],
  bandwidth: 4_160_000,
  boundaries: "uniform",
  reason: "picked",
  start: 0,
};

beforeAll(async () => {
  t = await TestDb.create();
  h = await downloadHarness(t.db);
  userId = await insertUser(t.db, { username: "duty" });
  entry = await seedEntry(t.db, userId);
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const keys = () => ({ db: t.db });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function session(state: PlaybackState, o: { createdMin: number; stoppedMin?: number }) {
  const row = await insertSession(t.db, {
    renditionId: entry.renditionId,
    entryId: entry.entryId,
    viewer: { userId },
    plan,
    boundaries: [0, 6, 9],
  });
  // created_at is insert-only in the table's types; a test may still age a row.
  await sql`UPDATE playback_sessions SET state = ${state}, created_at = ${minutesAgo(o.createdMin)},
    stopped_at = ${o.stoppedMin === undefined ? null : minutesAgo(o.stoppedMin)} WHERE id = ${row.id}`.execute(
    t.db,
  );
  return row.id;
}

const state = async (id: string) =>
  (
    await t.db
      .selectFrom("playback_sessions")
      .select("state")
      .where("id", "=", id)
      .executeTakeFirst()
  )?.state;
const trash = async () =>
  (await t.db.selectFrom("storage_trash").select("key").execute()).map((r) => r.key);
const jobIds = async () => (await liveJobs(t.db, "playback")).map((j) => j.key);

describe("reconcileSessions", () => {
  it("re-adds the lost run of a session whose viewer is still there", async () => {
    const id = await session("running", { createdMin: 5 });
    await touchAlive(keys(), id);
    expect((await reconcileSessions(h.ctx)).readded).toBeGreaterThanOrEqual(1);
    expect(await jobIds()).toContain(`playback|${id}`);
    expect(await state(id)).toBe("running");
  });

  it("stops a live session whose viewer is gone and whose run is lost, trashing its folder", async () => {
    const id = await session("running", { createdMin: 5 });
    await markStored(keys(), id, 0);
    await reconcileSessions(h.ctx);
    expect(await state(id)).toBe("stopped");
    expect(await trash()).toContain(sessionPrefix(id));
    expect(await isStored(keys(), id, 0)).toBe(false);
  });

  it("leaves a session just made, and one whose run is queued", async () => {
    const fresh = await session("queued", { createdMin: 0 });
    const waiting = await session("queued", { createdMin: 5 });
    await addPlaybackJob(h.queues.playback, waiting);
    await reconcileSessions(h.ctx);
    expect(await state(fresh)).toBe("queued");
    expect(await state(waiting)).toBe("queued");
  });

  it("forgets ended sessions after an hour, trashing their folders in case a runner died first", async () => {
    const old = await session("stopped", { createdMin: 90, stoppedMin: 70 });
    const failed = await session("failed", { createdMin: 90, stoppedMin: 61 });
    const recent = await session("stopped", { createdMin: 20, stoppedMin: 10 });
    const r = await reconcileSessions(h.ctx);
    expect(r.swept).toBe(2);
    expect([await state(old), await state(failed), await state(recent)]).toEqual([
      undefined,
      undefined,
      "stopped",
    ]);
    expect(await trash()).toEqual(
      expect.arrayContaining([sessionPrefix(old), sessionPrefix(failed)]),
    );
  });
});
