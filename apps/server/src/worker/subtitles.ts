import { readdir } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { DownloadedFile, VideoInfo } from "@uroboros/ytdlp";
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

/**
 * Stores each subtitle file beside the media and records it (one per language and kind). A subtitle
 * that cannot be stored is logged and skipped: the video itself is what was asked for.
 */
export async function storeSubtitles(
  deps: WorkerDeps,
  mediaId: string,
  mediaKey: string,
  file: DownloadedFile,
) {
  for (const sub of await findSubtitles(file.path, file.info)) {
    try {
      const key = subtitleKey(deps.storage, mediaId, mediaKey, sub.lang);
      await deps.store.put(key, sub.path, contentTypeOf("vtt"));
      await deps.db
        .insertInto("subtitles")
        .values({ media_id: mediaId, lang: sub.lang, automatic: sub.automatic, storage_key: key })
        .onConflict((oc) =>
          oc.columns(["media_id", "lang", "automatic"]).doUpdateSet({ storage_key: key }),
        )
        .execute();
    } catch (err) {
      deps.logger.warn({ err, mediaId, lang: sub.lang }, "storing a subtitle failed; skipping it");
    }
  }
}
