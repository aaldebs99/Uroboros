import { describe, expect, it } from "vitest";

import { intervalLabel, scheduleLabel } from "./format";
import { scheduleOf, type FormValues } from "./formValues";

describe("schedule labels", () => {
  it("says an interval in the largest unit that divides it", () => {
    expect(intervalLabel(60)).toBe("Every hour");
    expect(intervalLabel(360)).toBe("Every 6 hours");
    expect(intervalLabel(1440)).toBe("Every day");
    expect(intervalLabel(4320)).toBe("Every 3 days");
    expect(intervalLabel(10080)).toBe("Every week");
    expect(intervalLabel(90)).toBe("Every 90 minutes");
  });

  it("names a cron with its timezone", () => {
    const schedule = { kind: "cron", expression: "0 9 * * 1", timezone: "Europe/Berlin" } as const;
    expect(scheduleLabel({ schedule, lastCheckedAt: null })).toBe(
      "on cron 0 9 * * 1 (Europe/Berlin) · not checked yet",
    );
  });
});

describe("scheduleOf", () => {
  const v = (over: Partial<FormValues>) =>
    ({
      scheduleMode: "interval",
      everyValue: "6",
      everyUnit: "hours",
      cron: "0 */6 * * *",
      timezone: "UTC",
      ...over,
    }) as FormValues;

  it("turns a number and a unit into minutes", () => {
    expect(scheduleOf(v({ everyValue: "2", everyUnit: "days" }))).toEqual({
      kind: "interval",
      minutes: 2880,
    });
    expect(scheduleOf(v({ everyValue: "1.5", everyUnit: "hours" }))).toEqual({
      kind: "interval",
      minutes: 90,
    });
  });

  it("sends a cron trimmed, in its timezone", () => {
    expect(
      scheduleOf(v({ scheduleMode: "cron", cron: " 0 9 * * * ", timezone: "Asia/Tokyo" })),
    ).toEqual({ kind: "cron", expression: "0 9 * * *", timezone: "Asia/Tokyo" });
  });
});
