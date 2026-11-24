import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { MediaStore } from "./store.ts";

function isNotFound(err: unknown): boolean {
  return (err as { code?: string }).code === "ENOENT";
}

/** Removes `dir` and its parents while they are empty, stopping at `base` (never removed). */
async function pruneEmpty(base: string, dir: string): Promise<void> {
  for (let d = dir; d.startsWith(base + sep); d = dirname(d)) {
    try {
      await rmdir(d);
    } catch (err) {
      if (!isNotFound(err)) return; // not empty (or not ours to remove): stop here
    }
  }
}

/** Organized folders under `root`; keys are relative paths, written atomically (temp + rename). */
export function createFilesystemStore(root: string): MediaStore {
  const base = resolve(root);
  const pathOf = (key: string) => {
    const path = resolve(base, key);
    if (!path.startsWith(base + sep)) throw new Error(`storage key escapes the root: ${key}`);
    return path;
  };
  /** Writes `target` atomically: into a temp file beside it, then a rename. */
  const atomically = async (target: string, write: (temp: string) => Promise<void>) => {
    await mkdir(dirname(target), { recursive: true });
    const temp = join(
      dirname(target),
      `.${basename(target)}.${randomBytes(6).toString("hex")}.tmp`,
    );
    try {
      await write(temp);
      await rename(temp, target);
    } catch (err) {
      await rm(temp, { force: true });
      throw err;
    }
  };
  return {
    async put(key, file) {
      const target = pathOf(key);
      await atomically(target, (temp) => copyFile(file, temp));
      return { size: (await stat(target)).size };
    },
    async putBytes(key, bytes) {
      await atomically(pathOf(key), (temp) => writeFile(temp, bytes));
    },
    async open(key, range) {
      const path = pathOf(key);
      const { size } = await stat(path);
      const stream = createReadStream(
        path,
        range === undefined
          ? {}
          : { start: range.start, ...(range.end === undefined ? {} : { end: range.end }) },
      );
      return {
        body: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
        size,
        contentType: null,
      };
    },
    async stat(key) {
      try {
        return { size: (await stat(pathOf(key))).size };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async delete(key) {
      const path = pathOf(key);
      await rm(path, { force: true });
      // A layout folder (`<channel>/<date> <title> [<id>]`) emptied by the delete goes too.
      await pruneEmpty(base, dirname(path));
    },
    downloadUrl() {
      return Promise.resolve(null);
    },
    async deletePrefix(prefix) {
      const dir = pathOf(prefix.replace(/\/+$/, ""));
      await rm(dir, { recursive: true, force: true });
      await pruneEmpty(base, dirname(dir));
    },
    localPath(key) {
      return pathOf(key);
    },
    readUrl() {
      return Promise.resolve(null);
    },
  };
}
