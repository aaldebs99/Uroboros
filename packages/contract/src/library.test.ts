import { describe, expect, it } from "vitest";
import { LibraryPage, TagsBody } from "./index.ts";

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
});
