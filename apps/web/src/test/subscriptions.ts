import type { Subscription, SubscriptionItem } from "@uroboros/contract";

/** Test data for the subscription pages. */
export const SUB_ID = "0190a3f2-7c1e-7000-8000-0000000000c1";

export const subscriptionFixture = (over: Partial<Subscription> = {}): Subscription => ({
  id: SUB_ID,
  kind: "channel",
  title: "Blender",
  url: "https://www.youtube.com/@BlenderOfficial",
  extractor: "youtube",
  sourceId: "UCSMOQeBJ2RAnuFungnQOxLg",
  channelKey: "a2V5",
  feeds: [{ name: "Videos", url: "https://www.youtube.com/@BlenderOfficial/videos" }],
  tabs: [
    { name: "Videos", url: "https://www.youtube.com/@BlenderOfficial/videos" },
    { name: "Shorts", url: "https://www.youtube.com/@BlenderOfficial/shorts" },
    { name: "Live", url: "https://www.youtube.com/@BlenderOfficial/streams" },
  ],
  profileId: "0190a3f2-7c1e-7000-8000-000000000001",
  profileName: "Best up to 1080p (MP4)",
  schedule: { kind: "interval", minutes: 360 },
  enabled: true,
  notify: true,
  filters: {
    titleInclude: null,
    titleExclude: null,
    minDuration: null,
    maxDuration: null,
    uploadedAfter: null,
    excludeShorts: false,
    excludeLive: false,
  },
  delayHours: 0,
  backfill: { mode: "none", count: null },
  retention: { keepLast: null, deleteWatchedAfterDays: null },
  lastCheckedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  nextCheckAt: new Date(Date.now() + 4 * 3_600_000).toISOString(),
  checking: false,
  error: null,
  failures: 0,
  warning: null,
  counts: { queued: 3, filtered: 1, waiting: 0 },
  createdAt: "2026-11-20T10:00:00.000Z",
  ...over,
});

export const itemFixture = (over: Partial<SubscriptionItem> = {}): SubscriptionItem => ({
  extractor: "youtube",
  videoId: "v1",
  title: "Blender 5.3 overview",
  url: "https://www.youtube.com/watch?v=v1",
  outcome: "queued",
  reason: null,
  seenAt: "2026-11-23T08:00:00.000Z",
  dueAt: null,
  downloadId: null,
  downloadState: null,
  entryId: null,
  ...over,
});
