import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { TestDb } from "../../test/testDb.ts";
import { downloadScenario, downloadStates, fetchJob, queuedFetch } from "../../test/fetchJobs.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { queuedData } from "../../test/jobs.ts";
import type { FetchJob, PreviewJob } from "../downloads/queues.ts";
import { RequeueError, UnrecoverableError } from "../jobs/errors.ts";
import { createCancelRegistry, fetchProcessor } from "./fetch.ts";

let testDb: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let n = 0;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await workerHarness(testDb.db, 1);
});
afterAll(async () => {
  await h.close();
  await testDb.close();
});

const user = (): Promise<SignedIn> => signedIn(testDb.db, { username: `f${String(++n)}` });

const queued = (videoId: string, users: SignedIn[]): Promise<FetchJob> =>
  queuedFetch(testDb.db, videoId, users);
const job = fetchJob;
const states = (videoId: string) => downloadStates(testDb.db, videoId);

describe("fetch", () => {
  it("stores the file, settles every waiting download, adds library entries and dispatches the next", async () => {
    const [a, b] = [await user(), await user()];
    const data = await queued("ok-1", [a, b]);
    await queued("ok-2", [a]);
    await fetchProcessor(await h.deps(await downloadScenario()), createCancelRegistry())(job(data));

    expect((await states("ok-1")).map((s) => s.state)).toEqual(["done", "done"]);
    const r = await testDb.db
      .selectFrom("renditions")
      .selectAll()
      .where("profile_id", "=", data.profileId)
      .orderBy("created_at", "desc")
      .executeTakeFirstOrThrow();
    expect(r).toMatchObject({
      video_codec: "h264",
      width: 320,
      height: 240,
      container: "mp4",
      video_codecs: "avc1.f4000d",
      audio_codecs: "mp4a.40.2",
    });
    const keyframes = await testDb.db
      .selectFrom("rendition_keyframes")
      .select("times")
      .where("rendition_id", "=", r.id)
      .executeTakeFirst();
    expect(keyframes?.times).toEqual([0, 2]);
    expect(r.storage_key).toMatch(/\[Best available\]\.mp4$/);
    const stored = await readdir(join(h.root, r.storage_key, ".."));
    expect(stored.sort()).toEqual(
      expect.arrayContaining([r.storage_key.split("/").at(-1), "clip.jpg", "clip.info.json"]),
    );
    const lib = await testDb.db
      .selectFrom("library_entries")
      .select("user_id")
      .where("rendition_id", "=", r.id)
      .execute();
    expect(lib.map((l) => l.user_id).sort()).toEqual([a.userId, b.userId].sort());
    expect(await readdir(h.workDir)).toEqual([]);
    const next = await testDb.db
      .selectFrom("downloads")
      .select("dispatched_at")
      .where("video_id", "=", "ok-2")
      .executeTakeFirstOrThrow();
    expect(next.dispatched_at).not.toBeNull();
    // The video's hover preview is queued (docs/library.md).
    expect(await queuedData<PreviewJob>(testDb.db, "preview")).toContainEqual({
      mediaId: r.media_id,
    });
  });

  it("queues no hover preview when they are off", async () => {
    const data = await queued("no-preview", [await user()]);
    const deps = { ...(await h.deps(await downloadScenario())), generatePreviews: false };
    await fetchProcessor(deps, createCancelRegistry())(job(data));
    const r = await testDb.db
      .selectFrom("renditions")
      .select("media_id")
      .where("profile_id", "=", data.profileId)
      .orderBy("created_at", "desc")
      .executeTakeFirstOrThrow();
    expect(await queuedData<PreviewJob>(testDb.db, "preview")).not.toContainEqual({
      mediaId: r.media_id,
    });
  });

  it("never overwrites another revision's file when a profile is edited (filesystem)", async () => {
    const u = await user();
    const first = await queued("rev-1", [u]);
    await fetchProcessor(
      await h.deps(await downloadScenario()),
      createCancelRegistry(),
    )(job(first));
    const edited = { ...first, revision: "edited00000", fetchKey: `${first.fetchKey}-edited` };
    await testDb.db
      .insertInto("downloads")
      .values({
        user_id: u.userId,
        profile_id: first.profileId,
        profile_revision: edited.revision,
        args: JSON.stringify(first.args),
        extractor: "generic",
        video_id: "rev-1",
        url: first.url,
        fetch_key: edited.fetchKey,
      })
      .execute();
    await fetchProcessor(
      await h.deps(await downloadScenario()),
      createCancelRegistry(),
    )(job(edited));
    const rows = await testDb.db
      .selectFrom("renditions as r")
      .innerJoin("media as m", "m.id", "r.media_id")
      .select(["r.storage_key", "r.profile_revision"])
      .where("m.video_id", "=", "rev-1")
      .execute();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.storage_key)).size).toBe(2);
    for (const r of rows)
      await expect(readdir(join(h.root, r.storage_key, ".."))).resolves.toBeDefined();
  });

  it("fails a private video at once, keeping the stderr tail, without a retry", async () => {
    const u = await user();
    const data = await queued("private-1", [u]);
    const deps = await h.deps({
      steps: [
        { stderr: "ERROR: [youtube] x: Private video. Sign in if you've been granted access\n" },
      ],
      exitCode: 1,
    });
    await expect(fetchProcessor(deps, createCancelRegistry())(job(data))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    const [s] = await states("private-1");
    expect(s).toMatchObject({ state: "failed", error_kind: "private" });
    expect(s?.stderr_tail.join("\n")).toMatch(/Private video/);
  });

  it("leaves a network failure running for the queue to retry, counting the attempt", async () => {
    const u = await user();
    const data = await queued("net-1", [u]);
    const deps = await h.deps({
      steps: [
        {
          stderr:
            "ERROR: Unable to download webpage: <urlopen error [Errno 111] Connection refused>\n",
        },
      ],
      exitCode: 1,
    });
    const err: unknown = await fetchProcessor(
      deps,
      createCancelRegistry(),
    )(job(data)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UnrecoverableError);
    expect((await states("net-1"))[0]).toMatchObject({
      state: "running",
      error_kind: "network",
      attempts: 1,
    });
  });

  it("fails a network error on the last attempt", async () => {
    const u = await user();
    const data = await queued("net-2", [u]);
    const deps = await h.deps({
      steps: [{ stderr: "ERROR: Unable to download webpage: timed out\n" }],
      exitCode: 1,
    });
    await expect(fetchProcessor(deps, createCancelRegistry())(job(data, 2))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect((await states("net-2"))[0]).toMatchObject({ state: "failed", error_kind: "network" });
  });

  it("is safe to run twice (a stalled job): one rendition, one entry each", async () => {
    const u = await user();
    const data = await queued("twice-1", [u]);
    await testDb.db
      .updateTable("downloads")
      .set({ state: "running" })
      .where("video_id", "=", "twice-1")
      .execute();
    const process = fetchProcessor(await h.deps(await downloadScenario()), createCancelRegistry());
    await process(job(data));
    await testDb.db
      .updateTable("downloads")
      .set({ state: "running" })
      .where("video_id", "=", "twice-1")
      .execute();
    await process(job(data));
    const media = await testDb.db
      .selectFrom("media")
      .select("id")
      .where("video_id", "=", "twice-1")
      .executeTakeFirstOrThrow();
    expect(
      await testDb.db
        .selectFrom("renditions")
        .select("id")
        .where("media_id", "=", media.id)
        .execute(),
    ).toHaveLength(1);
    expect(
      await testDb.db
        .selectFrom("library_entries")
        .select("id")
        .where("media_id", "=", media.id)
        .execute(),
    ).toHaveLength(1);
  });

  it("stops a cancelled fetch and leaves no partial files", async () => {
    const u = await user();
    const data = await queued("cancel-1", [u]);
    const registry = createCancelRegistry();
    const running = fetchProcessor(
      await h.deps(
        await downloadScenario([
          { writeFile: "clip.mp4.part", content: "partial" },
          { sleepMs: 10_000 },
        ]),
      ),
      registry,
    )(job(data));
    await vi.waitFor(async () => {
      expect((await states("cancel-1"))[0]?.state).toBe("running");
    });
    await testDb.db
      .updateTable("downloads")
      .set({ state: "cancelled" })
      .where("video_id", "=", "cancel-1")
      .execute();
    registry.cancel(data.fetchKey);
    await expect(running).resolves.toBeUndefined();
    expect(await readdir(h.workDir)).toEqual([]);
    expect((await states("cancel-1"))[0]?.state).toBe("cancelled");
  });
});

describe("shutdown", () => {
  it("requeues a fetch cut by shutdown without recording a failure or spending an attempt", async () => {
    const u = await user();
    const data = await queued("shutdown-1", [u]);
    const registry = createCancelRegistry();
    const running = fetchProcessor(
      await h.deps(
        await downloadScenario([
          { writeFile: "clip.mp4.part", content: "partial" },
          { sleepMs: 10_000 },
        ]),
      ),
      registry,
    )(job(data));
    await vi.waitFor(async () => {
      expect((await states("shutdown-1"))[0]?.state).toBe("running");
    });
    registry.abortAll();
    // Back to the queue without spending an attempt.
    await expect(running).rejects.toBeInstanceOf(RequeueError);
    expect(await readdir(h.workDir)).toEqual([]);
    const [row] = await states("shutdown-1");
    expect(row?.state).toBe("running");
  });

  it("stops quietly, recording nothing, when its run lost the job to another", async () => {
    const u = await user();
    const data = await queued("lost-1", [u]);
    const lost = new AbortController();
    const running = fetchProcessor(
      await h.deps(await downloadScenario([{ sleepMs: 10_000 }])),
      createCancelRegistry(),
    )({ ...job(data), signal: lost.signal });
    await vi.waitFor(async () => {
      expect((await states("lost-1"))[0]?.state).toBe("running");
    });
    lost.abort();
    await running;
    expect(await states("lost-1")).toMatchObject([{ state: "running", error_kind: null }]);
  });
});

describe("cancel races", () => {
  it("retries instead of finishing quietly when someone else started waiting during the cancel", async () => {
    const [a, b] = [await user(), await user()];
    const data = await queued("race-c", [a]);
    const registry = createCancelRegistry();
    const running = fetchProcessor(
      await h.deps(await downloadScenario([{ sleepMs: 10_000 }])),
      registry,
    )(job(data));
    await vi.waitFor(async () => {
      expect((await states("race-c"))[0]?.state).toBe("running");
    });
    await testDb.db
      .updateTable("downloads")
      .set({ state: "cancelled" })
      .where("user_id", "=", a.userId)
      .where("video_id", "=", "race-c")
      .execute();
    await queued("race-c", [b]);
    registry.cancel(data.fetchKey);
    await expect(running).rejects.toThrow(/still waits/);
  });
});
