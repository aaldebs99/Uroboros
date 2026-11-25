import { readdir } from "node:fs/promises";
import type { Step } from "@uroboros/ytdlp/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadScenario, fetchJob, queuedFetch } from "../../test/fetchJobs.ts";
import { queuedData } from "../../test/jobs.ts";
import { listedNotices } from "../../test/notices.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { confirmDownload, dispatchFor } from "../downloads/dispatch.ts";
import type { NotifyJob } from "../downloads/queues.ts";
import type { WorkerDeps } from "./deps.ts";
import { createCancelRegistry, fetchProcessor } from "./fetch.ts";
import { bytesText } from "./sizeHold.ts";

/** Large downloads wait for their owner's OK (docs/downloads.md "Large downloads"). */

const LIMIT = 1000;
let t: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;

beforeAll(async () => {
  t = await TestDb.create();
  // One active download per person, so a hold's freed slot is seen going to the next.
  h = await workerHarness(t.db, 1);
});
afterAll(async () => {
  await h.close();
  await t.close();
});

/** yt-dlp saying what it picked is `bytes` (null: it can't say), then taking `ms` to download. */
const picked = (bytes: number | null, ms = 0): Step[] => [
  { stdout: `[uroboros]\tsize\t"clip"\t${bytes === null ? "NA" : String(bytes)}\n` },
  ...(ms > 0 ? [{ sleepMs: ms }] : []),
];

async function depsFor(steps: Step[], limit = LIMIT): Promise<WorkerDeps> {
  const deps = await h.deps(await downloadScenario(steps));
  return { ...deps, limits: { ...deps.limits, largeDownloadBytes: limit } };
}

const rowsOf = (videoId: string) =>
  t.db
    .selectFrom("downloads")
    .select(["id", "user_id", "state", "dispatched_at", "size_held_bytes", "size_held_at"])
    .where("video_id", "=", videoId)
    .orderBy("created_at")
    .execute();

const member = (u: SignedIn) => ({
  userId: u.userId,
  role: "member" as const,
  via: "session" as const,
});

describe("a fetch larger than the limit", () => {
  let ann: SignedIn;
  let ben: SignedIn;

  beforeAll(async () => {
    ann = await signedIn(t.db, { username: "lgann" });
    ben = await signedIn(t.db, { username: "lgben" });
  });

  it("stops before downloading and holds everyone waiting on it, telling each", async () => {
    const data = await queuedFetch(t.db, "big-1", [ann, ben]);
    // The fetch would take a minute: the stop comes at the size line, long before.
    const run = fetchProcessor(await depsFor(picked(5000, 60_000)), createCancelRegistry());
    await run(fetchJob(data));

    const rows = await rowsOf("big-1");
    expect(rows.map((r) => [r.state, r.dispatched_at, r.size_held_bytes])).toEqual([
      ["queued", null, "5000"],
      ["queued", null, "5000"],
    ]);
    expect(rows.every((r) => r.size_held_at !== null)).toBe(true);
    const stored = await t.db
      .selectFrom("renditions as r")
      .innerJoin("media as m", "m.id", "r.media_id")
      .select("r.id")
      .where("m.video_id", "=", "big-1")
      .execute();
    expect(stored).toEqual([]);
    expect(await readdir(h.workDir)).toEqual([]);

    for (const [u, row] of [
      [ann, rows[0]],
      [ben, rows[1]],
    ] as const) {
      expect(await listedNotices(t.db, u.userId)).toContainEqual(
        expect.objectContaining({
          kind: "downloads",
          title: "Large download needs your OK",
          body: `big-1 is about ${bytesText(5000)}, over the ${bytesText(LIMIT)} limit.`,
          path: "/downloads",
          tag: `large:${row?.id ?? ""}`,
        }),
      );
    }
    const pushed = await queuedData<NotifyJob>(t.db, "notify");
    expect(pushed.map((j) => j.userId)).toEqual(expect.arrayContaining([ann.userId, ben.userId]));
  });

  it("goes ahead once one of them says yes, and settles the other's held download too", async () => {
    const [annRow] = await rowsOf("big-1");
    await confirmDownload(h.ctx, member(ann), annRow?.id ?? "");
    const data = await queuedFetch(t.db, "big-1", []);
    await fetchProcessor(await depsFor(picked(5000)), createCancelRegistry())(fetchJob(data));
    expect((await rowsOf("big-1")).map((r) => r.state)).toEqual(["done", "done"]);
  });

  it("goes ahead when yt-dlp can't say the size, or under the limit", async () => {
    for (const [videoId, bytes] of [
      ["unknown-size", null],
      ["small", LIMIT],
    ] as const) {
      const data = await queuedFetch(t.db, videoId, [ann]);
      await fetchProcessor(await depsFor(picked(bytes)), createCancelRegistry())(fetchJob(data));
      expect((await rowsOf(videoId)).map((r) => r.state)).toEqual(["done"]);
    }
  });

  it("never holds with the limit at 0", async () => {
    const data = await queuedFetch(t.db, "no-limit", [ann]);
    await fetchProcessor(await depsFor(picked(5000), 0), createCancelRegistry())(fetchJob(data));
    expect((await rowsOf("no-limit")).map((r) => r.state)).toEqual(["done"]);
  });

  it("gives the held download's slot to its owner's next one, and never dispatches it again", async () => {
    const cal = await signedIn(t.db, { username: "lgcal" });
    const data = await queuedFetch(t.db, "big-2", [cal]);
    await queuedFetch(t.db, "next-2", [cal]);
    await dispatchFor(h.ctx, cal.userId);
    expect((await rowsOf("big-2"))[0]?.dispatched_at).not.toBeNull();
    expect((await rowsOf("next-2"))[0]?.dispatched_at).toBeNull();

    await fetchProcessor(
      await depsFor(picked(5000, 60_000)),
      createCancelRegistry(),
    )(fetchJob(data));
    expect((await rowsOf("next-2"))[0]?.dispatched_at).not.toBeNull();
    await t.db
      .updateTable("downloads")
      .set({ state: "done" })
      .where("video_id", "=", "next-2")
      .execute();
    await dispatchFor(h.ctx, cal.userId);
    expect(await rowsOf("big-2")).toMatchObject([{ state: "queued", dispatched_at: null }]);
  });
});
