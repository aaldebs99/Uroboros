import type { Candidate } from "./listing.ts";
import type { Decision } from "./record.ts";
import type { SubscriptionRow } from "./store.ts";

/** The subscription columns the filters read (title patterns are matched in Postgres first). */
export type FilterRow = Pick<
  SubscriptionRow,
  | "kind"
  | "min_duration_s"
  | "max_duration_s"
  | "uploaded_after"
  | "exclude_shorts"
  | "exclude_live"
>;

/** A decision, or "probe": a filter needs a field the listing lacks. */
export type Verdict = Decision | { c: Candidate; outcome: "probe" };

const filtered = (c: Candidate, reason: string): Verdict => ({ c, outcome: "filtered", reason });

/** A DATE column (a Date at local midnight) as YYYY-MM-DD. */
function dashed(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Live and availability rules, which hold whatever the filters say. */
function liveRule(c: Candidate, f: FilterRow): Verdict | null {
  if (c.availability === "private") return filtered(c, "unavailable");
  if (c.liveStatus === "is_upcoming")
    return { c, outcome: "waiting", reason: "upcoming", dueAt: null };
  if (c.liveStatus === "is_live") return { c, outcome: "waiting", reason: "live now", dueAt: null };
  if (f.exclude_live && (c.liveStatus === "was_live" || c.liveStatus === "post_live")) {
    return filtered(c, "live stream");
  }
  return null;
}

function durationRule(c: Candidate, f: FilterRow, probed: boolean): Verdict | null {
  if (f.min_duration_s === null && f.max_duration_s === null) return null;
  if (c.duration === null) return probed ? null : { c, outcome: "probe" };
  if (f.min_duration_s !== null && c.duration < f.min_duration_s) return filtered(c, "too short");
  if (f.max_duration_s !== null && c.duration > f.max_duration_s) return filtered(c, "too long");
  return null;
}

function dateRule(c: Candidate, f: FilterRow, probed: boolean): Verdict | null {
  if (f.uploaded_after === null) return null;
  if (c.uploadDate === null) return probed ? null : { c, outcome: "probe" };
  const after = dashed(f.uploaded_after);
  return c.uploadDate < after.replaceAll("-", "") ? filtered(c, `uploaded before ${after}`) : null;
}

/** Playlists only: a channel leaves Shorts out by not following its Shorts tab. */
function shortsRule(c: Candidate, f: FilterRow, probed: boolean): Verdict | null {
  if (f.kind !== "playlist" || !f.exclude_shorts) return null;
  if (c.url.includes("/shorts/") || c.mediaType === "short") return filtered(c, "short");
  if (c.mediaType === null && !probed) return { c, outcome: "probe" };
  return null;
}

/**
 * Decides one new video (docs/automation.md): live and availability first, then the title (already
 * matched, `titleOk`), duration, upload date and Shorts. After a probe (`probed`), a field still
 * missing passes its filter.
 */
export function decide(c: Candidate, f: FilterRow, titleOk: boolean, probed: boolean): Verdict {
  const live = liveRule(c, f);
  if (live !== null) return live;
  if (!titleOk) return filtered(c, "title");
  return (
    durationRule(c, f, probed) ??
    dateRule(c, f, probed) ??
    shortsRule(c, f, probed) ?? { c, outcome: "queue" }
  );
}

/**
 * Holds a passing video for `delayHours` after it was first seen (SponsorBlock segments arrive in
 * the hours after upload); anything else, or a video already due, is returned as it is.
 */
export function withDelay(d: Decision, delayHours: number, seenAt: Date, now: Date): Decision {
  if (d.outcome !== "queue" || delayHours <= 0) return d;
  const dueAt = new Date(seenAt.getTime() + delayHours * 3_600_000);
  if (dueAt <= now) return d;
  return { c: d.c, outcome: "waiting", reason: `waiting until ${dueAt.toISOString()}`, dueAt };
}
