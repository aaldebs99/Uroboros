import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, type Scenario } from "@uroboros/ytdlp/testing";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import type { SubtitlesJob } from "../downloads/queues.ts";
import { activeCooldown, noteRateLimit } from "../downloads/rateLimits.ts";
import { RequeueError } from "../jobs/errors.ts";
import { subtitlesProcessor } from "./subtitlesJob.ts";

let testDb: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let alice: SignedIn;
let n = 0;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await workerHarness(testDb.db, 1);
  alice = await signedIn(testDb.db, { username: "sjalice" });
});
afterAll(async () => {
  await h.close();
  await testDb.close();
});

/** A video in Alice's library whose subtitles a rate limit held back, on `site`. */
async function held(site: string): Promise<SubtitlesJob> {
  const videoId = `sj-${String(++n)}`;
  const e = await seedEntry(testDb.db, alice.userId, { videoId });
  return {
    mediaId: e.mediaId,
    renditionId: e.renditionId,
    url: `http://${site}/${videoId}`,
    userId: alice.userId,
  };
}

/** yt-dlp writing the clip's info and an English subtitle. */
async function subtitlesScenario(): Promise<Scenario> {
  const info = JSON.parse(await fixture("info-clip.json")) as Record<string, unknown>;
  info["subtitles"] = { en: [{ ext: "vtt", url: "https://x.example/en.vtt" }] };
  return {
    steps: [
      { writeFile: "clip.info.json", content: JSON.stringify(info) },
      {
        writeFile: "clip.en.vtt",
        content: "WEBVTT\n\n00:00:02.000 --> 00:00:04.000\nheld back until now\n",
      },
    ],
  };
}

const run = async (data: SubtitlesJob, scenario: Scenario) =>
  subtitlesProcessor(await h.deps(scenario))({ data });

const outcome = (p: Promise<void>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

describe("subtitles a rate limit held back", () => {
  it("never clear a folder another run for the video still writes in", async () => {
    const data = await held("sj0.example");
    const theirs = join(h.workDir, `subtitles-${data.mediaId}`);
    await mkdir(theirs, { recursive: true });
    await writeFile(join(theirs, "clip.en.vtt"), "theirs");
    await run(data, await subtitlesScenario());
    expect(await readFile(join(theirs, "clip.en.vtt"), "utf8")).toBe("theirs");
    await rm(theirs, { recursive: true });
  });

  it("are fetched alone, stored and searchable, and the site's subtitle limit is over", async () => {
    const data = await held("sj1.example");
    await testDb.db
      .insertInto("site_cooldowns")
      .values({
        site: "sj1.example",
        scope: "subtitles",
        until: sql`now() - interval '1 second'`,
        strikes: 2,
      })
      .execute();
    await run(data, await subtitlesScenario());
    expect(await h.lastArgv()).toEqual(
      expect.arrayContaining(["--skip-download", "--write-subs", "--sub-langs=en.*"]),
    );
    const subs = await testDb.db
      .selectFrom("subtitles")
      .select(["lang", "automatic", "storage_key"])
      .where("media_id", "=", data.mediaId)
      .execute();
    expect(subs).toEqual([expect.objectContaining({ lang: "en", automatic: false })]);
    const segments = await testDb.db
      .selectFrom("caption_segments")
      .select("text")
      .where("media_id", "=", data.mediaId)
      .execute();
    expect(segments).toEqual([{ text: "held back until now" }]);
    const left = await testDb.db
      .selectFrom("site_cooldowns")
      .select("site")
      .where("site", "=", "sj1.example")
      .execute();
    expect(left).toEqual([]);
  });

  it("wait, asking nothing, while the site or its subtitles cool down", async () => {
    for (const scope of ["subtitles", "site"] as const) {
      const site = `sj2-${scope}.example`;
      const data = await held(site);
      await noteRateLimit(testDb.db, site, scope, 600_000);
      const err = await outcome(run(data, await subtitlesScenario()));
      expect(err).toBeInstanceOf(RequeueError);
      expect((err as RequeueError).delayMs).toBeGreaterThan(590_000);
      await expect(h.runs.at(-1)?.argv()).rejects.toThrow();
    }
  });

  it("wait again when the site still limits them", async () => {
    const data = await held("sj3.example");
    const err = await outcome(
      run(data, {
        steps: [
          {
            stderr:
              "ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests\n",
          },
        ],
        exitCode: 1,
      }),
    );
    expect(err).toBeInstanceOf(RequeueError);
    expect(await activeCooldown(testDb.db, "sj3.example", "subtitles")).not.toBeNull();
    expect(await activeCooldown(testDb.db, "sj3.example", "site")).toBeNull();
  });

  it("are dropped with the video", async () => {
    const data = { ...(await held("sj4.example")), renditionId: randomUUID() };
    await run(data, await subtitlesScenario());
    await expect(h.runs.at(-1)?.argv()).rejects.toThrow();
  });
});
