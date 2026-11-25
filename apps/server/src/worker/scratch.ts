import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";

/**
 * Scratch space for jobs (docs/downloads.md "Scratch space"). The work dir may be shared by every
 * replica (filesystem storage keeps it in the library) and outlive a restart, so each run gets a
 * folder of its own, touched while it runs, and a folder nobody touched for an hour is a dead
 * replica's to sweep.
 */

/** How often an open run touches its folder. */
export const SCRATCH_TOUCH_EVERY_MS = 300_000;
/** A run folder untouched this long belongs to no live run. */
export const SCRATCH_STALE_MS = 3_600_000;
/** How often each replica sweeps the work dir. */
export const SCRATCH_SWEEP_EVERY_MS = 900_000;

/** A run folder's name: the run's label, a dot and 12 random hex digits. */
const RUN = /\.[0-9a-f]{12}$/;

export interface Scratch {
  /** The run's own folder, created empty. */
  dir: string;
  /** Stops touching the folder and removes it with everything in it; again is fine. */
  dispose(): Promise<void>;
}

/** A folder of its own for one run of a job, `<workDir>/<label>.<12 hex>`. */
export async function openScratch(workDir: string, label: string): Promise<Scratch> {
  const dir = join(workDir, `${label}.${randomBytes(6).toString("hex")}`);
  await mkdir(dir, { recursive: true });
  const touch = setInterval(() => {
    const now = new Date();
    utimes(dir, now, now).catch(() => undefined);
  }, SCRATCH_TOUCH_EVERY_MS);
  touch.unref();
  return {
    dir,
    async dispose() {
      clearInterval(touch);
      await rm(dir, { recursive: true, force: true, maxRetries: 2 });
    },
  };
}

/** Removes the run folders in `workDir` untouched for `SCRATCH_STALE_MS`; returns their paths. */
export async function sweepScratch(workDir: string, logger: Logger): Promise<string[]> {
  const entries = await readdir(workDir, { withFileTypes: true }).catch((err: unknown) => {
    if ((err as { code?: string }).code === "ENOENT") return [];
    throw err;
  });
  const removed: string[] = [];
  const cutoff = Date.now() - SCRATCH_STALE_MS;
  for (const entry of entries) {
    if (!entry.isDirectory() || !RUN.test(entry.name)) continue;
    const path = join(workDir, entry.name);
    try {
      // Another replica's sweep may have taken it already: `force` makes that fine.
      const touched = await stat(path).then(
        (s) => s.mtimeMs,
        () => null,
      );
      if (touched === null || touched > cutoff) continue;
      await rm(path, { recursive: true, force: true, maxRetries: 2 });
      removed.push(path);
    } catch (err) {
      logger.warn({ err, path }, "could not sweep a stale scratch folder");
    }
  }
  if (removed.length > 0) logger.info({ removed }, "swept stale scratch folders");
  return removed;
}
