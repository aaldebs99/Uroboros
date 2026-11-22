import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * yt-dlp's leftovers from an interrupted download: the `.part` file, its fragments
 * (`.part-Frag12`), the resume state (`.ytdl`) and ffmpeg's `.temp` intermediates.
 */
const PARTIAL = /\.(?:part(?:-Frag\d+)?|ytdl|temp)(?:\.[^./]+)?$/;

/** Removes every partial file under `dir`, recursively, and returns the paths it removed. */
export async function removePartialFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const partial = entries
    .filter((entry) => entry.isFile() && PARTIAL.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
  await Promise.all(partial.map((path) => rm(path, { force: true })));
  return partial;
}
