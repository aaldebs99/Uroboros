import { open, readdir } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { DownloadedFile, VideoInfo } from "@uroboros/ytdlp";
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

/** The yt-dlp arguments that save subtitles as `.vtt` beside the media file. */
export function subtitleArgs(s: SubtitleSettings): string[] {
  if (s.langs === null) return [];
  return [
    "--write-subs",
    ...(s.automatic ? ["--write-auto-subs"] : []),
    `--sub-langs=${s.langs}`,
    "--convert-subs=vtt",
  ];
}

export interface FoundSubtitle {
  lang: string;
  path: string;
  automatic: boolean;
}

/**
 * The `<base>.<lang>.vtt` files yt-dlp wrote beside `mediaPath`. A language counts as automatic when
 * the info lists it only among the automatic captions. Nothing found is fine.
 */
export async function findSubtitles(mediaPath: string, info: VideoInfo): Promise<FoundSubtitle[]> {
  const dir = dirname(mediaPath);
  const base = basename(mediaPath, extname(mediaPath));
  const names = await readdir(dir).catch(() => [] as string[]);
  return names
    .filter((n) => n.startsWith(`${base}.`) && n.endsWith(".vtt"))
    .map((n) => {
      const lang = n.slice(base.length + 1, -".vtt".length);
      const automatic = !(lang in info.subtitles) && lang in info.automaticCaptions;
      return { lang, path: join(dir, n), automatic };
    })
    .filter((s) => s.lang !== "");
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
  file: DownloadedFile,
) {
  const stored = new Map<string, string>();
  for (const sub of await findSubtitles(file.path, file.info)) {
    try {
      const key = subtitleKey(deps.storage, mediaId, mediaKey, sub.lang);
      await deps.store.put(key, sub.path, contentTypeOf("vtt"));
      await deps.db
        .insertInto("subtitles")
        .values({ media_id: mediaId, lang: sub.lang, automatic: sub.automatic, storage_key: key })
        .onConflict((oc) =>
          oc
            .columns(["media_id", "lang", "automatic"])
            .doUpdateSet({ storage_key: key, indexed_at: null, index_failures: 0 }),
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
