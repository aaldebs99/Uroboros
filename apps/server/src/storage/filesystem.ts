import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { MediaStore } from "./store.ts";

function isNotFound(err: unknown): boolean {
  return (err as { code?: string }).code === "ENOENT";
}

/** Organized folders under `root`; keys are relative paths, written atomically (temp + rename). */
export function createFilesystemStore(root: string): MediaStore {
  const base = resolve(root);
  const pathOf = (key: string) => {
    const path = resolve(base, key);
    if (!path.startsWith(base + sep)) throw new Error(`storage key escapes the root: ${key}`);
    return path;
  };
  return {
    async put(key, file) {
      const target = pathOf(key);
      await mkdir(dirname(target), { recursive: true });
      const temp = join(
        dirname(target),
        `.${basename(target)}.${randomBytes(6).toString("hex")}.tmp`,
      );
      try {
        await copyFile(file, temp);
        await rename(temp, target);
      } catch (err) {
        await rm(temp, { force: true });
        throw err;
      }
      return { size: (await stat(target)).size };
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
      await rm(pathOf(key), { force: true });
    },
    downloadUrl() {
      return Promise.resolve(null);
    },
  };
}
