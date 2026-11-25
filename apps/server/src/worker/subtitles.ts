import { open, readdir } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { YtDlpError, type VideoInfo } from "@uroboros/ytdlp";
import type { Logger } from "pino";
import {
  indexMediaCaptions,
  MAX_CAPTION_BYTES,
  storeReader,
  type ReadCaptions,
} from "../library/captionIndex.ts";
import { contentTypeOf } from "../storage/contentType.ts";
import { subtitleKey } from "../storage/index.ts";
import type { WorkerDeps } from "./deps.ts";

export interface SubtitleSettings {
  /** yt-dlp `--sub-langs`; null saves none. */
  langs: string | null;
  automatic: boolean;
}

/**
 * The yt-dlp arguments that save subtitles as `.vtt` beside the media file. With automatic
 * captions, each is asked for once: YouTube's `<lang>-orig` is the same file as its `<lang>`
 * (unless the setting names the originals itself), and machine translations of a video's
 * subtitles (`en-de`) are skipped, each one more request to a site that rate-limits them.
 */
export function subtitleArgs(s: SubtitleSettings): string[] {
  if (s.langs === null) return [];
  const langs = s.automatic && !/orig/i.test(s.langs) ? `${s.langs},-.*-orig` : s.langs;
  return [
    "--write-subs",
    ...(s.automatic ? ["--write-auto-subs", "--extractor-args=youtube:skip=translated_subs"] : []),
    `--sub-langs=${langs}`,
    "--convert-subs=vtt",
  ];
}

/** yt-dlp's words when a subtitle could not be fetched (an HTTP 429 on YouTube's captions, say). */
export const SUBTITLE_FAILED = "Unable to download video subtitles";

/**
 * How a fetch's subtitles went: `fetched` with the video, `none` (none wanted, or the site refused
 * them for a reason other than a rate limit), or `held`: a rate limit kept them back, and they are
 * fetched after the cooldown (docs/downloads.md "Rate limits").
 */
export type SubtitleOutcome = "fetched" | "none" | "held";

/**
 * Runs yt-dlp with the profile's and the subtitle arguments, and once more with the profile's alone
 * when a subtitle could not be fetched: yt-dlp writes subtitles before the media and fails the
 * whole run on one it cannot get, so the video never came, and the second run costs little. With
 * `held` (the site's subtitles are cooling down) it asks for none at all. A subtitle the site
 * rate-limited calls `onLimited` with the time it said to wait, if any, and holds them.
 */
export async function withSubtitleFallback<T>(
  run: (extraArgs: string[]) => Promise<T>,
  args: { profile: string[]; subtitles: string[]; held: boolean },
  signal: AbortSignal,
  logger: Logger,
  onLimited: (hintMs: number | null) => Promise<void>,
): Promise<{ result: T; subtitles: SubtitleOutcome }> {
  if (args.subtitles.length === 0) return { result: await run(args.profile), subtitles: "none" };
  if (args.held) return { result: await run(args.profile), subtitles: "held" };
  try {
    return { result: await run([...args.profile, ...args.subtitles]), subtitles: "fetched" };
  } catch (err) {
    const subtitlesFailed =
      err instanceof YtDlpError && err.stderrTail.some((l) => l.includes(SUBTITLE_FAILED));
    if (!subtitlesFailed || signal.aborted) throw err;
    if (err.kind === "rate_limited") {
      logger.warn({ err }, "the site rate-limited subtitles; fetching the video, them later");
      await onLimited(err.retryAfterMs);
      return { result: await run(args.profile), subtitles: "held" };
    }
    logger.warn({ err }, "fetching subtitles failed; fetching the video without them");
    return { result: await run(args.profile), subtitles: "none" };
  }
}

export interface FoundSubtitle {
  lang: string;
  path: string;
  automatic: boolean;
}

/**
 * The `<base>.<lang>.vtt` files among `names` in `dir`. A language counts as automatic when the info
 * lists it only among the automatic captions.
 */
export function subtitlesNamed(
  dir: string,
  base: string,
  names: readonly string[],
  info: VideoInfo,
): FoundSubtitle[] {
  return names
    .filter((n) => n.startsWith(`${base}.`) && n.endsWith(".vtt"))
    .map((n) => {
      const lang = n.slice(base.length + 1, -".vtt".length);
      const automatic = !(lang in info.subtitles) && lang in info.automaticCaptions;
      return { lang, path: join(dir, n), automatic };
    })
    .filter((s) => s.lang !== "");
}

/** The subtitle files yt-dlp wrote beside `mediaPath` (`subtitlesNamed`). Nothing found is fine. */
export async function findSubtitles(mediaPath: string, info: VideoInfo): Promise<FoundSubtitle[]> {
  const dir = dirname(mediaPath);
  const names = await readdir(dir).catch(() => [] as string[]);
  return subtitlesNamed(dir, basename(mediaPath, extname(mediaPath)), names, info);
}

/** The start of a local file (at most `MAX_CAPTION_BYTES`), as text. */
async function readStart(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    const length = Math.min((await handle.stat()).size, MAX_CAPTION_BYTES);
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(length), 0, length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

/** Reads the files just stored from where yt-dlp wrote them, and any older one from the store. */
function localFirst(local: Map<string, string>, fallback: ReadCaptions): ReadCaptions {
  return (key) => {
    const path = local.get(key);
    return path === undefined ? fallback(key) : readStart(path);
  };
}

/**
 * Stores each subtitle file beside the media and records it (one per language and kind), then
 * reads the media's captions for search (docs/library.md "Search"). A subtitle that cannot be
 * stored or read is logged and skipped: the video itself is what was asked for, and the leader's
 * catch-up duty reads what waits.
 */
export async function storeSubtitles(
  deps: WorkerDeps,
  mediaId: string,
  mediaKey: string,
  found: readonly FoundSubtitle[],
) {
  const stored = new Map<string, string>();
  for (const sub of found) {
    try {
      const key = subtitleKey(deps.storage, mediaId, mediaKey, sub.lang);
      const { size } = await deps.store.put(key, sub.path, contentTypeOf("vtt"));
      await deps.db
        .insertInto("subtitles")
        .values({
          media_id: mediaId,
          lang: sub.lang,
          automatic: sub.automatic,
          storage_key: key,
          size_bytes: size,
        })
        .onConflict((oc) =>
          oc.columns(["media_id", "lang", "automatic"]).doUpdateSet({
            storage_key: key,
            size_bytes: size,
            indexed_at: null,
            index_failures: 0,
          }),
        )
        .execute();
      stored.set(key, sub.path);
    } catch (err) {
      deps.logger.warn({ err, mediaId, lang: sub.lang }, "storing a subtitle failed; skipping it");
    }
  }
  if (stored.size === 0) return;
  try {
    await indexMediaCaptions(deps, mediaId, localFirst(stored, storeReader(deps.store)));
  } catch (err) {
    deps.logger.warn({ err, mediaId }, "reading captions for search failed; the duty retries");
  }
}
