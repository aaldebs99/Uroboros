import { fixture, type Scenario, type Step } from "@uroboros/ytdlp/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { listedNotices } from "../../test/notices.ts";
import { holdSite, loggedLimits, queuedPushes } from "../../test/rateLimits.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { queueDownload } from "../downloads/dispatch.ts";
import { argsOf } from "../downloads/profiles.ts";
import type { FetchJob } from "../downloads/queues.ts";
import { activeCooldown } from "../downloads/rateLimits.ts";
import { RequeueError } from "../jobs/errors.ts";
import { clearNotices } from "../notices/store.ts";
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

const YOUTUBE_LIMIT =
  "ERROR: [youtube] x: Video unavailable. This content isn't available, try again later. The " +
  "current session has been rate-limited by YouTube for up to an hour.\n";
const LIMITED: Step = { stderr: "ERROR: [generic] x: HTTP Error 429: Too Many Requests\n" };

/** The recorded download of the clip. */
async function downloadScenario(): Promise<Scenario> {
  const transcript = JSON.parse(await fixture("download-clip.json")) as {
    stdout: string;
    stderr: string;
  };
  return {
    steps: [
      { writeFile: "clip.mp4", content: "media bytes" },
      { writeFile: "clip.info.json", content: await fixture("info-clip.json") },
      { stdout: transcript.stdout },
      { stderr: transcript.stderr },
    ],
  };
}

/** One person's download of a video on `site`, and the fetch job a dispatch would add. */
async function queued(site: string): Promise<FetchJob> {
  return (await queuedFor(site, 1)).data;
}

/**
 * `people` people's downloads of one video on `site` (one fetch), titled "Video <n>": the fetch
 * job, and who waits on it with which download.
 */
async function queuedFor(site: string, people: number) {
  const profile = await seededDefault(testDb.db);
  const videoId = `rl-${String(++n)}`;
  const url = `http://${site}/${videoId}.mp4`;
  const waiting: { userId: string; downloadId: string }[] = [];
  for (let i = 0; i < people; i++) {
    const u = await signedIn(testDb.db, { username: `rl${String(n)}-${String(i)}` });
    await testDb.db.transaction().execute((tx) =>
      queueDownload(tx, {
        userId: u.userId,
        requestId: null,
        extractor: "Generic",
        videoId,
        url,
        title: `Video ${String(n)}`,
        profile,
      }),
    );
    const d = await testDb.db
      .selectFrom("downloads")
      .select("id")
      .where("video_id", "=", videoId)
      .where("user_id", "=", u.userId)
      .executeTakeFirstOrThrow();
    waiting.push({ userId: u.userId, downloadId: d.id });
  }
  const row = await testDb.db
    .selectFrom("downloads")
    .select("fetch_key")
    .where("video_id", "=", videoId)
    .executeTakeFirstOrThrow();
  const data: FetchJob = {
    fetchKey: row.fetch_key,
    extractor: "generic",
    videoId,
    url,
    profileId: profile.id,
    profileName: profile.name,
    revision: profile.revision,
    args: argsOf(profile),
  };
  return { data, waiting };
}

const job = (data: FetchJob) => ({
  id: data.fetchKey,
  data,
  attemptsMade: 0,
  opts: { attempts: 3 },
});

const row = (data: FetchJob) =>
  testDb.db
    .selectFrom("downloads")
    .select(["state", "error_kind", "attempts", "retry_at"])
    .where("fetch_key", "=", data.fetchKey)
    .executeTakeFirstOrThrow();

/** Runs the fetch and returns the requeue it ended with. */
async function requeued(run: Promise<void>): Promise<RequeueError> {
  const err = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(RequeueError);
  return err as RequeueError;
}

/** The fetch's (one) waiter: who, their download, and the library entry it made. */
const waiterOf = async (data: FetchJob) => {
  const d = await testDb.db
    .selectFrom("downloads as d")
    .innerJoin("library_entries as e", (j) =>
      j.onRef("e.rendition_id", "=", "d.rendition_id").onRef("e.user_id", "=", "d.user_id"),
    )
    .select(["d.id", "d.user_id", "e.id as entry_id"])
    .where("d.fetch_key", "=", data.fetchKey)
    .executeTakeFirstOrThrow();
  return { userId: d.user_id, downloadId: d.id, entryId: d.entry_id };
};

/** The stored media of a video. */
const mediaIdOf = async (videoId: string) =>
  (
    await testDb.db
      .selectFrom("media")
      .select("id")
      .where("video_id", "=", videoId)
      .executeTakeFirstOrThrow()
  ).id;

/** The subtitle jobs queued for a media. */
const subtitleJobs = (videoId: string) =>
  testDb.db
    .selectFrom("jobs as j")
    .innerJoin("media as m", (on) => on.on(sql<boolean>`j.key = 'subtitles:' || m.id::text`))
    .select(["j.queue", "j.name", sql<number>`extract(epoch FROM j.run_at - now())`.as("in_s")])
    .where("m.video_id", "=", videoId)
    .execute();

describe("a fetch the site rate-limits", () => {
  it("waits out an estimated cooldown, queued again, instead of spending an attempt", async () => {
    const data = await queued("rl1.example");
    const deps = await h.deps({ steps: [LIMITED], exitCode: 1 });
    const err = await requeued(fetchProcessor(deps, createCancelRegistry())(job(data)));
    expect(err.delayMs).toBeGreaterThanOrEqual(58_000);
    expect(err.delayMs).toBeLessThanOrEqual(76_000);
    const r = await row(data);
    expect(r).toMatchObject({ state: "queued", error_kind: "rate_limited", attempts: 0 });
    expect(r.retry_at).not.toBeNull();
    expect(await activeCooldown(testDb.db, "rl1.example", "site")).not.toBeNull();
  });

  it("waits as long as the site says", async () => {
    const data = await queued("rl2.example");
    const deps = await h.deps({ steps: [{ stderr: YOUTUBE_LIMIT }], exitCode: 1 });
    const err = await requeued(fetchProcessor(deps, createCancelRegistry())(job(data)));
    expect(err.delayMs).toBeGreaterThanOrEqual(3_598_000);
  });

  it("asks nothing of a site that is cooling down", async () => {
    const data = await queued("rl3.example");
    await holdSite(testDb.db, "rl3.example");
    const deps = await h.deps(await downloadScenario());
    await requeued(fetchProcessor(deps, createCancelRegistry())(job(data)));
    await expect(h.runs.at(-1)?.argv()).rejects.toThrow();
    expect(await row(data)).toMatchObject({ state: "queued", error_kind: "rate_limited" });
  });

  it("clears the limits in a row once the site answers again", async () => {
    const data = await queued("rl4.example");
    await testDb.db
      .insertInto("site_cooldowns")
      .values({
        site: "rl4.example",
        scope: "site",
        until: sql`now() - interval '1 second'`,
        strikes: 3,
      })
      .execute();
    await fetchProcessor(await h.deps(await downloadScenario()), createCancelRegistry())(job(data));
    expect(await row(data)).toMatchObject({ state: "done", retry_at: null });
    const left = await testDb.db
      .selectFrom("site_cooldowns")
      .select("site")
      .where("site", "=", "rl4.example")
      .execute();
    expect(left).toEqual([]);
  });
});

describe("what a fetch's rate limit tells", () => {
  it("logs the limit for the admin: yt-dlp's message, the video and its cooldown", async () => {
    const { data } = await queuedFor("rl7.example", 1);
    const deps = await h.deps({ steps: [LIMITED], exitCode: 1 });
    await requeued(fetchProcessor(deps, createCancelRegistry())(job(data)));
    const until = await activeCooldown(testDb.db, "rl7.example", "site");
    expect(await loggedLimits(testDb.db, "rl7.example")).toEqual([
      {
        scope: "site",
        source: "download",
        message: "[generic] x: HTTP Error 429: Too Many Requests",
        url: data.url,
        title: `Video ${String(n)}`,
        media_id: null,
        until,
        hinted: false,
        strikes: 1,
      },
    ]);
  });

  it("tells each person waiting, once, in their bell and never on their devices", async () => {
    const { data, waiting } = await queuedFor("rl8.example", 2);
    const title = `Video ${String(n)}`;
    const deps = await h.deps({ steps: [LIMITED], exitCode: 1 });
    await requeued(fetchProcessor(deps, createCancelRegistry())(job(data)));
    for (const w of waiting) {
      expect(await listedNotices(testDb.db, w.userId)).toEqual([
        {
          kind: "downloads",
          title: `Waiting: ${title}`,
          body: "rl8.example is limiting requests. It will try again on its own.",
          path: "/downloads",
          tag: `rate-limit:download:${w.downloadId}`,
          read_at: null,
        },
      ]);
      expect(await queuedPushes(testDb.db, w.userId)).toEqual([]);
    }
    // Read; the passes that wait out the cooldown neither file it again nor mark it unread.
    await testDb.db.updateTable("notices").set({ read_at: new Date() }).execute();
    await requeued(fetchProcessor(await h.deps({ steps: [] }), createCancelRegistry())(job(data)));
    for (const w of waiting) {
      const [only, ...more] = await listedNotices(testDb.db, w.userId);
      expect(more).toEqual([]);
      expect(only?.read_at).not.toBeNull();
    }
    // And the log holds the limit, not the passes.
    expect(await loggedLimits(testDb.db, "rl8.example")).toHaveLength(1);
  });

  it("tells no one again after they clear their bell while it still waits", async () => {
    const { data, waiting } = await queuedFor("rl10.example", 1);
    const userId = waiting[0]?.userId ?? "";
    await requeued(
      fetchProcessor(
        await h.deps({ steps: [LIMITED], exitCode: 1 }),
        createCancelRegistry(),
      )(job(data)),
    );
    expect(await listedNotices(testDb.db, userId)).toHaveLength(1);
    await clearNotices(testDb.db, userId);
    await requeued(fetchProcessor(await h.deps({ steps: [] }), createCancelRegistry())(job(data)));
    expect(await listedNotices(testDb.db, userId)).toEqual([]);
  });

  it("tells the person whose fetch waits on a site already cooling down", async () => {
    const { data, waiting } = await queuedFor("rl9.example", 1);
    await holdSite(testDb.db, "rl9.example");
    await requeued(fetchProcessor(await h.deps({ steps: [] }), createCancelRegistry())(job(data)));
    const userId = waiting[0]?.userId ?? "";
    expect((await listedNotices(testDb.db, userId)).map((x) => x.title)).toEqual([
      `Waiting: Video ${String(n)}`,
    ]);
  });
});

describe("subtitles the site rate-limits", () => {
  it("stores the video now and fetches its subtitles after the cooldown", async () => {
    const data = await queued("rl5.example");
    const scenario = await downloadScenario();
    scenario.variants = [
      {
        whenArg: "--write-subs",
        steps: [
          {
            stderr:
              "ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests\n",
          },
        ],
        exitCode: 1,
      },
    ];
    await fetchProcessor(await h.deps(scenario), createCancelRegistry())(job(data));
    expect((await row(data)).state).toBe("done");
    expect(await activeCooldown(testDb.db, "rl5.example", "subtitles")).not.toBeNull();
    // The video itself was never limited.
    expect(await activeCooldown(testDb.db, "rl5.example", "site")).toBeNull();
    const jobs = await subtitleJobs(data.videoId);
    expect(jobs).toEqual([expect.objectContaining({ queue: "probe", name: "subtitles" })]);
    expect(Number(jobs[0]?.in_s)).toBeGreaterThan(55);
    // Logged as subtitles, and the person told their subtitles wait.
    expect(await loggedLimits(testDb.db, "rl5.example")).toEqual([
      expect.objectContaining({
        scope: "subtitles",
        source: "subtitles",
        message: "Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests",
        url: data.url,
        title: `Video ${String(n)}`,
        // The video was stored after all: the log links it in the library.
        media_id: await mediaIdOf(data.videoId),
      }),
    ]);
    const waiter = await waiterOf(data);
    expect(await listedNotices(testDb.db, waiter.userId)).toEqual([
      {
        kind: "downloads",
        title: `Subtitles waiting: Video ${String(n)}`,
        body: "rl5.example is limiting requests for subtitles. They'll be added on their own.",
        path: `/library/${waiter.entryId}`,
        tag: `rate-limit:subtitles:${waiter.downloadId}`,
        read_at: null,
      },
    ]);
    expect(await queuedPushes(testDb.db, waiter.userId)).toEqual([]);
  });

  it("asks for no subtitles while they are held, and fetches them later", async () => {
    const data = await queued("rl6.example");
    await holdSite(testDb.db, "rl6.example", "subtitles", 600_000);
    await fetchProcessor(await h.deps(await downloadScenario()), createCancelRegistry())(job(data));
    expect((await row(data)).state).toBe("done");
    expect((await h.lastArgv()).filter((a) => a.includes("sub"))).toEqual([]);
    const jobs = await subtitleJobs(data.videoId);
    expect(jobs).toHaveLength(1);
    expect(Number(jobs[0]?.in_s)).toBeGreaterThan(595);
    const waiter = await waiterOf(data);
    expect((await listedNotices(testDb.db, waiter.userId)).map((x) => x.title)).toEqual([
      `Subtitles waiting: Video ${String(n)}`,
    ]);
  });
});
