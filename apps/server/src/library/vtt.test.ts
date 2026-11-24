import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseVtt, type CaptionSegment } from "./vtt.ts";

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../test/fixtures/captions/${name}`, import.meta.url)),
    "utf8",
  );

/** Each line of a segment, as its offsets cut it. */
const linesOf = (s: CaptionSegment) =>
  s.lineAt.map((at, i) => s.text.slice(at, s.lineAt[i + 1] ?? s.text.length).trim());

/** A cue of `text` from `start` to `end` seconds. */
const cue = (start: number, end: number, text: string) => {
  const t = (s: number) => {
    const ms = Math.round(s * 1000);
    const hh = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
    const mm = String(Math.floor(ms / 60_000) % 60).padStart(2, "0");
    const ss = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}.${String(ms % 1000).padStart(3, "0")}`;
  };
  return `${t(start)} --> ${t(end)}\n${text}\n`;
};
const vtt = (...cues: string[]) => `WEBVTT\n\n${cues.join("\n")}`;

describe("parseVtt", () => {
  it("reads YouTube's rolling auto captions once each, timed from the cue that brought them", () => {
    const segments = parseVtt(fixture("youtube-auto.vtt"));
    expect(segments).toEqual([
      {
        start: 0.16,
        // The second line stays on screen through the repeat cues, until 8 s.
        end: 8,
        text: "hello everyone and welcome to the channel",
        lineAt: [0, 27],
        lineStart: [0.16, 2.879],
      },
      {
        // A gap of 5 s or more starts a new segment.
        start: 15.12,
        end: 19.99,
        text: "today we talk about dragons and their hoards",
        lineAt: [0, 28],
        lineStart: [15.12, 17.36],
      },
    ]);
  });

  it("skips the header, styles, regions and notes, and cleans tags and entities", () => {
    const segments = parseVtt(fixture("manual.vtt"));
    expect(segments.map((s) => s.text)).toEqual([
      "We are in New York City Fish & chips <3 'n’ more here second line",
      // A minute later: ♪ lines and [LAUGHTER] carry no words.
      "Back again",
    ]);
    const [first] = segments;
    expect(first?.start).toBe(1);
    expect(first?.end).toBe(6.25);
    expect(first?.lineStart).toEqual([1, 3.5, 3.5]);
    expect(first === undefined ? [] : linesOf(first)).toEqual([
      "We are in New York City",
      "Fish & chips <3 'n’ more here",
      "second line",
    ]);
    expect(segments[1]?.start).toBe(64);
  });

  it("reads timings without hours, as ffmpeg writes them", () => {
    expect(parseVtt(fixture("ffmpeg.vtt"))).toEqual([
      {
        start: 1,
        end: 4,
        text: "Converted from SubRip with short timings",
        lineAt: [0, 22],
        lineStart: [1, 2.5],
      },
      { start: 3723, end: 3725, text: "and hours later", lineAt: [0], lineStart: [3723] },
    ]);
  });

  it("finds nothing in a file that is not captions, and never throws", () => {
    expect(parseVtt(fixture("garbage.vtt"))).toEqual([]);
    expect(parseVtt("")).toEqual([]);
    expect(parseVtt("WEBVTT")).toEqual([]);
    expect(parseVtt(vtt("00:00:02.000 --> 00:00:01.000\n&#xD800;&#99999999;&bogus; ok"))).toEqual([
      // An end before the start is clamped to it; invalid code points are dropped.
      { start: 2, end: 2, text: "&bogus; ok", lineAt: [0], lineStart: [2] },
    ]);
  });

  it("closes a segment before it passes 240 characters or 30 seconds", () => {
    const long = parseVtt(vtt(cue(0, 1, "a".repeat(200)), cue(1, 2, "b".repeat(50))));
    expect(long.map((s) => s.text.length)).toEqual([200, 50]);
    const slow = parseVtt(
      vtt(...Array.from({ length: 9 }, (_, i) => cue(i * 4, i * 4 + 4, `c${String(i)}`))),
    );
    // c8 starts 32 s after the segment began.
    expect(slow.map((s) => s.text)).toEqual(["c0 c1 c2 c3 c4 c5 c6 c7", "c8"]);
  });

  it("splits a line over 400 characters at word boundaries, keeping characters whole", () => {
    const word = "\u{1F409}dragon";
    const line = Array.from({ length: 80 }, () => word).join(" ");
    const segments = parseVtt(vtt(cue(5, 9, line)));
    expect(segments.length).toBeGreaterThan(1);
    for (const s of segments) {
      expect(Array.from(s.text).length).toBeLessThanOrEqual(400);
      expect(s.text.split(" ").every((w) => w === word)).toBe(true);
      expect(s.start).toBe(5);
    }
    expect(segments.map((s) => s.text).join(" ")).toBe(line);
  });

  it("stops at the segment cap", () => {
    const cues = Array.from({ length: 20 }, (_, i) => cue(i * 10, i * 10 + 1, `line ${String(i)}`));
    expect(parseVtt(vtt(...cues), 3).map((s) => s.text)).toEqual(["line 0", "line 1", "line 2"]);
  });
});
