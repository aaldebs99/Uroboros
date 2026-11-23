import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeRun, fixture, type Scenario } from "@uroboros/ytdlp/testing";
import type { Kysely } from "kysely";
import type { Database } from "../src/db/schema.ts";
import { DEFAULT_LAYOUT, type StorageConfig } from "../src/storage/config.ts";
import { createStore } from "../src/storage/index.ts";
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
    async deps(scenario: Scenario): Promise<WorkerDeps> {
      const run = await FakeRun.create(scenario);
      runs.push(run);
      return {
        ...h.ctx,
        store: createStore(storage),
        storage,
        workDir,
        ytdlp: { binary: run.options.binary, env: run.options.env, cookiesFile: null },
        ffprobe: { binary: ffprobeRun.options.binary, env: ffprobeRun.options.env },
      };
    },
    async close(): Promise<void> {
      await Promise.all(runs.map((r) => r.close()));
      await h.close();
    },
  };
}
