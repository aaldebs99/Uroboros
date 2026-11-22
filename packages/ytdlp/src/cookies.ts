import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Runs `fn` with a private copy of the cookies file (or null when there is none) and removes the
 * copy afterwards. yt-dlp writes its cookie jar back on exit, which would fail on a read-only
 * mount and race between concurrent jobs sharing one file.
 */
export async function withCookiesCopy<T>(
  cookiesFile: string | undefined,
  fn: (path: string | null) => Promise<T>,
): Promise<T> {
  if (cookiesFile === undefined) return fn(null);
  const dir = await mkdtemp(join(tmpdir(), "uroboros-cookies-"));
  try {
    const copy = join(dir, "cookies.txt");
    await copyFile(cookiesFile, copy);
    return await fn(copy);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
