import type { DownloadEvent } from "@uroboros/contract";

type Skips = Extract<DownloadEvent, { type: "skips" }>;

const SETTINGS = "Settings › SponsorBlock chooses which ones show and skip.";
const NONE = "SponsorBlock has no segments for this video yet";

/**
 * The toast for how a SponsorBlock refetch went (docs/automation.md#sponsorblock): how many
 * segments the person's setting shows or skips now and whether there is a highlight; when none,
 * whether SponsorBlock has none at all or only ones in categories they don't show or skip; or why
 * it failed.
 */
export function skipsOutcome(e: Pick<Skips, "found" | "error" | "total" | "highlight">): {
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
  if (e.found > 0) {
    const noun = e.found === 1 ? "segment" : "segments";
    const and = e.highlight ? " and the highlight" : "";
    return { tone: "success", title: `Found ${String(e.found)} SponsorBlock ${noun}${and}` };
  }
  const total = e.total ?? 0;
  if (total === 0) {
    return e.highlight
      ? { tone: "success", title: `Found the highlight; ${NONE}` }
      : { tone: "info", title: NONE };
  }
  return {
    tone: "info",
    title:
      total === 1
        ? "This video's 1 SponsorBlock segment isn't in a category you show or skip"
        : `None of this video's ${String(total)} SponsorBlock segments are in categories you show or skip`,
    detail: e.highlight ? `Found the highlight. ${SETTINGS}` : SETTINGS,
  };
}
