import { mkdtemp, writeFile } from "node:fs/promises";
import { RequeueError } from "../jobs/errors.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scenario } from "@uroboros/ytdlp/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fmp4Stream } from "../../test/fmp4.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { forgetSession, isStored, markStored, nextRunToken, touchAlive } from "../transcode/bus.ts";
import {
  insertSession,
  segmentKey,
  sessionPrefix,
  type StoredPlan,
} from "../transcode/sessions.ts";
import { uniformBoundaries } from "../transcode/timeline.ts";
import type { WorkerDeps } from "./deps.ts";
import { sessionProcessor, type SessionTimings } from "./session.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let entry: { entryId: string; renditionId: string };
let userId: string;

const probe = {
  streams: [
    {
      index: 0,
      codec_type: "video",
      codec_name: "h264",
      profile: "High",
      pix_fmt: "yuv420p",
      width: 1920,
      height: 1080,
    },
    { index: 1, codec_type: "audio", codec_name: "aac" },
  ],
  format: { format_name: "matroska,webm", duration: "20.000000" },
};
const FAST: Partial<SessionTimings> = { aliveCheckMs: 40, debounceMs: 10 };
const encode: StoredPlan = {
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
const UNIFORM = [0, 6, 12, 18, 20];
const stream = (times: number[]) => ({ stdoutBase64: fmp4Stream(times).toString("base64") });

beforeAll(async () => {
  t = await TestDb.create();
  h = await workerHarness(t.db);
  userId = await insertUser(t.db, { username: "viewer" });
  entry = await seedEntry(t.db, userId, { storageKey: "film.mkv" });
  const src = join(await mkdtemp(join(tmpdir(), "uroboros-film-")), "film.mkv");
  await writeFile(src, "not really a film");
  await (await h.deps({ steps: [] })).store.put("film.mkv", src, "video/x-matroska");
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const keys = () => ({ db: h.ctx.db });

async function newSession(plan: Partial<StoredPlan> = {}, boundaries: number[] | null = UNIFORM) {
  const row = await insertSession(t.db, {
    renditionId: entry.renditionId,
    entryId: entry.entryId,
    viewer: { userId },
    plan: { ...encode, ...plan },
    boundaries,
  });
  await touchAlive(keys(), row.id);
  return row.id;
}

function start(
  deps: WorkerDeps,
  sid: string,
  shutdown = new AbortController(),
  timings: Partial<SessionTimings> = {},
) {
  const done = sessionProcessor(deps, shutdown.signal, { ...FAST, ...timings })({
    data: { sessionId: sid },
  });
  return { done, shutdown };
}

/** ffmpeg's output for these keyframe times, one fragment per write, a little apart. */
function trickle(times: number[]) {
  return times.flatMap((t, i) => {
    const before = i === 0 ? 0 : fmp4Stream(times.slice(0, i)).length;
    const bytes = fmp4Stream(times.slice(0, i + 1)).subarray(before);
    return [{ stdoutBase64: bytes.toString("base64") }, { sleepMs: 30 }];
  });
}

async function until(check: () => Promise<boolean>, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const row = (sid: string) =>
  t.db.selectFrom("playback_sessions").selectAll().where("id", "=", sid).executeTakeFirstOrThrow();
const stored = (sid: string, n: number) => isStored(keys(), sid, n);
const leave = (sid: string) => forgetSession(keys(), sid);
const deps = (
  ffmpeg: Scenario,
  transcoder: Partial<WorkerDeps["transcoder"]> = {},
  keyframes = "",
) => h.sessionDeps(ffmpeg, probe, transcoder, keyframes);

describe("a playback session's runner", () => {
  it("runs from the start, storing the init and every segment, and cleans up when the viewer goes", async () => {
    const d = await deps({ steps: [stream([0, 6, 12, 18])] });
    const sid = await newSession();
    const { done } = start(d, sid);
    await until(async () => stored(sid, 3));
    expect(await stored(sid, -1)).toBe(true);
    expect(await row(sid)).toMatchObject({ state: "running", encoder: "libx264" });
    expect(await d.store.stat(segmentKey(sid, 2))).not.toBeNull();
    await leave(sid);
    await done;
    expect((await row(sid)).state).toBe("stopped");
    expect(await d.store.stat(segmentKey(sid, 2))).toBeNull();
    expect(await stored(sid, 3)).toBe(false);
  });

  it("starts at the segment holding where the viewer is", async () => {
    const d = await deps({
      steps: [],
      variants: [{ whenArg: "12.0000", steps: [stream([12, 18])] }],
    });
    const sid = await newSession({ start: 13 });
    const { done } = start(d, sid);
    await until(async () => stored(sid, 3));
    expect(await stored(sid, 2)).toBe(true);
    expect(await stored(sid, 0)).toBe(false);
    await leave(sid);
    await done;
  });

  it("restarts at a segment the player asks for far ahead", async () => {
    const d = await deps({
      steps: [stream([0, 6]), { hang: true }],
      variants: [{ whenArg: "48.0000", steps: [stream([48, 54])] }],
    });
    const sid = await newSession({}, uniformBoundaries(60));
    const { done } = start(d, sid);
    await until(async () => stored(sid, 0));
    await d.playbackBus.publish({ t: "want", sid, n: 8 });
    await until(async () => stored(sid, 9));
    expect(await stored(sid, 1)).toBe(false);
    await leave(sid);
    await done;
  });

  it("falls back to GPU encoding after a CPU decode when the whole-GPU pipeline fails at once", async () => {
    const d = await deps(
      {
        steps: [stream([0, 6, 12, 18])],
        variants: [
          {
            whenArg: "-hwaccel",
            steps: [{ stderr: "[vaapi @ 0x1] decode failed\n" }],
            exitCode: 1,
          },
        ],
      },
      { hwaccel: "vaapi" },
    );
    const sid = await newSession();
    const { done } = start(d, sid);
    await until(async () => stored(sid, 3));
    expect((await row(sid)).encoder).toBe("vaapi");
    expect(d.transcoder.memo.failed("vaapi", "h264/yuv420p")).toBe(true);
    await leave(sid);
    await done;
  });

  it("fails the session with ffmpeg's reason when even the CPU can't, and tells waiting requests", async () => {
    const d = await deps({
      steps: [{ stderr: "[libx264 @ 0x1] cannot open encoder\nConversion failed!\n" }],
      exitCode: 1,
    });
    const sid = await newSession();
    const stops: string[] = [];
    const off = d.playbackBus.on((m) => {
      if (m.t === "stop") stops.push(m.sid);
    });
    await start(d, sid).done;
    off();
    expect(await row(sid)).toMatchObject({
      state: "failed",
      error_message: "libx264: cannot open encoder",
    });
    expect(stops).toContain(sid);
  });

  it("goes back to the queue, unrecorded, when the replica shuts down", async () => {
    const d = await deps({ steps: [stream([0]), { hang: true }] });
    const sid = await newSession();
    const run = start(d, sid);
    await until(async () => stored(sid, -1));
    run.shutdown.abort();
    // Back to the queue without spending an attempt.
    await expect(run.done).rejects.toBeInstanceOf(RequeueError);
    expect((await row(sid)).state).toBe("queued");
    await leave(sid);
  });

  it("stops writing when another runner has taken the session over", async () => {
    const tail = fmp4Stream([0, 6, 12]).subarray(fmp4Stream([0, 6]).length);
    const d = await deps({
      steps: [
        stream([0, 6]),
        { sleepMs: 400 },
        { stdoutBase64: tail.toString("base64") },
        { hang: true },
      ],
    });
    const sid = await newSession();
    const { done } = start(d, sid);
    await until(async () => stored(sid, 0));
    await nextRunToken(keys(), sid);
    await done;
    expect(await stored(sid, 1)).toBe(false);
    // The new runner owns the files now: the old one leaves them.
    expect(await d.store.stat(segmentKey(sid, 0))).not.toBeNull();
    await d.store.deletePrefix(sessionPrefix(sid));
    await leave(sid);
  });

  it("indexes a remux's keyframes when the session has no boundaries yet", async () => {
    const d = await deps(
      { steps: [stream([0, 7, 14])] },
      {},
      "0.000000,K__\n7.000000,K__\n14.000000,K__\n",
    );
    const sid = await newSession(
      { mode: "remux", bitrate: null, level: null, audio: "copy", boundaries: "keyframes" },
      null,
    );
    const { done } = start(d, sid);
    await until(async () => stored(sid, 2));
    expect((await row(sid)).boundaries).toEqual([0, 7, 14, 20]);
    expect((await row(sid)).encoder).toBe("copy");
    await leave(sid);
    await done;
  });

  it("stops at once when told to", async () => {
    const d = await deps({ steps: [stream([0]), { hang: true }] });
    const sid = await newSession();
    const { done } = start(d, sid);
    await until(async () => stored(sid, -1));
    await d.playbackBus.publish({ t: "stop", sid });
    await done;
    expect((await row(sid)).state).toBe("stopped");
    expect(await d.store.stat(`${sessionPrefix(sid)}init.mp4`)).toBeNull();
  });

  it("acts on the last of quick wants only (a scrub settles first)", async () => {
    const d = await deps({
      steps: [stream([0]), { hang: true }],
      variants: [
        { whenArg: "48.0000", steps: [stream([48])] },
        { whenArg: "54.0000", steps: [stream([54])] },
      ],
    });
    const sid = await newSession({}, uniformBoundaries(60));
    const { done } = start(d, sid, undefined, { debounceMs: 150 });
    await until(async () => stored(sid, -1));
    await d.playbackBus.publish({ t: "want", sid, n: 8 });
    await d.playbackBus.publish({ t: "want", sid, n: 9 });
    await until(async () => stored(sid, 9));
    expect(await stored(sid, 8)).toBe(false);
    await leave(sid);
    await done;
  });

  it("jumps past segments already stored, to the next one nobody made", async () => {
    const d = await deps({
      steps: [stream([0, 6, 12, 18, 24, 30]), { hang: true }],
      variants: [{ whenArg: "24.0000", steps: [stream([24, 30, 36])] }],
    });
    const sid = await newSession({}, uniformBoundaries(60));
    for (const n of [1, 2, 3]) await markStored(keys(), sid, n);
    const { done } = start(d, sid, undefined, { skipStored: 3 });
    await until(async () => stored(sid, 6));
    expect(await stored(sid, 4)).toBe(true);
    await leave(sid);
    await done;
  });

  it("pauses far ahead of the player and reads on as it catches up", async () => {
    const d = await deps({ steps: trickle([0, 6, 12, 18, 24, 30, 36, 42, 48, 54]) });
    const sid = await newSession({}, uniformBoundaries(60));
    const { done } = start(d, sid, undefined, { throttleAhead: 2, resumeAhead: 1 });
    await until(async () => stored(sid, 2));
    await new Promise((r) => setTimeout(r, 400));
    expect(await stored(sid, 3)).toBe(false);
    await d.playbackBus.publish({ t: "want", sid, n: 2 });
    // Reading on (what ffmpeg wrote meanwhile may arrive at once, so no second pause is checked).
    await until(async () => stored(sid, 4));
    await leave(sid);
    await done;
  });

  it("starts a run for a segment asked for after the end was made", async () => {
    const d = await deps({
      steps: [stream([0, 6])],
      variants: [{ whenArg: "12.0000", steps: [stream([12, 18])] }],
    });
    const sid = await newSession({ start: 13 });
    const { done } = start(d, sid);
    await until(async () => stored(sid, 3));
    await d.playbackBus.publish({ t: "want", sid, n: 0 });
    await until(async () => stored(sid, 0));
    await leave(sid);
    await done;
  });

  it("goes on from the next segment it didn't make when a run fails mid-way", async () => {
    const d = await deps({
      steps: [stream([0, 6]), { stderr: "[matroska @ 0x1] Read error\n" }],
      exitCode: 1,
      variants: [{ whenArg: "6.0000", steps: [stream([6, 12, 18])], exitCode: 0 }],
    });
    const sid = await newSession();
    const { done } = start(d, sid);
    await until(async () => stored(sid, 3));
    expect((await row(sid)).state).toBe("running");
    await leave(sid);
    await done;
  });

  it("remembers a GPU failure only once a pipeline below it works on that source", async () => {
    const d = await deps(
      { steps: [{ stderr: "[matroska @ 0x1] Invalid data found\n" }], exitCode: 1 },
      { hwaccel: "vaapi" },
    );
    const sid = await newSession();
    await start(d, sid).done;
    expect((await row(sid)).state).toBe("failed");
    // The CPU failed too: the file was at fault, not the GPU.
    expect(d.transcoder.memo.failed("vaapi", "h264/yuv420p")).toBe(false);
    expect(d.transcoder.memo.failed("vaapi-sw", "h264/yuv420p")).toBe(false);
  });

  it("asks the store for a fresh read URL for every run (a presigned S3 URL expires)", async () => {
    const d = await deps({
      steps: [stream([0, 6]), { hang: true }],
      variants: [{ whenArg: "48.0000", steps: [stream([48])] }],
    });
    let n = 0;
    const readUrl = vi.fn(() =>
      Promise.resolve(`http://media.invalid/film.mkv?run=${String(++n)}`),
    );
    const s3: WorkerDeps = { ...d, store: { ...d.store, localPath: () => null, readUrl } };
    const sid = await newSession({}, uniformBoundaries(60));
    const { done } = start(s3, sid);
    await until(async () => stored(sid, 0));
    await d.playbackBus.publish({ t: "want", sid, n: 8 });
    await until(async () => stored(sid, 8));
    expect(readUrl.mock.calls.length).toBeGreaterThanOrEqual(3);
    const ffmpeg = h.runs.at(-2);
    expect(await ffmpeg?.argv()).toContain(`http://media.invalid/film.mkv?run=${String(n)}`);
    await leave(sid);
    await done;
  });

  it("rides out database errors in its checks without crashing or giving up", async () => {
    const d = await deps({ steps: [stream([0]), { hang: true }] });
    let broken = false;
    // Its checks (is the viewer there, is a segment stored) read with the query builder.
    const db = new Proxy(d.db, {
      get(target, prop, receiver) {
        if (broken && prop === "selectFrom") {
          return () => {
            throw new Error("database down");
          };
        }
        const v = Reflect.get(target, prop, receiver) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const flaky: WorkerDeps = { ...d, db };
    const sid = await newSession();
    const { done } = start(flaky, sid);
    await until(async () => stored(sid, -1));
    broken = true;
    await d.playbackBus.publish({ t: "want", sid, n: 3 });
    await new Promise((r) => setTimeout(r, 300));
    broken = false;
    expect((await row(sid)).state).toBe("running");
    await d.playbackBus.publish({ t: "stop", sid });
    await done;
  });
});
