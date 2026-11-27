import { describe, expect, it } from "vitest";
import {
  answersClip,
  CLIP_END_SLACK,
  CLIP_MIN_SECONDS,
  ClipRange,
  Export,
  ExportBody,
  roundClip,
} from "./index.ts";

describe("clips contract", () => {
  it("takes a range of at least a second, starting at 0 or later", () => {
    expect(ClipRange.parse({ start: 62, end: 90.5 })).toEqual({ start: 62, end: 90.5 });
    expect(ClipRange.parse({ start: 0, end: CLIP_MIN_SECONDS })).toEqual({ start: 0, end: 1 });
    expect(() => ClipRange.parse({ start: 10, end: 10 })).toThrow();
    expect(() => ClipRange.parse({ start: 10, end: 5 })).toThrow();
    expect(() => ClipRange.parse({ start: -1, end: 5 })).toThrow();
    expect(() => ClipRange.parse({ start: 10, end: 10.5 })).toThrow();
  });

  it("rounds a range to milliseconds", () => {
    expect(roundClip({ start: 62.12349, end: 90.98765 })).toEqual({ start: 62.123, end: 90.988 });
  });

  it("takes a copy the server ended at the file's end, a hair before the asked end, as the clip asked", () => {
    const asked = { start: 10, end: 24.04 };
    // A clip copy cuts what lies before its start and after its end: only the start, once it runs to the end.
    const copy = (start: number, end: number, cutSeconds: number) => ({
      clip: { start, end },
      cutSeconds,
    });
    expect(answersClip(asked, copy(10, 24.04, 10))).toBe(true);
    expect(answersClip(asked, copy(10, 24.04, 10.5))).toBe(true);
    // The player's length was a frame past the file's, so the server ended it at the file's end.
    expect(answersClip(asked, copy(10, 24, 10))).toBe(true);
    expect(answersClip(asked, copy(10, 24.04 - CLIP_END_SLACK, 10))).toBe(true);
    // A shorter clip that stops before the end is another clip.
    expect(answersClip(asked, copy(10, 23.04, 10.96))).toBe(false);
    expect(answersClip(asked, copy(10, 23, 10))).toBe(false);
    expect(answersClip(asked, copy(10, 25, 10))).toBe(false);
    expect(answersClip(asked, copy(10.5, 24.04, 10.5))).toBe(false);
    // An older server makes a copy without sponsors instead.
    expect(answersClip(asked, { clip: null, cutSeconds: 3 })).toBe(false);
  });

  it("asks for a copy with or without a clip", () => {
    expect(ExportBody.parse({})).toEqual({});
    expect(ExportBody.parse({ clip: { start: 1, end: 3 } })).toEqual({
      clip: { start: 1, end: 3 },
    });
  });

  it("reads a copy from an older server, which makes no clips, as no clip", () => {
    const copy = {
      id: "0190a3f2-7c1e-7000-8000-000000000001",
      entryId: "0190a3f2-7c1e-7000-8000-000000000002",
      title: "Trip",
      state: "done",
      progress: null,
      encoder: "libx264",
      error: null,
      sizeBytes: 10,
      keptSeconds: 5,
      cutSeconds: 1,
      createdAt: "2026-11-26T10:00:00.000Z",
      fileUrl: "/api/exports/0190a3f2-7c1e-7000-8000-000000000001/file",
      current: true,
    };
    expect(Export.parse(copy).clip).toBeNull();
  });
});
