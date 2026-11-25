import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { downloadScenario, fetchJob, queuedFetch } from "../../test/fetchJobs.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import type { MediaStore } from "../storage/store.ts";
import { createCancelRegistry, fetchProcessor } from "./fetch.ts";

/** Where a fetch downloads, and how its file reaches the library (docs/downloads.md "Scratch space"). */

let testDb: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await workerHarness(testDb.db, 1);
});
afterAll(async () => {
  await h.close();
  await testDb.close();
});

describe("a fetch's scratch space", () => {
  it("moves yt-dlp's own files into the library, never copying them", async () => {
    const data = await queuedFetch(testDb.db, "mv-1", [
      await signedIn(testDb.db, { username: "fsmover" }),
    ]);
    const deps = await h.deps(await downloadScenario());
    // The inode of each file as the fetch hands it over: a rename keeps it, a copy does not.
    const handed = new Map<string, number>();
    const store: MediaStore = {
      ...deps.store,
      async move(key, file, contentType) {
        handed.set(key, (await stat(file)).ino);
        return deps.store.move(key, file, contentType);
      },
    };
    await fetchProcessor({ ...deps, store }, createCancelRegistry())(fetchJob(data));

    const r = await testDb.db
      .selectFrom("renditions as r")
      .innerJoin("media as m", "m.id", "r.media_id")
      .select(["r.storage_key", "m.thumbnail_key", "m.info_key"])
      .where("m.video_id", "=", "mv-1")
      .executeTakeFirstOrThrow();
    for (const key of [r.storage_key, r.thumbnail_key, r.info_key]) {
      expect(key).not.toBeNull();
      expect((await stat(join(h.root, key ?? ""))).ino).toBe(handed.get(key ?? ""));
    }
    // The keyframes, the fetch's last probe, are read from where the file is now.
    const keyframeProbe = await (h.runs[0]?.argv() ?? Promise.resolve([]));
    expect(keyframeProbe).toContain("packet=pts_time,flags");
    expect(keyframeProbe).toContain(join(h.root, r.storage_key));
  });

  it("downloads in a folder of its own run, so a second run never clears the first's", async () => {
    const data = await queuedFetch(testDb.db, "mv-2", [
      await signedIn(testDb.db, { username: "fsrunner" }),
    ]);
    await fetchProcessor(
      await h.deps(await downloadScenario()),
      createCancelRegistry(),
    )(fetchJob(data));
    const argv = await h.lastArgv();
    const dir = argv[argv.indexOf("--paths") + 1];
    const prefix = join(h.workDir, encodeURIComponent(data.fetchKey));
    expect(dir?.slice(0, prefix.length)).toBe(prefix);
    expect(dir?.slice(prefix.length)).toMatch(/^\.[0-9a-f]{12}$/);
    expect(await readdir(h.workDir)).toEqual([]);
  });
});
