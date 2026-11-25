import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordingLogger } from "../../test/apiConfig.ts";
import { periodicDuty } from "./periodic.ts";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("periodicDuty", () => {
  it("runs a pass at once and then on time, until leadership ends", async () => {
    let passes = 0;
    const stop = new AbortController();
    const { logger } = recordingLogger();
    const duty = periodicDuty("test", 1000, () => Promise.resolve(++passes), logger)(stop.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(passes).toBe(1);
    await vi.advanceTimersByTimeAsync(2999);
    expect(passes).toBe(3);
    stop.abort();
    await duty;
    await vi.advanceTimersByTimeAsync(5000);
    expect(passes).toBe(3);
  });

  it("logs a failed pass and runs the next on time", async () => {
    let passes = 0;
    const stop = new AbortController();
    const { logger, lines } = recordingLogger();
    const duty = periodicDuty(
      "flaky",
      1000,
      () => (++passes === 1 ? Promise.reject(new Error("database away")) : Promise.resolve()),
      logger,
    )(stop.signal);
    await vi.advanceTimersByTimeAsync(1000);
    expect(passes).toBe(2);
    expect(lines).toContainEqual(
      expect.objectContaining({ duty: "flaky", msg: "a leader duty failed" }),
    );
    stop.abort();
    await duty;
  });

  it("ends after the first pass when leadership ended during it", async () => {
    let passes = 0;
    const stop = new AbortController();
    const { logger } = recordingLogger();
    const duty = periodicDuty(
      "short",
      1000,
      () => {
        passes++;
        stop.abort();
        return Promise.resolve();
      },
      logger,
    )(stop.signal);
    await duty;
    await vi.advanceTimersByTimeAsync(5000);
    expect(passes).toBe(1);
  });
});
