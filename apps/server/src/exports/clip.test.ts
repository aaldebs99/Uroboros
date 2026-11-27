import { describe, expect, it } from "vitest";
import { ApiError } from "../api/errors.ts";
import { remapChapters } from "./cuts.ts";
import {
  checkClip,
  clipCuts,
  clipFileLabel,
  clipLabel,
  clipTitle,
  copyFilename,
  readyBody,
} from "./clip.ts";

describe("checkClip", () => {
  it("keeps a range inside the file, rounded to milliseconds", () => {
    expect(checkClip({ start: 62.12349, end: 90.5 }, 600)).toEqual({ start: 62.123, end: 90.5 });
  });

  it("ends a range a hair past the file's end at the end, as players and probes differ by a frame", () => {
    expect(checkClip({ start: 590, end: 600.5 }, 600)).toEqual({ start: 590, end: 600 });
  });

  it.each([
    ["one well past the end", { start: 590, end: 602 }, 600],
    ["one that starts at the end", { start: 600, end: 600.9 }, 600],
    ["one of a file whose length isn't known", { start: 0, end: 10 }, null],
  ])("refuses %s", (_name, range, duration) => {
    expect(() => checkClip(range, duration)).toThrow(ApiError);
  });
});

describe("clipCuts", () => {
  it("cuts what comes before and after a clip in the middle", () => {
    expect(clipCuts({ start: 62, end: 90 }, 600)).toEqual([
      { start: 0, end: 62 },
      { start: 90, end: 600 },
    ]);
  });

  it("cuts only the end of a clip from the start, and only the start of one to the end", () => {
    expect(clipCuts({ start: 0, end: 90 }, 600)).toEqual([{ start: 90, end: 600 }]);
    expect(clipCuts({ start: 62, end: 600 }, 600)).toEqual([{ start: 0, end: 62 }]);
  });

  it("puts the chapters a clip overlaps on its timeline", () => {
    const chapters = [
      { start: 0, end: 60, title: "Intro" },
      { start: 60, end: 120, title: "Middle" },
      { start: 120, end: 600, title: "End" },
    ];
    expect(remapChapters(chapters, clipCuts({ start: 50, end: 130 }, 600), 600)).toEqual([
      { start: 0, end: 10, title: "Intro" },
      { start: 10, end: 70, title: "Middle" },
      { start: 70, end: 80, title: "End" },
    ]);
  });
});

describe("a clip's names", () => {
  it("shows a range as minutes and seconds, with hours from an hour", () => {
    expect(clipLabel({ start: 62, end: 90.4 })).toBe("1:02–1:30");
    expect(clipLabel({ start: 3599.6, end: 3725 })).toBe("1:00:00–1:02:05");
  });

  it("names a clip's file without a colon, which Windows and macOS don't take", () => {
    expect(clipFileLabel({ start: 62, end: 90 })).toBe("1m02s–1m30s");
    expect(clipFileLabel({ start: 3600, end: 3725 })).toBe("1h00m00s–1h02m05s");
    expect(
      copyFilename({ title: "Trip", video_id: "v", format: "mp4", clip_start: 62, clip_end: 90 }),
    ).toBe("Trip (clip 1m02s–1m30s).mp4");
    expect(
      copyFilename({
        title: "Trip",
        video_id: "v",
        format: "mp4",
        clip_start: null,
        clip_end: null,
      }),
    ).toBe("Trip (no sponsors).mp4");
  });

  it("titles a clip and says when it is ready", () => {
    expect(clipTitle("Trip", { start: 62, end: 90 })).toBe("Trip (clip 1:02–1:30)");
    expect(readyBody("Trip", { start: 62, end: 90 })).toBe("A clip of Trip (1:02–1:30)");
    expect(readyBody("Trip", null)).toBe("Trip, without its sponsor segments");
  });
});
