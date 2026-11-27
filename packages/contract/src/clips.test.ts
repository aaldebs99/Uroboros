import { describe, expect, it } from "vitest";
import { CLIP_MIN_SECONDS, ClipRange, Export, ExportBody, roundClip } from "./index.ts";

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
