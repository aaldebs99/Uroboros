import { readdir } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { VideoInfo } from "@uroboros/ytdlp";

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
