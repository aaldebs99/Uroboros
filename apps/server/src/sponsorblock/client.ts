import { createHash } from "node:crypto";
import { SPONSORBLOCK_CATEGORIES, SponsorBlockCategory } from "@uroboros/contract";
import { z } from "zod";
import type { StoredSegment } from "../library/sponsorSegments.ts";

/**
 * SponsorBlock's API (docs/automation.md#sponsorblock): the job consumers ask it for a YouTube
 * video's segments and highlight themselves, after each download and on a refetch, so no file is ever marked or
 * cut for them. They ask by the first four hex digits of the video id's SHA-256, as yt-dlp does,
 * so SponsorBlock never learns which video it was, and keep the one that matches.
 */

/** The public SponsorBlock server. */
export const SPONSORBLOCK_API = "https://sponsor.ajay.app";
const DEFAULT_TIMEOUT_MS = 10_000;

/** SponsorBlock didn't answer usably: unreachable, too slow, an error status, or an odd body. */
export class SponsorBlockError extends Error {
  override readonly name = "SponsorBlockError";
}

/** What SponsorBlock knows of one video, on the stored file's timeline. */
export interface SponsorBlockFindings {
  /** Every category's "skip" segments, sorted by start. */
  segments: StoredSegment[];
  /** Its highlight (`poi_highlight`), the moment people marked as what the video is for, or null. */
  highlight: number | null;
}

/** Asks SponsorBlock for one video's segments (every category's "skip" ones) and its highlight. */
export interface SponsorBlockClient {
  /**
   * The video's segments and highlight; none when it has none. `duration` is the stored file's
   * length (null when unknown): segments timed on a video of another length are dropped, ends
   * within a second of it reach it, and a highlight at or past it is dropped. Throws
   * `SponsorBlockError`.
   */
  lookUp(
    videoId: string,
    duration: number | null,
    signal?: AbortSignal,
  ): Promise<SponsorBlockFindings>;
}

/** SponsorBlock's highlight category, asked for beside the segments with its own action. */
const HIGHLIGHT = "poi_highlight";

const Answer = z.array(
  z.object({
    videoID: z.string(),
    segments: z.array(
      z.object({
        segment: z.tuple([z.number(), z.number()]),
        category: z.string(),
        actionType: z.string().optional(),
        videoDuration: z.number().nullish(),
        votes: z.number().optional(),
      }),
    ),
  }),
);

type Answered = z.infer<typeof Answer>[number]["segments"][number];

/**
 * A segment on the file's timeline, or null when it doesn't fit the file, as yt-dlp's SponsorBlock
 * step judges it: a start within a second of 0 is 0, an end within a second of the end (or past
 * it) is the end, and a segment SponsorBlock timed on a video more than a second longer or shorter
 * (an older cut of it, before its creator trimmed a sponsor out) counts only when that is under
 * 5 s and under 5 % of the segment. Without the file's length, segments stand as given.
 */
function fitted(s: Answered, duration: number | null): { start: number; end: number } | null {
  let [start, end] = s.segment;
  if (start <= 1) start = 0;
  if (duration === null) return { start, end };
  if (duration - end <= 1) end = duration;
  const diff = s.videoDuration ? Math.abs(duration - s.videoDuration) : 0;
  const fits = diff < 1 || (diff < 5 && end > start && diff / (end - start) < 0.05);
  return fits ? { start, end } : null;
}

function segmentsOf(mine: readonly Answered[], duration: number | null): StoredSegment[] {
  return mine
    .flatMap((s) => {
      const known = SponsorBlockCategory.safeParse(s.category);
      const skips = s.actionType === undefined || s.actionType === "skip";
      if (!known.success || !skips) return [];
      const span = fitted(s, duration);
      return span !== null && span.end > span.start ? [{ ...span, category: known.data }] : [];
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * The highlight: the most-voted `poi_highlight` point, where it starts before the file's end (a
 * start within a second of 0 is 0). Unlike a segment, it is kept whatever length of video it was
 * marked on, as the SponsorBlock extension shows it: an older cut of the video can put a point a
 * few seconds off, which only lands a jump a little early or late, where a segment that far off
 * would skip the wrong part.
 */
function highlightOf(mine: readonly Answered[], duration: number | null): number | null {
  let best: { at: number; votes: number } | null = null;
  for (const s of mine) {
    if (s.category !== HIGHLIGHT || (s.actionType !== undefined && s.actionType !== "poi")) {
      continue;
    }
    const at = s.segment[0] <= 1 ? 0 : s.segment[0];
    if (duration !== null && at >= duration) continue;
    const votes = s.votes ?? 0;
    if (best === null || votes > best.votes) best = { at, votes };
  }
  return best?.at ?? null;
}

export function sponsorBlockClient(opts: {
  baseUrl: string;
  timeoutMs?: number;
}): SponsorBlockClient {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async lookUp(videoId, duration, signal) {
      const prefix = createHash("sha256").update(videoId).digest("hex").slice(0, 4);
      const url = new URL(`/api/skipSegments/${prefix}`, opts.baseUrl);
      url.searchParams.set("service", "YouTube");
      url.searchParams.set("categories", JSON.stringify([...SPONSORBLOCK_CATEGORIES, HIGHLIGHT]));
      url.searchParams.set("actionTypes", JSON.stringify(["skip", "poi"]));
      const timeout = AbortSignal.timeout(timeoutMs);
      let res: Response;
      try {
        res = await fetch(url, {
          signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
          headers: { accept: "application/json" },
        });
      } catch (err) {
        throw new SponsorBlockError("SponsorBlock didn't answer", { cause: err });
      }
      if (res.status === 404) return { segments: [], highlight: null };
      if (!res.ok) throw new SponsorBlockError(`SponsorBlock answered ${String(res.status)}`);
      const body: unknown = await res.json().catch(() => null);
      const answer = Answer.safeParse(body);
      if (!answer.success) throw new SponsorBlockError("SponsorBlock's answer was unreadable");
      const mine = answer.data.find((v) => v.videoID === videoId)?.segments ?? [];
      return { segments: segmentsOf(mine, duration), highlight: highlightOf(mine, duration) };
    },
  };
}
