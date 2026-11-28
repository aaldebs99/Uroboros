import { describe, expect, it } from "vitest";
import { cooldownHintMs, type YtDlpError } from "./errors.ts";
import { checkRun } from "./process.ts";

const YOUTUBE_LIMIT =
  "ERROR: [youtube] dQw4w9WgXcQ: Video unavailable. This content isn't available, try again later. " +
  "The current session has been rate-limited by YouTube for up to an hour. It is recommended to use " +
  "`-t sleep` to add a delay between video requests to avoid exceeding the rate limit.";

describe("cooldownHintMs", () => {
  it("reads how long a site says to wait", () => {
    expect(cooldownHintMs([YOUTUBE_LIMIT])).toBe(3_600_000);
    expect(cooldownHintMs(["ERROR: [x] Rate limit exceeded. Try again in 30 seconds."])).toBe(
      30_000,
    );
    expect(cooldownHintMs(["ERROR: too many requests, retry after 5 minutes"])).toBe(300_000);
    expect(cooldownHintMs(["ERROR: [x] limited (up to 15 minutes)"])).toBe(900_000);
    expect(cooldownHintMs(["ERROR: HTTP Error 429: Too Many Requests (Retry-After: 120)"])).toBe(
      120_000,
    );
    expect(cooldownHintMs(["ERROR: please wait 2 hours before trying again"])).toBe(7_200_000);
  });

  it("has none when the site gives no time", () => {
    expect(
      cooldownHintMs([
        "ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests",
      ]),
    ).toBeNull();
    expect(cooldownHintMs(["ERROR: [damtomo] You are rate-limited. Try again later."])).toBeNull();
    expect(cooldownHintMs([])).toBeNull();
  });

  it("keeps a hint between a second and six hours", () => {
    expect(cooldownHintMs(["ERROR: try again in 0 seconds"])).toBe(1000);
    expect(cooldownHintMs(["ERROR: try again in 48 hours"])).toBe(6 * 3_600_000);
  });

  it("prefers the error line over the warnings before it", () => {
    expect(
      cooldownHintMs(["WARNING: retry after 9 minutes", "ERROR: try again in 2 minutes"]),
    ).toBe(120_000);
  });
});

describe("a rate-limited run", () => {
  const run = (stderrTail: string[]) => {
    try {
      checkRun({ exitCode: 1, stdout: "", stderrTail, stopped: null });
    } catch (err) {
      return err as YtDlpError;
    }
    throw new Error("checkRun did not throw");
  };

  it("carries the site's cooldown on its error", () => {
    const err = run(["[youtube] Extracting URL", YOUTUBE_LIMIT]);
    expect(err.kind).toBe("rate_limited");
    expect(err.retryAfterMs).toBe(3_600_000);
  });

  it("waits out YouTube's captcha challenge as a limit, for the estimated time", () => {
    const err = run([
      "ERROR: [youtube] abc: This content isn't available, try again later. YouTube is requiring a captcha challenge before playback",
    ]);
    expect(err.kind).toBe("rate_limited");
    expect(err.retryAfterMs).toBeNull();
  });

  it("carries none without a hint, nor for other failures", () => {
    expect(run(["ERROR: HTTP Error 429: Too Many Requests"]).retryAfterMs).toBeNull();
    expect(run(["ERROR: Private video. try again in 5 minutes"]).retryAfterMs).toBeNull();
  });
});
