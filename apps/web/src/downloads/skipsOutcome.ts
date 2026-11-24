import type { DownloadEvent } from "@uroboros/contract";

type Skips = Extract<DownloadEvent, { type: "skips" }>;

/**
 * The toast for how a SponsorBlock refetch went (docs/automation.md#sponsorblock): the segments
 * the player now skips, none yet, or why it failed.
 */
export function skipsOutcome(e: Pick<Skips, "found" | "error">): {
  tone: "success" | "info" | "error";
  title: string;
  detail?: string;
} {
  if (e.found === null) {
    return {
      tone: "error",
      title: "Could not fetch SponsorBlock segments",
      detail: e.error ?? "the refetch failed",
    };
  }
  if (e.found === 0)
    return { tone: "info", title: "SponsorBlock has no segments for this video yet" };
  const noun = e.found === 1 ? "segment" : "segments";
  return { tone: "success", title: `Found ${String(e.found)} SponsorBlock ${noun} to skip` };
}
