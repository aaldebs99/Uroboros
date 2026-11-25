import type { Logger } from "pino";
import { shiftsTimeline, type ProfileArgs } from "../downloads/profiles.ts";
import type { SponsorBlockClient, SponsorBlockFindings } from "../sponsorblock/client.ts";

/** SponsorBlock knows YouTube's videos alone. */
const YOUTUBE = "youtube";

/** Nothing from SponsorBlock: no segments and no highlight. */
const NONE: SponsorBlockFindings = { segments: [], highlight: null };

/**
 * The SponsorBlock segments and highlight a newly fetched file keeps
 * (docs/automation.md#sponsorblock): every category's segments, asked of SponsorBlock by the server
 * itself, for a YouTube video whose file keeps the video's own times, fitted to the file's length
 * (`duration`). Anything else keeps none, and so does a lookup that fails: the download stands, and
 * its owner can fetch them again later.
 */
export async function lookUpSegments(
  deps: { sponsorBlock: SponsorBlockClient; logger: Logger },
  media: { extractor: string; videoId: string },
  args: ProfileArgs,
  duration: number | null,
  signal?: AbortSignal,
): Promise<SponsorBlockFindings> {
  if (media.extractor !== YOUTUBE || shiftsTimeline(args.extraArgs)) return NONE;
  try {
    return await deps.sponsorBlock.lookUp(media.videoId, duration, signal);
  } catch (err) {
    deps.logger.warn({ err, videoId: media.videoId }, "SponsorBlock's segments are unavailable");
    return NONE;
  }
}
