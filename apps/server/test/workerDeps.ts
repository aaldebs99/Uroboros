import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeRun, fixture, type Scenario } from "@uroboros/ytdlp/testing";
import type { Kysely } from "kysely";
import type { Database } from "../src/db/schema.ts";
import { DEFAULT_LAYOUT, type StorageConfig } from "../src/storage/config.ts";
import { createStore } from "../src/storage/index.ts";
import { disabledPush } from "../src/push/service.ts";
import type { WorkerDeps } from "../src/worker/deps.ts";
import { downloadHarness } from "./downloads.ts";

/** Worker deps on a filesystem store, with fake yt-dlp and ffprobe runs the test scripts. */
export async function workerHarness(db: Kysely<Database>, limit = 3) {
  const h = await downloadHarness(db, limit);
  const root = await mkdtemp(join(tmpdir(), "uroboros-media-"));
  const workDir = await mkdtemp(join(tmpdir(), "uroboros-work-"));
  const storage: StorageConfig = { kind: "filesystem", root, layout: DEFAULT_LAYOUT };
  const runs: FakeRun[] = [];
  const ffprobeRun = await FakeRun.create({
    steps: [{ stdout: await fixture("ffprobe-clip.json") }],
  });
  runs.push(ffprobeRun);
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
          jsRuntime: "/usr/local/bin/node",
        },
        ffprobe: { binary: ffprobeRun.options.binary, env: ffprobeRun.options.env },
        subtitles: { langs: "en.*", automatic: false },
        push: disabledPush,
        ffmpeg: { binary: "ffmpeg" },
        transcodeConcurrency: 1,
      };
    },
    /**
     * Deps for a transcode: ffmpeg replays `ffmpeg` (writing files into its working directory) and
     * ffprobe answers `probe` (ffprobe's JSON) for any file.
     */
    async transcodeDeps(ffmpeg: Scenario, probe: unknown): Promise<WorkerDeps> {
      const base = await this.deps({ steps: [] });
      // ffmpeg's run is second to last in `runs`, ffprobe's last.
      const ffmpegRun = await FakeRun.create(ffmpeg);
      const probeRun = await FakeRun.create({ steps: [{ stdout: JSON.stringify(probe) }] });
      runs.push(ffmpegRun, probeRun);
      return {
        ...base,
        ffmpeg: { binary: ffmpegRun.options.binary, env: ffmpegRun.options.env },
        ffprobe: { binary: probeRun.options.binary, env: probeRun.options.env },
      };
    },
    /** Every fake started so far, in order. */
    runs,
    async close(): Promise<void> {
      await Promise.all(runs.map((r) => r.close()));
      await h.close();
    },
  };
}
