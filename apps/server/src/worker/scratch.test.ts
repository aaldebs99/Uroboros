import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openScratch, SCRATCH_STALE_MS, SCRATCH_TOUCH_EVERY_MS, sweepScratch } from "./scratch.ts";

/** Scratch space for jobs (docs/downloads.md "Scratch space"). */

const logger = pino({ level: "silent" });
let workDir: string;

beforeEach(async () => {
  workDir = join(await mkdtemp(join(tmpdir(), "uroboros-scratch-")), "work");
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(join(workDir, ".."), { recursive: true, force: true });
});

/** A folder in the work dir last touched `agoMs` ago. */
async function folder(name: string, agoMs: number): Promise<string> {
  const path = join(workDir, name);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "clip.mp4.part"), "partial");
  const then = new Date(Date.now() - agoMs);
  await utimes(path, then, then);
  return path;
}

describe("openScratch", () => {
  it("gives every run a folder of its own, even two runs with one label", async () => {
    const one = await openScratch(workDir, "fetch%7Cyoutube%7Cabc");
    const two = await openScratch(workDir, "fetch%7Cyoutube%7Cabc");
    expect(one.dir).not.toBe(two.dir);
    expect(one.dir).toMatch(/\/work\/fetch%7Cyoutube%7Cabc\.[0-9a-f]{12}$/);
    expect(existsSync(one.dir) && existsSync(two.dir)).toBe(true);
    await one.dispose();
    expect(existsSync(two.dir)).toBe(true);
    await two.dispose();
  });

  it("removes the folder and what the run wrote in it, once or twice", async () => {
    const run = await openScratch(workDir, "export-1");
    await writeFile(join(run.dir, "out.mp4"), "copy");
    await run.dispose();
    expect(existsSync(run.dir)).toBe(false);
    await expect(run.dispose()).resolves.toBeUndefined();
  });

  it("keeps an open run's folder fresh, so no sweep takes it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const run = await openScratch(workDir, "fetch-long");
    const old = new Date(Date.now() - 2 * SCRATCH_STALE_MS);
    await utimes(run.dir, old, old);
    await vi.advanceTimersByTimeAsync(SCRATCH_TOUCH_EVERY_MS);
    await vi.waitFor(async () => {
      expect((await stat(run.dir)).mtimeMs).toBeGreaterThan(Date.now() - SCRATCH_STALE_MS);
    });
    expect(await sweepScratch(workDir, logger)).toEqual([]);
    await run.dispose();
  });
});

describe("sweepScratch", () => {
  it("removes run folders untouched for an hour, and leaves everything else", async () => {
    const stale = await folder("fetch-dead.0123456789ab", SCRATCH_STALE_MS + 60_000);
    const fresh = await folder("fetch-live.ba9876543210", 60_000);
    const other = await folder("not-a-run", 2 * SCRATCH_STALE_MS);
    expect(await sweepScratch(workDir, logger)).toEqual([stale]);
    expect(await readdir(workDir)).toEqual(
      expect.arrayContaining(["fetch-live.ba9876543210", "not-a-run"]),
    );
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh) && existsSync(other)).toBe(true);
  });

  it("leaves a stale file named like a run alone: runs are folders", async () => {
    await mkdir(workDir, { recursive: true });
    const file = join(workDir, "odd.0123456789ab");
    await writeFile(file, "not ours");
    const then = new Date(Date.now() - 2 * SCRATCH_STALE_MS);
    await utimes(file, then, then);
    expect(await sweepScratch(workDir, logger)).toEqual([]);
    expect(existsSync(file)).toBe(true);
  });

  it("is fine with no work dir yet", async () => {
    expect(await sweepScratch(join(workDir, "never"), logger)).toEqual([]);
  });
});
