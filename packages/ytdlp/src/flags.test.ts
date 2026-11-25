import { describe, expect, it } from "vitest";
import { YtDlpError } from "./errors.ts";
import { ALLOWED_FLAGS, normalizeExtraArgs } from "./flags.ts";

function refusal(args: readonly string[]): string | null {
  try {
    normalizeExtraArgs(args);
    return null;
  } catch (error) {
    if (error instanceof YtDlpError && error.kind === "invalid_arguments") return error.message;
    throw error;
  }
}

describe("normalizeExtraArgs", () => {
  it("accepts the three spellings and the exact short aliases, in canonical form", () => {
    expect(
      normalizeExtraArgs([
        "-x",
        "--audio-format",
        "opus",
        "--limit-rate=1M",
        "-I",
        "1:3,7",
        "--sub-langs=en.*,ja",
        "--embed-chapters",
        "--match-filters",
        "duration > 60 & !is_live",
        "--sponsorblock-remove=sponsor,selfpromo",
        "--remux-video",
        "aac>m4a/mov>mp4/mkv",
        "--dateafter=today-2weeks",
        "--retries",
        "10",
      ]),
    ).toEqual([
      "--extract-audio",
      "--audio-format=opus",
      "--limit-rate=1M",
      "--playlist-items=1:3,7",
      "--sub-langs=en.*,ja",
      "--embed-chapters",
      "--match-filters=duration > 60 & !is_live",
      "--sponsorblock-remove=sponsor,selfpromo",
      "--remux-video=aac>m4a/mov>mp4/mkv",
      "--dateafter=today-2weeks",
      "--retries=10",
    ]);
    expect(normalizeExtraArgs([])).toEqual([]);
  });

  it("takes one extractor argument only: skipping YouTube's machine-translated subtitles", () => {
    expect(normalizeExtraArgs(["--extractor-args", "youtube:skip=translated_subs"])).toEqual([
      "--extractor-args=youtube:skip=translated_subs",
    ]);
  });

  it("keeps a value that starts with a dash glued to its flag", () => {
    expect(normalizeExtraArgs(["--download-sections", "-5:00-inf"])).toEqual([
      "--download-sections=-5:00-inf",
    ]);
  });

  it.each([
    // Shortened long options, which yt-dlp itself would expand.
    ["--exe", "id"],
    ["--extract-audi"],
    ["--limit-rat=1M"],
    // Bundled or unknown short options.
    ["-xk"],
    ["-ia", "urls.txt"],
    ["-o", "/etc/x"],
    ["-a"],
    ["-U"],
    // Options that run programs, reach files or the network, or replace the wrapper's own.
    ["--exec", "id"],
    ["--exec=id"],
    ["--use-postprocessor=Exec:exec_cmd=id"],
    ["--downloader=/bin/sh"],
    ["--downloader-args", "curl:-o /etc/x"],
    ["--external-downloader", "aria2c"],
    ["--ffmpeg-location", "/tmp/evil"],
    ["--postprocessor-args", "ffmpeg:-i /etc/passwd"],
    ["--js-runtimes", "node:/tmp/evil"],
    ["--alias", "x", "--exec id"],
    ["--output", "../../x"],
    ["--paths", "/"],
    ["--cookies", "/etc/shadow"],
    ["--cookies-from-browser", "firefox"],
    ["--download-archive", "/tmp/a"],
    ["--enable-file-urls"],
    ["--proxy", "socks5://evil:1080"],
    ["--config-location", "/tmp/c"],
    ["--batch-file", "/tmp/b"],
    ["--plugin-dirs", "/tmp/p"],
    ["--netrc-cmd", "id"],
    ["--update"],
    ["--no-check-certificates"],
    ["--extractor-args", "youtube:player_client=web"],
    ["--skip-download"],
    // A positional argument (a second URL) or the end-of-options marker.
    ["https://evil.example/"],
    ["--"],
    ["--embed-subs", "--", "https://evil.example/"],
  ])("refuses %j", (...args: string[]) => {
    expect(refusal(args)).not.toBeNull();
  });

  it("refuses malformed values", () => {
    for (const args of [
      ["--embed-subs=yes"],
      ["--audio-format"],
      ["--audio-format=../x"],
      ["--limit-rate=1M;id"],
      ["--concurrent-fragments=64"],
      ["--audio-quality=11"],
      ["--playlist-items", "1; id"],
      ["--match-filters", "duration > 60\n--exec id"],
      ["--match-filters="],
      ["--remove-chapters", "x".repeat(201)],
      ["--merge-output-format", "MP4"],
    ]) {
      expect(refusal(args), JSON.stringify(args)).not.toBeNull();
    }
  });

  it("bounds the flags that pace a download, so no profile holds a download slot for hours", () => {
    for (const args of [
      ["--limit-rate=1"],
      ["--limit-rate=99K"],
      ["-r", "50K"],
      ["--retries=infinite"],
      ["-R", "51"],
      ["--fragment-retries=infinite"],
      ["--extractor-retries=999"],
      ["--sleep-interval=301"],
      ["--max-sleep-interval=999999999"],
      ["--sleep-requests=1000"],
      ["--sleep-subtitles=300.5"],
      ["--socket-timeout=3600"],
    ]) {
      expect(refusal(args), JSON.stringify(args)).toMatch(/out of range/);
    }
    expect(
      normalizeExtraArgs([
        "--limit-rate=100K",
        "-r",
        "2.5M",
        "-R",
        "50",
        "--fragment-retries=0",
        "--sleep-interval=300",
        "--max-sleep-interval=5.5",
        "--socket-timeout=30",
      ]),
    ).toEqual([
      "--limit-rate=100K",
      "--limit-rate=2.5M",
      "--retries=50",
      "--fragment-retries=0",
      "--sleep-interval=300",
      "--max-sleep-interval=5.5",
      "--socket-timeout=30",
    ]);
  });

  it("refuses --throttled-rate, whose re-extraction loop sleeps again on every pass", () => {
    expect(refusal(["--throttled-rate=100K"])).toBe("not an allowed flag: --throttled-rate=100K");
  });

  it("names the offending token", () => {
    expect(refusal(["--embed-subs", "--exe", "id"])).toBe("not an allowed flag: --exe");
  });

  it("does not treat inherited object keys as flags", () => {
    expect(refusal(["--constructor"])).not.toBeNull();
    expect(refusal(["--__proto__"])).not.toBeNull();
    expect(ALLOWED_FLAGS).not.toContain("constructor");
  });
});
