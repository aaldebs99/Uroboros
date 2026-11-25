import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, type FakeRun, type Scenario } from "@uroboros/ytdlp/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { downloadScenario } from "../../test/fetchJobs.ts";
import { seedEntry, seedProfileless } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import type { PreviewJob } from "../downloads/queues.ts";
import { activeCooldown, noteRateLimit } from "../downloads/rateLimits.ts";
import { RequeueError } from "../jobs/errors.ts";
import { previewKey } from "../previews/queue.ts";
import { saveLogin } from "../siteLogins/store.ts";
import type { WorkerDeps } from "./deps.ts";
import { previewProcessor } from "./previewRun.ts";

/**
 * Hover previews downloaded from the video's site (`UROBOROS_PREVIEW_METHOD=download`, the
 * default; docs/library.md "Hover previews"), and when they are encoded from the stored file instead.
 */

let t: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let n = 0;

beforeAll(async () => {
  t = await TestDb.create();
  h = await workerHarness(t.db, 1);
});
afterAll(async () => {
  await h.close();
  await t.close();
});

/** Each test's own site, so one test's cooldown never holds another's. */
const pageOf = (i: number) => `https://pd${String(i)}.example/watch/clip`;

/** A media with a stored H.264 video, and the site page it came from (null: none). */
async function storedVideo(page: string | null) {
  const me = await signedIn(t.db, { username: `pd${String(++n)}` });
  const e = await seedEntry(t.db, me.userId);
  return withVideo(e, page);
}

async function withVideo(e: { mediaId: string; renditionId: string }, page: string | null) {
  const r = await t.db
    .updateTable("renditions")
    .set({ video_codec: "h264", width: 320, height: 240 })
    .where("id", "=", e.renditionId)
    .returning("storage_key")
    .executeTakeFirstOrThrow();
  await t.db.updateTable("media").set({ webpage_url: page }).where("id", "=", e.mediaId).execute();
  return { id: e.mediaId, renditionId: e.renditionId, storageKey: r.storage_key };
}

const job = (mediaId: string, attempts = 2, attemptsMade = 0) => ({
  id: `j-${mediaId}`,
  queue: "preview" as const,
  name: "preview",
  key: `preview:${mediaId}`,
  data: { mediaId } satisfies PreviewJob,
  attemptsMade,
  opts: { attempts },
  signal: new AbortController().signal,
});

const output = (mediaId: string) => join(h.workDir, `preview-${mediaId}`, "preview.mp4");
/** Where the copy from the site lands (the fake yt-dlp writes `clip.mp4` where it runs). */
const downloaded = (mediaId: string) => join(h.workDir, `preview-${mediaId}`, "site", "clip.mp4");
const writesClip = (mediaId: string): Scenario => ({
  steps: [{ writeFile: output(mediaId), content: "clip" }],
});

type Stream = Record<string, unknown>;

/** Sets the probed video stream's `fields`. */
const video =
  (fields: Stream) =>
  (s: Stream[]): void => {
    Object.assign(s[0] ?? {}, fields);
  };

/**
 * Deps whose yt-dlp replays `site` and whose transcoder runs `ffmpeg`, its ffprobe describing the
 * fixture clip (H.264 320x240 with AAC) in 8-bit 4:2:0, as browsers play it, then as `edit` leaves it.
 */
async function depsFor(site: Scenario, ffmpeg: Scenario, edit: (s: Stream[]) => void = () => {}) {
  const probe = JSON.parse(await fixture("ffprobe-clip.json")) as { streams: Stream[] };
  video({ pix_fmt: "yuv420p" })(probe.streams);
  edit(probe.streams);
  const session = await h.sessionDeps(ffmpeg, probe);
  const ffmpegRun = h.runs.at(-2) as FakeRun;
  const ytdlp = (await h.deps(site)).ytdlp;
  const ytdlpRun = h.runs.at(-1) as FakeRun;
  return { deps: { ...session, ytdlp } satisfies WorkerDeps, ffmpegRun, ytdlpRun };
}

/** The fake writes its arguments when started: a run that never started has none. */
const started = (run: FakeRun) =>
  run.argv().then(
    () => true,
    () => false,
  );

const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

const mediaOf = (id: string) =>
  t.db
    .selectFrom("media")
    .select(["preview_key", "preview_failed_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

describe("downloading a hover preview from the video's site", () => {
  it("asks the site for 480p and copies an H.264 copy as it is, encoding nothing", async () => {
    const v = await storedVideo(pageOf(1));
    const { deps, ffmpegRun, ytdlpRun } = await depsFor(await downloadScenario(), writesClip(v.id));
    await previewProcessor(deps).process(job(v.id));
    const site = await ytdlpRun.argv();
    expect(site).toContain(pageOf(1));
    expect(after(site, "--format")).toBe("bv*+ba/b");
    expect(site).toContain("--format-sort=res:480,vcodec:h264,acodec:aac");
    expect(site).toContain("--no-playlist");
    const args = await ffmpegRun.argv();
    expect(after(args, "-i")).toBe(downloaded(v.id));
    expect(after(args, "-c")).toBe("copy");
    expect(args).not.toContain("libx264");
    expect(await mediaOf(v.id)).toEqual({ preview_key: previewKey(v.id), preview_failed_at: null });
    expect(await readFile(join(h.root, previewKey(v.id)), "utf8")).toBe("clip");
  });

  it.each([
    ["in another codec", video({ codec_name: "vp9" })],
    ["bigger than 480p", video({ width: 1280, height: 720 })],
    ["over 2 Mbit/s", video({ bit_rate: "4000000" })],
    ["in 4:4:4 color, which browsers don't play", video({ pix_fmt: "yuv444p" })],
    ["in HDR", video({ color_transfer: "smpte2084" })],
    [
      "with sound other than AAC",
      (s: Stream[]) => Object.assign(s[1] ?? {}, { codec_name: "opus" }),
    ],
  ])("encodes a copy %s from the copy, not the stored file", async (_, edit) => {
    const v = await storedVideo(pageOf(2));
    const { deps, ffmpegRun } = await depsFor(await downloadScenario(), writesClip(v.id), edit);
    await previewProcessor(deps).process(job(v.id));
    const args = await ffmpegRun.argv();
    expect(after(args, "-i")).toBe(downloaded(v.id));
    expect(after(args, "-c:v")).toBe("libx264");
    expect((await mediaOf(v.id)).preview_key).toBe(previewKey(v.id));
  });

  it("encodes the stored file when the site has no copy to give", async () => {
    const v = await storedVideo(pageOf(3));
    const gone = { steps: [{ stderr: "ERROR: [generic] x: Video unavailable\n" }], exitCode: 1 };
    const { deps, ffmpegRun } = await depsFor(gone, writesClip(v.id));
    await previewProcessor(deps).process(job(v.id));
    const args = await ffmpegRun.argv();
    expect(after(args, "-i")).toBe(join(h.root, v.storageKey));
    expect(after(args, "-c:v")).toBe("libx264");
    expect((await mediaOf(v.id)).preview_key).toBe(previewKey(v.id));
  });

  it("waits out the site's rate limit, never marking the media failed", async () => {
    const v = await storedVideo(pageOf(4));
    const limited = {
      steps: [{ stderr: "ERROR: [generic] x: HTTP Error 429: Too Many Requests\n" }],
      exitCode: 1,
    };
    const { deps, ffmpegRun } = await depsFor(limited, writesClip(v.id));
    // Its last attempt: a failure now would mark the media for good.
    await expect(previewProcessor(deps).process(job(v.id, 2, 1))).rejects.toBeInstanceOf(
      RequeueError,
    );
    expect(await activeCooldown(t.db, "pd4.example", "site")).not.toBeNull();
    expect(await mediaOf(v.id)).toEqual({ preview_key: null, preview_failed_at: null });
    expect(await started(ffmpegRun)).toBe(false);
  });

  it("asks nothing of a site cooling down, and waits", async () => {
    const v = await storedVideo(pageOf(5));
    await noteRateLimit(t.db, "pd5.example", "site", 600_000);
    const { deps, ffmpegRun, ytdlpRun } = await depsFor(await downloadScenario(), writesClip(v.id));
    await expect(previewProcessor(deps).process(job(v.id))).rejects.toBeInstanceOf(RequeueError);
    expect(await started(ytdlpRun)).toBe(false);
    expect(await started(ffmpegRun)).toBe(false);
    expect((await mediaOf(v.id)).preview_failed_at).toBeNull();
  });

  it("signs in with the logins of the person who added the video first", async () => {
    const key = Buffer.alloc(32, 9);
    const [early, late] = [
      await signedIn(t.db, { username: `pd${String(++n)}` }),
      await signedIn(t.db, { username: `pd${String(++n)}` }),
    ];
    await saveLogin(t.db, key, early.userId, "vimeo", { username: "e", password: "early-pw" });
    await saveLogin(t.db, key, late.userId, "vimeo", { username: "l", password: "late-pw" });
    // The later one first, so the order they were stored in can't pass for the order they came.
    const e = await seedEntry(t.db, late.userId, { videoId: "pd-shared", addedAt: new Date() });
    await seedEntry(t.db, early.userId, {
      videoId: "pd-shared",
      addedAt: new Date(Date.now() - 3_600_000),
    });
    const v = await withVideo(e, pageOf(6));
    const { deps } = await depsFor(
      await downloadScenario([{ copyArgFile: "--netrc-location", name: ".netrc", as: "seen" }]),
      writesClip(v.id),
    );
    await previewProcessor({ ...deps, ytdlp: { ...deps.ytdlp, secretsKey: key } }).process(
      job(v.id),
    );
    expect(await h.lastCopied("seen")).toContain('login "e" password "early-pw"');
  });
});

describe("a hover preview encoded from the stored file instead", () => {
  async function encodedFromStore(v: { id: string; storageKey: string }, over = {}) {
    const { deps, ffmpegRun, ytdlpRun } = await depsFor(await downloadScenario(), writesClip(v.id));
    await previewProcessor({ ...deps, ...over }).process(job(v.id));
    expect(await started(ytdlpRun)).toBe(false);
    expect(after(await ffmpegRun.argv(), "-i")).toBe(join(h.root, v.storageKey));
    expect((await mediaOf(v.id)).preview_key).toBe(previewKey(v.id));
  }

  it("with UROBOROS_PREVIEW_METHOD=transcode", async () => {
    await encodedFromStore(await storedVideo(pageOf(7)), { previewMethod: "transcode" });
  });

  it("for a media with no page on a site", async () => {
    await encodedFromStore(await storedVideo(null));
  });

  it("for an upload", async () => {
    const me = await signedIn(t.db, { username: `pd${String(++n)}` });
    const up = await seedProfileless(t.db, me.userId, { uploadedBy: me.userId });
    await encodedFromStore(await withVideo(up, pageOf(8)));
  });

  it("for a file cut from the video, so the preview shows what the library holds", async () => {
    const v = await storedVideo(pageOf(9));
    const me = await signedIn(t.db, { username: `pd${String(++n)}` });
    const cut = await t.db
      .insertInto("format_profiles")
      .values({
        user_id: me.userId,
        name: "First minute",
        format: "b",
        extra_args: ["--download-sections=*0:00-1:00"],
        revision: "r1",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await t.db
      .updateTable("renditions")
      .set({ profile_id: cut.id })
      .where("id", "=", v.renditionId)
      .execute();
    await encodedFromStore(v);
  });
});

describe("hover previews turned off", () => {
  it("leaves a preview queued before neither downloaded nor made", async () => {
    const v = await storedVideo(pageOf(10));
    const { deps, ffmpegRun, ytdlpRun } = await depsFor(await downloadScenario(), writesClip(v.id));
    await previewProcessor({ ...deps, generatePreviews: false }).process(job(v.id));
    expect(await started(ytdlpRun)).toBe(false);
    expect(await started(ffmpegRun)).toBe(false);
    expect(await mediaOf(v.id)).toEqual({ preview_key: null, preview_failed_at: null });
  });
});
