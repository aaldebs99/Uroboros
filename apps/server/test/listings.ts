/** Test helpers for subscription checks: a flat listing as yt-dlp prints it. */

export interface ListedVideo {
  id: string;
  title?: string | null;
  duration?: number | null;
  live_status?: string | null;
  availability?: string | null;
  timestamp?: number | null;
  url?: string;
}

/** A `--flat-playlist --dump-single-json` listing of `entries` at `url`. */
export function listing(url: string, entries: ListedVideo[]): string {
  return JSON.stringify({
    _type: "playlist",
    id: "UClisting",
    title: "Blender - Videos",
    extractor_key: "YoutubeTab",
    webpage_url: url,
    entries: entries.map((e) => ({
      _type: "url",
      ie_key: "Youtube",
      id: e.id,
      url: e.url ?? `https://www.youtube.com/watch?v=${e.id}`,
      title: e.title === undefined ? `Video ${e.id}` : e.title,
      duration: e.duration === undefined ? 300 : e.duration,
      live_status: e.live_status ?? null,
      availability: e.availability ?? null,
      timestamp: e.timestamp ?? null,
    })),
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
