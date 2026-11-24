import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DelayedError } from "bullmq";
import type { Scenario } from "@uroboros/ytdlp/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fmp4Stream } from "../../test/fmp4.ts";
import { seedEntry } from "../../test/library.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { forgetSession, isStored, nextRunToken, touchAlive } from "../transcode/bus.ts";
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

const keys = () => ({ valkey: h.ctx.valkey, prefix: h.prefix });

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

function start(deps: WorkerDeps, sid: string, shutdown = new AbortController()) {
  const moveToDelayed = vi.fn(() => Promise.resolve());
  const job = { id: `playback|${sid}`, data: { sessionId: sid }, moveToDelayed };
  const done = sessionProcessor(deps, shutdown.signal, FAST)(job as never, "lock-token");
  return { done, moveToDelayed, shutdown };
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
    await expect(run.done).rejects.toBeInstanceOf(DelayedError);
    expect(run.moveToDelayed).toHaveBeenCalledOnce();
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
});
