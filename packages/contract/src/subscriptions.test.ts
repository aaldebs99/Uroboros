import { describe, expect, it } from "vitest";
import {
  CHECK_INTERVAL_PRESETS,
  NewSubscriptionBody,
  PreviewGroup,
  SubscriptionPatch,
} from "./index.ts";

const minimal = {
  requestId: "0190a3f2-7c1e-7000-8000-000000000001",
  feeds: ["Videos"],
  profileId: "0190a3f2-7c1e-7000-8000-000000000002",
  intervalMinutes: 360,
};

describe("subscriptions contract", () => {
  it("accepts a minimal body and fills in the defaults", () => {
    expect(NewSubscriptionBody.parse(minimal)).toEqual({
      ...minimal,
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
      notify: true,
    });
  });

  it("refuses newest backfill without a count", () => {
    expect(() =>
      NewSubscriptionBody.parse({ ...minimal, backfill: { mode: "newest", count: null } }),
    ).toThrow();
    expect(
      NewSubscriptionBody.parse({ ...minimal, backfill: { mode: "newest", count: 5 } }).backfill,
    ).toEqual({ mode: "newest", count: 5 });
  });

  it("refuses minDuration above maxDuration", () => {
    expect(() =>
      NewSubscriptionBody.parse({ ...minimal, filters: { minDuration: 600, maxDuration: 60 } }),
    ).toThrow();
  });

  it("refuses an interval past a week and an empty patch", () => {
    expect(() => NewSubscriptionBody.parse({ ...minimal, intervalMinutes: 10081 })).toThrow();
    expect(() => SubscriptionPatch.parse({})).toThrow();
    expect(SubscriptionPatch.parse({ enabled: false })).toEqual({ enabled: false });
  });

  it("offers the interval presets, six hours among them", () => {
    expect(CHECK_INTERVAL_PRESETS).toContain(360);
    expect(Math.max(...CHECK_INTERVAL_PRESETS)).toBe(10080);
  });

  it("gives preview groups their listing URL", () => {
    expect(
      PreviewGroup.parse({
        name: "Videos",
        url: "https://www.youtube.com/@b/videos",
        ticked: true,
        truncated: false,
        entries: [],
      }).url,
    ).toBe("https://www.youtube.com/@b/videos");
  });
});
