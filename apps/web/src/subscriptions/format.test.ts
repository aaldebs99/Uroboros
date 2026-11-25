import { afterEach, describe, expect, it, vi } from "vitest";

import { intervalLabel, relativeTime, scheduleLabel } from "./format";

const NOW = Date.parse("2026-11-24T12:00:00Z");
const at = (offsetSeconds: number) => new Date(NOW + offsetSeconds * 1000).toISOString();

afterEach(() => {
  vi.useRealTimers();
});

describe("relativeTime", () => {
  it("says the nearest unit, minutes up to days, either way in time", () => {
    expect(relativeTime(at(-2 * 3600), NOW)).toBe("2 hours ago");
    expect(relativeTime(at(4 * 3600), NOW)).toBe("in 4 hours");
    expect(relativeTime(at(-120), NOW)).toBe("2 minutes ago");
    expect(relativeTime(at(-3 * 86_400), NOW)).toBe("3 days ago");
  });

  it("calls a moment ago this minute, and a day ago yesterday", () => {
    expect(relativeTime(at(-20), NOW)).toBe("this minute");
    expect(relativeTime(at(-86_400), NOW)).toBe("yesterday");
  });
});

describe("intervalLabel", () => {
  it("names the largest unit that divides the interval", () => {
    expect(intervalLabel(10080)).toBe("Every week");
    expect(intervalLabel(1440)).toBe("Every day");
    expect(intervalLabel(2880)).toBe("Every 2 days");
    expect(intervalLabel(360)).toBe("Every 6 hours");
    expect(intervalLabel(90)).toBe("Every 90 minutes");
  });
});

describe("scheduleLabel", () => {
  it("says how often, and when it was last checked", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    expect(
      scheduleLabel({ schedule: { kind: "interval", minutes: 360 }, lastCheckedAt: at(-2 * 3600) }),
    ).toBe("every 6 hours · checked 2 hours ago");
    expect(scheduleLabel({ schedule: { kind: "manual" }, lastCheckedAt: null })).toBe(
      "manual · not checked yet",
    );
    expect(
      scheduleLabel({
        schedule: { kind: "cron", expression: "0 9 * * 1", timezone: "Europe/Berlin" },
        lastCheckedAt: at(-86_400),
      }),
    ).toBe("on cron 0 9 * * 1 (Europe/Berlin) · checked yesterday");
  });
});
