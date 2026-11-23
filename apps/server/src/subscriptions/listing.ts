import { probe, type PlaylistEntry } from "@uroboros/ytdlp";
import type { FeedJson } from "../db/schema.ts";
import type { WorkerDeps } from "../worker/deps.ts";
import { ytdlpOptions } from "../worker/probe.ts";

/** One video a feed listed, with what the listing said about it. */
export interface Candidate {
  /** The feed's URL, which decides priming and priority. */
  feed: string;
  /** Its place in the feed's listing (0 = first: the newest on a channel tab). */
  position: number;
  extractor: string;
  videoId: string;
  url: string;
  title: string | null;
  duration: number | null;
  liveStatus: string | null;
  availability: string | null;
  /** YYYYMMDD, from the listing's timestamp when it gives one. */
  uploadDate: string | null;
  mediaType: string | null;
}

/** A video's identity across feeds and checks: `extractor|videoId`. */
export const candidateKey = (c: { extractor: string; videoId: string }): string =>
  `${c.extractor}|${c.videoId}`;

function yyyymmdd(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  return new Date(timestamp * 1000).toISOString().slice(0, 10).replaceAll("-", "");
}

function candidate(feed: string, position: number, e: PlaylistEntry, fallback: string): Candidate {
  return {
    feed,
    position,
    extractor: (e.extractorKey ?? fallback).toLowerCase(),
    videoId: e.id,
    url: e.url ?? "",
    title: e.title,
    duration: e.duration,
    liveStatus: e.liveStatus,
    availability: e.availability,
    uploadDate: yyyymmdd(e.timestamp),
    mediaType: e.mediaType,
  };
}

/**
 * Lists a feed flat, at most `maxPlaylistEntries` from the top (a channel tab is newest first, so
 * the cap keeps the newest). `capped` says the listing may have gone on.
 */
export async function listFeed(
  deps: WorkerDeps,
  feed: FeedJson,
  signal?: AbortSignal,
): Promise<{ entries: Candidate[]; capped: boolean }> {
  const max = deps.limits.maxPlaylistEntries;
  const info = await probe(feed.url, {
    ...ytdlpOptions(deps),
    extraArgs: [`--playlist-items=1:${String(max)}`],
    ...(signal === undefined ? {} : { signal }),
  });
  if (info.kind === "video") return { entries: [], capped: false };
  const fallback = info.extractorKey ?? "generic";
  const videos = info.entries.filter((e) => e.kind === "video" && e.url !== null).slice(0, max);
  return {
    entries: videos.map((e, i) => candidate(feed.url, i, e, fallback)),
    capped: info.entries.length >= max,
  };
}
