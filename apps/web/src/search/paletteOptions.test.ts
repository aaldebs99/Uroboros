import { describe, expect, it } from "vitest";

import { asLink, paletteSections } from "./paletteOptions";

describe("asLink", () => {
  it("takes a trimmed http(s) link, and leaves words (even with a colon) to the search", () => {
    expect(asLink("  https://youtu.be/aqz-KE-bpKQ ")).toBe("https://youtu.be/aqz-KE-bpKQ");
    expect(asLink("HTTP://example.com/a")).toBe("HTTP://example.com/a");
    expect(asLink("blender open movie")).toBeNull();
    expect(asLink("https://")).toBeNull();
    expect(asLink("https://a b")).toBeNull();
    expect(asLink("ftp://example.com/a")).toBeNull();
    expect(asLink("note: https://example.com")).toBeNull();
  });
});

describe("paletteSections", () => {
  const base = { found: [], results: null, searching: false };
  const kinds = (typed: string, over: Partial<Parameters<typeof paletteSections>[0]> = {}) =>
    paletteSections({ ...base, typed, ...over }).map((s) => [
      s.label,
      s.options.map((o) => o.kind),
    ]);

  it("offers nothing before anything is typed", () => {
    expect(kinds("")).toEqual([]);
  });

  it("offers YouTube for words the library doesn't have, until that search is under way", () => {
    expect(kinds("spring")).toEqual([[null, ["youtube"]]]);
    expect(kinds("spring", { searching: true })).toEqual([]);
  });

  it("waits for the library before offering anything for a link", () => {
    expect(kinds("https://youtu.be/x", { found: undefined })).toEqual([]);
    expect(kinds("https://youtu.be/x")).toEqual([[null, ["download", "format"]]]);
  });
});
