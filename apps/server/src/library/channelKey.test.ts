import { describe, expect, it } from "vitest";
import { channelKey, parseChannelKey } from "./channelKey.ts";

describe("channel keys", () => {
  it("round-trips an id, falls back to the name, and is null with neither", () => {
    expect(parseChannelKey(channelKey("youtube", "UC1", "Blender") ?? "")).toEqual({
      extractor: "youtube",
      kind: "id",
      value: "UC1",
    });
    expect(parseChannelKey(channelKey("generic", null, "Some Site") ?? "")).toEqual({
      extractor: "generic",
      kind: "name",
      value: "Some Site",
    });
    expect(channelKey("generic", null, null)).toBeNull();
  });

  it("rejects anything that is not a key", () => {
    for (const bad of [
      "",
      "!!!",
      Buffer.from("[1,2]").toString("base64url"),
      Buffer.from('["a","x","b"]').toString("base64url"),
    ]) {
      expect(parseChannelKey(bad)).toBeNull();
    }
  });
});
