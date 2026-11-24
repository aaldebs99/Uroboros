import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeRun, fixture, type Scenario } from "@uroboros/ytdlp/testing";
import type { Kysely } from "kysely";
import type { Database } from "../src/db/schema.ts";
import { DEFAULT_LAYOUT, type StorageConfig } from "../src/storage/config.ts";
import { createStore } from "../src/storage/index.ts";
import { disabledPush } from "../src/push/service.ts";
import { createPlaybackBus } from "../src/transcode/bus.ts";
import { PipelineMemo } from "../src/transcode/hwaccel.ts";
import { busFor } from "./bus.ts";
import { pino } from "pino";
import type { WorkerDeps } from "../src/worker/deps.ts";
import { downloadHarness } from "./downloads.ts";

/** What the fake ffprobe prints for a keyframe probe: keyframes at 0 and 2 s. */
export const KEYFRAME_PACKETS = "0.000000,K__\n1.000000,___\n2.000000,K__\n";

/** Worker deps on a filesystem store, with fake yt-dlp and ffprobe runs the test scripts. */
export async function workerHarness(db: Kysely<Database>, limit = 3) {
  const h = await downloadHarness(db, limit);
  const root = await mkdtemp(join(tmpdir(), "uroboros-media-"));
  const workDir = await mkdtemp(join(tmpdir(), "uroboros-work-"));
  const storage: StorageConfig = { kind: "filesystem", root, layout: DEFAULT_LAYOUT };
  const runs: FakeRun[] = [];
  const ffprobeRun = await FakeRun.create({
    steps: [{ stdout: await fixture("ffprobe-clip.json") }],
    // The keyframe index the fetch consumer reads from the packets (keyframes every 2 s).
    variants: [{ whenArg: "packet=pts_time,flags", steps: [{ stdout: KEYFRAME_PACKETS }] }],
  });
  runs.push(ffprobeRun);
  const pg = await busFor(db);
  const playbackBus = createPlaybackBus(pg, db, pino({ level: "silent" }));
  await playbackBus.ready;
  return {
    ...h,
    root,
    workDir,
    /** Deps whose yt-dlp replays `scenario`. */
    /** The arguments the most recent fake yt-dlp was started with. */
    async lastArgv(): Promise<string[]> {
      const run = runs.at(-1);
      return run === undefined ? [] : run.argv();
    },
    /** A file the most recent fake yt-dlp saved with a `copyArgFile` step (null: none). */
    async lastCopied(name: string): Promise<string | null> {
      const run = runs.at(-1);
      return run === undefined ? null : run.copied(name);
    },
    async deps(scenario: Scenario): Promise<WorkerDeps> {
      const run = await FakeRun.create(scenario);
      runs.push(run);
      return {
        ...h.ctx,
        store: createStore(storage),
        storage,
        workDir,
        ytdlp: {
          binary: run.options.binary,
          env: run.options.env,
          cookiesFile: null,
          secretsKey: null,
          jsRuntime: "/usr/local/bin/node",
        },
        ffprobe: { binary: ffprobeRun.options.binary, env: ffprobeRun.options.env },
        subtitles: { langs: "en.*", automatic: false },
        push: disabledPush,
        transcodeConcurrency: 1,
        playbackBus,
        transcoder: {
          ffmpeg: { binary: "ffmpeg" },
          ffprobe: { binary: ffprobeRun.options.binary, env: ffprobeRun.options.env },
          hwaccel: "none",
          vaapiDevice: "/dev/dri/renderD128",
          gpuWorks: true,
          memo: new PipelineMemo(),
        },
      };
    },
    playbackBus,
    /**
     * Deps for a playback session: the transcoder's ffmpeg replays `ffmpeg` (variants by argument,
     * e.g. a run's `-ss` value) and its ffprobe answers `probe` (ffprobe's JSON; a keyframe probe
     * gets `keyframes`, packet lines).
     */
    async sessionDeps(
      ffmpeg: Scenario,
      probe: unknown,
      transcoder: Partial<WorkerDeps["transcoder"]> = {},
      keyframes = "",
    ): Promise<WorkerDeps> {
      const base = await this.deps({ steps: [] });
      const ffmpegRun = await FakeRun.create(ffmpeg);
      const probeRun = await FakeRun.create({
        steps: [{ stdout: JSON.stringify(probe) }],
        variants: [{ whenArg: "packet=pts_time,flags", steps: [{ stdout: keyframes }] }],
      });
      runs.push(ffmpegRun, probeRun);
      return {
        ...base,
        transcoder: {
          ...base.transcoder,
          ffmpeg: { binary: ffmpegRun.options.binary, env: ffmpegRun.options.env },
          ffprobe: { binary: probeRun.options.binary, env: probeRun.options.env },
          ...transcoder,
        },
      };
    },
    /** Every fake started so far, in order. */
    runs,
    async close(): Promise<void> {
      playbackBus.close();
      await pg.close();
      await Promise.all(runs.map((r) => r.close()));
      await h.close();
    },
  };
}
