import { createHash } from "node:crypto";
import { SPONSORBLOCK_CATEGORIES, SponsorBlockCategory } from "@uroboros/contract";
import { z } from "zod";
import type { StoredSegment } from "../library/sponsorSegments.ts";

/**
 * SponsorBlock's API (docs/automation.md#sponsorblock): the job consumers ask it for a YouTube
 * video's segments themselves, after each download and on a refetch, so no file is ever marked or
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

/** Asks SponsorBlock for one video's segments: every category's, its "skip" action's. */
export interface SponsorBlockClient {
  /** The video's segments, sorted by start; `[]` when it has none. Throws `SponsorBlockError`. */
  segments(videoId: string, signal?: AbortSignal): Promise<StoredSegment[]>;
}

const Answer = z.array(
  z.object({
    videoID: z.string(),
    segments: z.array(
      z.object({
        segment: z.tuple([z.number(), z.number()]),
        category: z.string(),
        actionType: z.string().optional(),
      }),
    ),
  }),
);

function segmentsOf(answer: z.infer<typeof Answer>, videoId: string): StoredSegment[] {
  const mine = answer.find((v) => v.videoID === videoId)?.segments ?? [];
  return mine
    .flatMap(({ segment: [start, end], category, actionType }) => {
      const known = SponsorBlockCategory.safeParse(category);
      const skips = actionType === undefined || actionType === "skip";
      return known.success && skips && end > start ? [{ start, end, category: known.data }] : [];
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

export function sponsorBlockClient(opts: {
  baseUrl: string;
  timeoutMs?: number;
}): SponsorBlockClient {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async segments(videoId, signal) {
      const prefix = createHash("sha256").update(videoId).digest("hex").slice(0, 4);
      const url = new URL(`/api/skipSegments/${prefix}`, opts.baseUrl);
      url.searchParams.set("service", "YouTube");
      url.searchParams.set("categories", JSON.stringify(SPONSORBLOCK_CATEGORIES));
      url.searchParams.set("actionTypes", JSON.stringify(["skip"]));
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
      if (res.status === 404) return [];
      if (!res.ok) throw new SponsorBlockError(`SponsorBlock answered ${String(res.status)}`);
      const body: unknown = await res.json().catch(() => null);
      const answer = Answer.safeParse(body);
      if (!answer.success) throw new SponsorBlockError("SponsorBlock's answer was unreadable");
      return segmentsOf(answer.data, videoId);
    },
  };
}
