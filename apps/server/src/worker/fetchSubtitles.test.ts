import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fixture, type Scenario, type Step } from "@uroboros/ytdlp/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { queueDownload } from "../downloads/dispatch.ts";
import { argsOf } from "../downloads/profiles.ts";
import type { FetchJob } from "../downloads/queues.ts";
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

const user = (): Promise<SignedIn> => signedIn(testDb.db, { username: `fs${String(++n)}` });

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
    const scenario = await downloadScenario([
      {
        writeFile: "clip.en.vtt",
        content: "WEBVTT\n\n00:00:01.500 --> 00:00:03.000\nwelcome to the clip\n",
      },
    ]);
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
    // Their captions are searchable at once.
    const segments = await testDb.db
      .selectFrom("caption_segments")
      .select(["start_s", "text"])
      .where("media_id", "=", media.id)
      .execute();
    expect(segments).toEqual([{ start_s: 1.5, text: "welcome to the clip" }]);
    expect(subs[0]?.indexed_at).not.toBeNull();
  });

  it("still succeeds when a subtitle cannot be stored", async () => {
    const u = await user();
    const data = await queued("subfail-1", [u]);
    const other = await testDb.db
      .insertInto("media")
      .values({ extractor: "x", video_id: `o-${String(Date.now())}` })
      .returning("id")
      .executeTakeFirstOrThrow();
    const scenario = await downloadScenario([{ writeFile: "clip.en.vtt", content: "WEBVTT\n" }]);
    // Another media already holds every key this subtitle could get.
    let n = 0;
    const hold = (key: string) =>
      testDb.db
        .insertInto("subtitles")
        .values({ media_id: other.id, lang: `hold${String(++n)}`, storage_key: key })
        .execute();

    await hold("Blender/2026-11-22 clip [subfail-1]/clip [Best up to 1080p (MP4)].en.vtt");
    await hold("_/2026-11-22 clip [subfail-1]/clip [Best up to 1080p (MP4)].en.vtt");
    await hold("_/2026-11-22 clip [subfail-1]/clip.en.vtt");
    await fetchProcessor(await h.deps(scenario), createCancelRegistry())(job(data));
    expect((await states("subfail-1"))[0]?.state).toBe("done");
  });

  it("fetches the video without subtitles when the site refuses them", async () => {
    const u = await user();
    const data = await queued("sub429-1", [u]);
    const scenario = await downloadScenario();
    // yt-dlp writes subtitles before the video, and a failed one fails the whole run.
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
    expect((await states("sub429-1"))[0]?.state).toBe("done");
    const argv = await h.lastArgv();
    expect(argv.filter((a) => a.startsWith("--") && a.includes("sub"))).toEqual([]);
  });

  it("still fails a download whose video fails, subtitles or not", async () => {
    const u = await user();
    const data = await queued("sub-unavailable-1", [u]);
    const scenario: Scenario = {
      steps: [{ stderr: "ERROR: [generic] sub-unavailable-1: Video unavailable\n" }],
      exitCode: 1,
    };
    await expect(
      fetchProcessor(await h.deps(scenario), createCancelRegistry())(job(data)),
    ).rejects.toThrow();
    // Tried once: only a subtitle failure earns the second run.
    expect(await h.lastArgv()).toContain("--write-subs");
  });

  it("still succeeds with no subtitles and no chapters", async () => {
    const u = await user();
    const data = await queued("nosubs-1", [u]);
    await fetchProcessor(await h.deps(await downloadScenario()), createCancelRegistry())(job(data));
    expect((await states("nosubs-1"))[0]?.state).toBe("done");
  });
});
