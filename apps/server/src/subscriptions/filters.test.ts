import { describe, expect, it } from "vitest";
import { decide, withDelay, type FilterRow } from "./filters.ts";
import type { Candidate } from "./listing.ts";

const now = new Date("2026-11-23T12:00:00Z");

const c = (over: Partial<Candidate> = {}): Candidate => ({
  feed: "https://www.youtube.com/@b/videos",
  position: 0,
  extractor: "youtube",
  videoId: "v",
  url: "https://www.youtube.com/watch?v=v",
  title: "A video",
  duration: 300,
  liveStatus: null,
  availability: null,
  uploadDate: null,
  mediaType: null,
  ...over,
});

const f = (over: Partial<FilterRow> = {}): FilterRow => ({
  kind: "channel",
  min_duration_s: null,
  max_duration_s: null,
  uploaded_after: null,
  exclude_shorts: false,
  exclude_live: false,
  ...over,
});

const outcome = (d: ReturnType<typeof decide>) =>
  d.outcome === "filtered" || d.outcome === "waiting" ? [d.outcome, d.reason] : [d.outcome];

describe("subscription filters", () => {
  it("queues a video no filter holds back", () => {
    expect(outcome(decide(c(), f(), true, false))).toEqual(["queue"]);
  });

  it("keeps upcoming entries waiting", () => {
    expect(outcome(decide(c({ liveStatus: "is_upcoming" }), f(), true, false))).toEqual([
      "waiting",
      "upcoming",
    ]);
    expect(outcome(decide(c({ liveStatus: "is_live" }), f(), true, false))).toEqual([
      "waiting",
      "live now",
    ]);
  });

  it("filters finished live streams when live is excluded", () => {
    const live = c({ liveStatus: "was_live" });
    expect(outcome(decide(live, f({ exclude_live: true }), true, false))).toEqual([
      "filtered",
      "live stream",
    ]);
    expect(outcome(decide(live, f(), true, false))).toEqual(["queue"]);
  });

  it("filters by title", () => {
    expect(outcome(decide(c(), f(), false, false))).toEqual(["filtered", "title"]);
  });

  it("filters by duration and probes when the listing has none", () => {
    const bounds = f({ min_duration_s: 120, max_duration_s: 600 });
    expect(outcome(decide(c({ duration: 60 }), bounds, true, false))).toEqual([
      "filtered",
      "too short",
    ]);
    expect(outcome(decide(c({ duration: 900 }), bounds, true, false))).toEqual([
      "filtered",
      "too long",
    ]);
    expect(outcome(decide(c({ duration: null }), bounds, true, false))).toEqual(["probe"]);
  });

  it("probes for the date filter when the listing has no date", () => {
    const after = f({ uploaded_after: new Date(2026, 10, 1) });
    expect(outcome(decide(c(), after, true, false))).toEqual(["probe"]);
    expect(outcome(decide(c({ uploadDate: "20261031" }), after, true, true))).toEqual([
      "filtered",
      "uploaded before 2026-11-01",
    ]);
    expect(outcome(decide(c({ uploadDate: "20261101" }), after, true, true))).toEqual(["queue"]);
  });

  it("filters shorts in playlists by URL and media type", () => {
    const shorts = f({ kind: "playlist", exclude_shorts: true });
    expect(
      outcome(decide(c({ url: "https://www.youtube.com/shorts/v" }), shorts, true, false)),
    ).toEqual(["filtered", "short"]);
    expect(outcome(decide(c({ mediaType: "short" }), shorts, true, false))).toEqual([
      "filtered",
      "short",
    ]);
    expect(outcome(decide(c(), shorts, true, false))).toEqual(["probe"]);
    expect(outcome(decide(c({ mediaType: "video" }), shorts, true, false))).toEqual(["queue"]);
    // A channel leaves Shorts out by its tabs; the flag does nothing there.
    expect(outcome(decide(c(), f({ exclude_shorts: true }), true, false))).toEqual(["queue"]);
  });

  it("passes a filter whose field a probe could not find", () => {
    const all = f({
      kind: "playlist",
      min_duration_s: 1,
      uploaded_after: new Date(2026, 0, 1),
      exclude_shorts: true,
    });
    expect(outcome(decide(c({ duration: null }), all, true, true))).toEqual(["queue"]);
  });

  it("records private entries as unavailable", () => {
    expect(outcome(decide(c({ availability: "private" }), f(), true, false))).toEqual([
      "filtered",
      "unavailable",
    ]);
  });

  it("delays passing entries and queues them once due", () => {
    const seen = new Date("2026-11-23T10:00:00Z");
    const queued = { c: c(), outcome: "queue" as const };
    const held = withDelay(queued, 6, seen, now);
    expect(held).toMatchObject({ outcome: "waiting", dueAt: new Date("2026-11-23T16:00:00Z") });
    expect(held.outcome === "waiting" && held.reason).toBe(
      "waiting until 2026-11-23T16:00:00.000Z",
    );
    expect(withDelay(queued, 1, seen, now)).toEqual(queued);
    expect(withDelay(queued, 0, seen, now)).toEqual(queued);
  });
});
