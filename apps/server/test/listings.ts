/** Test helpers for subscription checks: a flat listing as yt-dlp prints it, and rows. */
import type { Kysely } from "kysely";
import type { Database } from "../src/db/schema.ts";

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

/** A subscription row for check and duty tests, following `feeds`. */
export async function insertSubscription(
  db: Kysely<Database>,
  values: {
    userId: string;
    profileId: string;
    feeds: { name: string; url: string; primedAt?: string | null }[];
    sourceId: string;
    title?: string;
    enabled?: boolean;
    notify?: boolean;
    intervalMinutes?: number;
    backfill?: "none" | "newest" | "all";
  },
): Promise<string> {
  const row = await db
    .insertInto("subscriptions")
    .values({
      user_id: values.userId,
      kind: "channel",
      extractor: "youtube",
      source_id: values.sourceId,
      title: values.title ?? "Blender",
      url: "https://www.youtube.com/@BlenderOfficial",
      feeds: JSON.stringify(values.feeds),
      tabs: JSON.stringify(values.feeds),
      profile_id: values.profileId,
      interval_minutes: values.intervalMinutes ?? 360,
      enabled: values.enabled ?? true,
      notify: values.notify ?? true,
      backfill: values.backfill ?? "none",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}
