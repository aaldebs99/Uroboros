import { fixture, type Scenario, type Step } from "@uroboros/ytdlp/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { queueDownload } from "../downloads/dispatch.ts";
import { argsOf } from "../downloads/profiles.ts";
import type { FetchJob } from "../downloads/queues.ts";
import { activeCooldown, noteRateLimit } from "../downloads/rateLimits.ts";
import { RequeueError } from "../jobs/errors.ts";
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
  const profile = await seededDefault(testDb.db);
  const u = await signedIn(testDb.db, { username: `rl${String(++n)}` });
  const videoId = `rl-${String(n)}`;
  const url = `http://${site}/${videoId}.mp4`;
  await testDb.db.transaction().execute((tx) =>
    queueDownload(tx, {
      userId: u.userId,
      requestId: null,
      extractor: "Generic",
      videoId,
      url,
      title: videoId,
      profile,
    }),
  );
  const row = await testDb.db
    .selectFrom("downloads")
    .select("fetch_key")
    .where("video_id", "=", videoId)
    .executeTakeFirstOrThrow();
  return {
    fetchKey: row.fetch_key,
    extractor: "generic",
    videoId,
    url,
    profileId: profile.id,
    profileName: profile.name,
    revision: profile.revision,
    args: argsOf(profile),
  };
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
    await noteRateLimit(testDb.db, "rl3.example", "site", null);
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
  });

  it("asks for no subtitles while they are held, and fetches them later", async () => {
    const data = await queued("rl6.example");
    await noteRateLimit(testDb.db, "rl6.example", "subtitles", 600_000);
    await fetchProcessor(await h.deps(await downloadScenario()), createCancelRegistry())(job(data));
    expect((await row(data)).state).toBe("done");
    expect((await h.lastArgv()).filter((a) => a.includes("sub"))).toEqual([]);
    const jobs = await subtitleJobs(data.videoId);
    expect(jobs).toHaveLength(1);
    expect(Number(jobs[0]?.in_s)).toBeGreaterThan(595);
  });
});
