import { describe, expect, it } from "vitest";
import { LibraryEntry, LibraryPage, TagsBody } from "./index.ts";

describe("library contract", () => {
  it("normalizes tags and limits them", () => {
    expect(TagsBody.parse({ tags: ["  Music ", "LIVE"] })).toEqual({ tags: ["music", "live"] });
    expect(() =>
      TagsBody.parse({ tags: Array.from({ length: 21 }, (_, i) => `t${String(i)}`) }),
    ).toThrow();
    expect(() => TagsBody.parse({ tags: ["x".repeat(33)] })).toThrow();
    expect(() => TagsBody.parse({ tags: ["   "] })).toThrow();
  });

  it("parses a page", () => {
    expect(LibraryPage.parse({ entries: [], nextCursor: null })).toEqual({
      entries: [],
      nextCursor: null,
    });
  });

  it("reads an entry from a replica that doesn't say whether its subscription has retention as having it", () => {
    const entry = {
      id: "0190a3f2-7c1e-7000-8000-000000000001",
      mediaId: "0190a3f2-7c1e-7000-8000-000000000002",
      title: "Big Buck Bunny",
      channel: "Blender",
      uploadDate: null,
      duration: null,
      thumbnailUrl: null,
      previewUrl: null,
      hasVideo: true,
      profileName: null,
      origin: "download",
      sizeBytes: 1,
      container: "mp4",
      addedAt: "2026-11-26T00:00:00.000Z",
      progress: null,
      tags: [],
      kept: false,
      subscription: { id: "0190a3f2-7c1e-7000-8000-0000000000aa", title: "Blender" },
      channelKey: null,
    };
    // Keep shows, as it did before replicas said.
    expect(LibraryEntry.parse(entry).subscription?.hasRetention).toBe(true);
  });
});
