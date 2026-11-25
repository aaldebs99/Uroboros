import { existsSync } from "node:fs";
import { mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { testBus } from "../../test/bus.ts";
import { post, seededDefault } from "../../test/downloads.ts";
import { eventually } from "../../test/eventually.ts";
import { downloadScenario } from "../../test/fetchJobs.ts";
import { liveJobs } from "../../test/jobs.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import type { PgBus } from "../db/notifications.ts";
import { notify } from "../db/notifications.ts";
import { dispatchFor, queueDownload } from "../downloads/dispatch.ts";
import { type DownloadWorkers, startDownloadWorkers } from "./downloadWorkers.ts";
import { SCRATCH_STALE_MS } from "./scratch.ts";

/**
 * The replica's consumers as main wires them: a fetch picked off the queue, stopped by the api's
 * cancel over the bus, or cut for shutdown through abortRunning.
 */

let t: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let bus: PgBus;
let workers: DownloadWorkers | undefined;
let n = 0;

beforeAll(async () => {
  t = await TestDb.create();
  h = await workerHarness(t.db);
  bus = testBus(t);
  await bus.ready;
});
afterEach(async () => {
  if (workers !== undefined) {
    workers.abortRunning();
    await workers.jobs.drain();
    await workers.close();
    workers = undefined;
  }
});
afterAll(async () => {
  await bus.close();
  await h.close();
  await t.close();
});

/** A download of `videoId` for a new person, dispatched: its fetch job waits on the queue. */
async function dispatched(videoId: string): Promise<{ user: SignedIn; id: string }> {
  const user = await signedIn(t.db, { username: `dw${String(++n)}` });
  const profile = await seededDefault(t.db);
  const out = await t.db.transaction().execute((tx) =>
    queueDownload(tx, {
      userId: user.userId,
      requestId: null,
      extractor: "Generic",
      videoId,
      url: `http://127.0.0.1:18765/${videoId}.mp4`,
      title: videoId,
      profile,
    }),
  );
  expect(await dispatchFor(h.ctx, user.userId)).toBe(1);
  return { user, id: out.downloadId ?? "" };
}

/** Workers whose yt-dlp writes a partial file and then takes 10 s; no transcoding here. */
async function start(): Promise<DownloadWorkers> {
  const deps = await h.deps(
    await downloadScenario([
      { writeFile: "clip.mp4.part", content: "partial" },
      { sleepMs: 10_000 },
    ]),
  );
  workers = await startDownloadWorkers(
    { ...deps, transcodeConcurrency: 0 },
    { concurrency: 1, bus },
  );
  return workers;
}

const state = async (id: string) =>
  await t.db
    .selectFrom("downloads")
    .select(["state", "attempts"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

describe("the replica's download workers", () => {
  it("stop a running fetch when the api's cancel comes over the bus, ignoring malformed ones", async () => {
    const { user, id } = await dispatched("dw-cancel");
    await start();
    await eventually(async () => {
      expect((await state(id)).state).toBe("running");
    });
    // Nothing a sender could garble stops it, or throws in the listener.
    await notify(t.db, "uroboros_cancel", "not json");
    await notify(t.db, "uroboros_cancel", JSON.stringify({ fetchKey: 42 }));
    await notify(t.db, "uroboros_cancel", JSON.stringify({ fetchKey: "fetch|nothing" }));
    await new Promise((r) => setTimeout(r, 300));
    expect((await state(id)).state).toBe("running");
    // The cancel route marks it and asks over the bus; the fetch stops, long before yt-dlp's 10 s.
    const asked = Date.now();
    expect((await post(h.app(user), `/api/downloads/${id}/cancel`)).status).toBe(204);
    await eventually(async () => {
      expect(await liveJobs(t.db, "download")).toEqual([]);
    });
    expect(Date.now() - asked).toBeLessThan(5000);
    expect((await state(id)).state).toBe("cancelled");
    expect(await readdir(h.workDir)).toEqual([]);
  });

  it("sweep the scratch folders a dead replica left as they start", async () => {
    const dead = join(h.workDir, "fetch%7Cdead.0123456789ab");
    await mkdir(dead, { recursive: true });
    await writeFile(join(dead, "clip.mp4.part"), "partial");
    const then = new Date(Date.now() - SCRATCH_STALE_MS - 60_000);
    await utimes(dead, then, then);
    await start();
    await eventually(() => {
      expect(existsSync(dead)).toBe(false);
    });
  });

  it("put a running fetch back for another replica when cut for shutdown, spending nothing", async () => {
    const { id } = await dispatched("dw-cut");
    const w = await start();
    await eventually(async () => {
      expect((await state(id)).state).toBe("running");
    });
    w.abortRunning();
    // The job goes back with its attempt returned (the next run is still the first), and the
    // download records no failure.
    await eventually(async () => {
      expect(await liveJobs(t.db, "download")).toMatchObject([{ state: "queued", attempts: 0 }]);
    });
    const row = await t.db
      .selectFrom("downloads")
      .select(["state", "error_kind"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ state: "running", error_kind: null });
    expect(await readdir(h.workDir)).toEqual([]);
  });
});
