import { describe, expect, it } from "vitest";
import { CancelledBatch, DownloadBatch } from "./index.ts";

describe("download batches", () => {
  it("parses a queued playlist's counts and a cancel's answer", () => {
    const batch = {
      id: "0b9c8f4e-8f7e-4a43-9b1f-2a6f1d6b1c11",
      url: "https://www.youtube.com/playlist?list=PL1",
      title: "Blender - Videos",
      kind: "playlist",
      waiting: 431,
      done: 17,
      failed: 2,
    };
    expect(DownloadBatch.parse(batch)).toEqual(batch);
    expect(DownloadBatch.safeParse({ ...batch, kind: "video" }).success).toBe(false);
    expect(CancelledBatch.parse({ cancelled: 431 })).toEqual({ cancelled: 431 });
  });
});
