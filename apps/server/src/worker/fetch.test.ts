import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fixture, type Scenario, type Step } from "@uroboros/ytdlp/testing";
import { UnrecoverableError } from "bullmq";
import type { Redis } from "ioredis";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { TestValkey } from "../../test/testValkey.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { queueDownload } from "../downloads/dispatch.ts";
import { eventsChannel } from "../downloads/events.ts";
import { argsOf } from "../downloads/profiles.ts";
import type { FetchJob } from "../downloads/queues.ts";
import { createValkey } from "../shared/valkey.ts";
import { createCancelRegistry, fetchProcessor } from "./fetch.ts";
import { createProgressPublisher } from "./progress.ts";

const logger = pino({ level: "silent" });
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

/** The recorded download of the clip, plus a thumbnail beside it. */
async function downloadScenario(extra: Step[] = []): Promise<Scenario> {
  const transcript = JSON.parse(await fixture("download-clip.json")) as {
    stdout: string;
    stderr: string;
  };
  return {
    steps: [
      ...extra,
      { writeFile: "clip.mp4", content: "media bytes" },
      { writeFile: "clip.jpg", content: "jpeg" },
      { writeFile: "clip.info.json", content: await fixture("info-clip.json") },
      { stdout: transcript.stdout },
      { stderr: transcript.stderr },
    ],
  };
}

/** Queues `videoId` for each user and returns the fetch job a dispatch would add. */
async function queued(videoId: string, users: SignedIn[]): Promise<FetchJob> {
  const profile = await seededDefault(testDb.db);
  for (const u of users) {
    await testDb.db.transaction().execute((tx) =>
      queueDownload(tx, {
        userId: u.userId,
        requestId: null,
        extractor: "Generic",
        videoId,
        url: `http://127.0.0.1:18765/${videoId}.mp4`,
        title: videoId,
        profile,
      }),
    );
  }
  const row = await testDb.db
    .selectFrom("downloads")
    .select("fetch_key")
    .where("video_id", "=", videoId)
    .executeTakeFirstOrThrow();
  return {
    fetchKey: row.fetch_key,
    extractor: "generic",
    videoId,
    url: `http://127.0.0.1:18765/${videoId}.mp4`,
    profileId: profile.id,
    profileName: profile.name,
    revision: profile.revision,
    args: argsOf(profile),
  };
}

const job = (data: FetchJob, attemptsMade = 0) => ({
  id: data.fetchKey,
  data,
  attemptsMade,
  opts: { attempts: 3 },
});

const states = (videoId: string) =>
  testDb.db
    .selectFrom("downloads")
    .select(["user_id", "state", "error_kind", "attempts", "stderr_tail"])
    .where("video_id", "=", videoId)
    .execute();

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
    expect(r).toMatchObject({ video_codec: "h264", width: 320, height: 240, container: "mp4" });
    expect(r.storage_key).toMatch(/\[Best up to 1080p \(MP4\)\]\.mp4$/);
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

  it("leaves a network failure running for BullMQ to retry, counting the attempt", async () => {
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

describe("subtitles and chapters", () => {
  it("stores subtitles beside the file and copies the chapters", async () => {
    const u = await user();
    const data = await queued("subs-1", [u]);
    const info = JSON.parse(await fixture("info-clip.json")) as Record<string, unknown>;
    info["chapters"] = [
      { start_time: 0, end_time: 10, title: "Intro" },
      { start_time: 10, end_time: 30, title: "Main" },
    ];
    info["subtitles"] = { en: [{ ext: "vtt", url: "https://x.example/en.vtt" }] };
    const scenario = await downloadScenario([{ writeFile: "clip.en.vtt", content: "WEBVTT\n" }]);
    scenario.steps = scenario.steps.map((s) =>
      "writeFile" in s && s.writeFile === "clip.info.json"
        ? { ...s, content: JSON.stringify(info) }
        : s,
    );
    await fetchProcessor(await h.deps(scenario), createCancelRegistry())(job(data));
    const media = await testDb.db
      .selectFrom("media")
      .select(["id", "chapters"])
      .where("video_id", "=", "subs-1")
      .executeTakeFirstOrThrow();
    expect(media.chapters).toEqual([
      { start: 0, end: 10, title: "Intro" },
      { start: 10, end: 30, title: "Main" },
    ]);
    const subs = await testDb.db
      .selectFrom("subtitles")
      .selectAll()
      .where("media_id", "=", media.id)
      .execute();
    expect(subs).toEqual([expect.objectContaining({ lang: "en", automatic: false })]);
    await expect(readdir(join(h.root, subs[0]?.storage_key ?? "", ".."))).resolves.toContain(
      subs[0]?.storage_key.split("/").at(-1),
    );
    const argv = await h.lastArgv();
    expect(argv).toEqual(
      expect.arrayContaining(["--write-subs", "--sub-langs=en.*", "--convert-subs=vtt"]),
    );
  });

  it("still succeeds with no subtitles and no chapters", async () => {
    const u = await user();
    const data = await queued("nosubs-1", [u]);
    await fetchProcessor(await h.deps(await downloadScenario()), createCancelRegistry())(job(data));
    expect((await states("nosubs-1"))[0]?.state).toBe("done");
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

describe("progress", () => {
  it("publishes at most two per second plus every phase change", async () => {
    const sub: Redis = createValkey(TestValkey.url(), "worker", logger);
    const seen: string[] = [];
    await sub.subscribe(eventsChannel(h.prefix));
    sub.on("message", (_c, m) => seen.push(m));
    try {
      const publish = createProgressPublisher(h.ctx.valkey, h.prefix, "k");
      const base = {
        videoId: null,
        filename: null,
        totalIsEstimate: false,
        speed: 1,
        eta: 1,
        elapsed: 1,
        fragmentIndex: null,
        fragmentCount: null,
        postprocessor: null,
      };
      for (let i = 0; i < 20; i++) {
        publish({
          ...base,
          phase: "downloading",
          state: "running",
          downloadedBytes: i,
          totalBytes: 20,
        });
      }
      publish({
        ...base,
        phase: "merging",
        state: "started",
        downloadedBytes: null,
        totalBytes: null,
      });
      await vi.waitFor(() => {
        expect(seen.some((m) => m.includes("merging"))).toBe(true);
      });
      expect(seen.length).toBeLessThanOrEqual(3);
    } finally {
      sub.disconnect();
    }
  });
});
