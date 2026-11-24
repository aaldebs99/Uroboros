import { describe, expect, it } from "vitest";
import { firstCheckAt, nextCheckAfter } from "./schedule.ts";

const hourly = { interval_minutes: 60, cron: null, cron_tz: null };
const berlin = { interval_minutes: null, cron: "0 */6 * * *", cron_tz: "Europe/Berlin" };
const at = (iso: string) => new Date(iso);

describe("firstCheckAt", () => {
  it("checks a new interval subscription at once", () => {
    const now = at("2026-11-23T10:00:00Z");
    expect(firstCheckAt(hourly, null, now)).toEqual(now);
  });

  it("counts an interval from the last check, never earlier than now", () => {
    const now = at("2026-11-23T10:00:00Z");
    expect(firstCheckAt(hourly, at("2026-11-23T09:30:00Z"), now)).toEqual(
      at("2026-11-23T10:30:00Z"),
    );
    expect(firstCheckAt(hourly, at("2026-11-23T07:00:00Z"), now)).toEqual(now);
  });

  it("waits for a cron's next tick in its timezone", () => {
    // 10:00 UTC is 11:00 in Berlin: the next 6-hourly tick is 12:00 Berlin, 11:00 UTC.
    expect(firstCheckAt(berlin, null, at("2026-11-23T10:00:00Z"))).toEqual(
      at("2026-11-23T11:00:00Z"),
    );
  });
});

describe("nextCheckAfter", () => {
  it("moves an interval on from its due time, skipping runs missed meanwhile", () => {
    const due = at("2026-11-23T10:00:00Z");
    expect(nextCheckAfter(hourly, due, at("2026-11-23T10:00:05Z"))).toEqual(
      at("2026-11-23T11:00:00Z"),
    );
    expect(nextCheckAfter(hourly, due, at("2026-11-23T13:20:00Z"))).toEqual(
      at("2026-11-23T14:00:00Z"),
    );
  });

  it("moves a cron to its next tick after now", () => {
    expect(nextCheckAfter(berlin, at("2026-11-23T11:00:00Z"), at("2026-11-23T11:00:01Z"))).toEqual(
      at("2026-11-23T17:00:00Z"),
    );
  });
});
