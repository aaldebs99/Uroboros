import type { ChannelSummary } from "@uroboros/contract";
import { describe, expect, it } from "vitest";
import { channelKey } from "./channelKey.ts";
import { pickChannel } from "./ownDetails.ts";

/** Which of a person's channels a typed name joins (docs/library.md#your-own-details). */

const channel = (
  name: string,
  extractor: string,
  id: string | null,
  count = 1,
): ChannelSummary => ({
  key: channelKey(extractor, id, name) ?? "",
  name,
  extractor,
  count,
  latestUpload: null,
  coverThumbnailUrl: null,
  hideFromLibrary: false,
});

describe("pickChannel", () => {
  it("finds a channel by its name in any case, and none of another name", () => {
    const news = channel("News", "youtube", "UC1");
    expect(pickChannel("news", "youtube", [news])).toBe(news);
    expect(pickChannel("Sports", "youtube", [news])).toBeNull();
  });

  it("prefers the exact name, then the video's own site, then a site's id, then the bigger", () => {
    const lower = channel("news", "vimeo", null, 9);
    const exact = channel("News", "vimeo", null);
    expect(pickChannel("News", "youtube", [lower, exact])).toBe(exact);
    const elsewhere = channel("News", "vimeo", "V1", 9);
    const own = channel("News", "youtube", null);
    expect(pickChannel("News", "youtube", [elsewhere, own])).toBe(own);
    const byName = channel("News", "youtube", null, 9);
    const byId = channel("News", "youtube", "UC1");
    expect(pickChannel("News", "youtube", [byName, byId])).toBe(byId);
    const small = channel("News", "youtube", "UC1", 1);
    const big = channel("News", "youtube", "UC2", 5);
    expect(pickChannel("News", "youtube", [small, big])).toBe(big);
  });

  it("settles a full tie by key, whatever the order given", () => {
    const a = channel("News", "youtube", "UC-a");
    const b = channel("News", "youtube", "UC-b");
    const first = [a, b].sort((x, y) => x.key.localeCompare(y.key))[0];
    expect(pickChannel("News", "youtube", [a, b])).toBe(first);
    expect(pickChannel("News", "youtube", [b, a])).toBe(first);
  });
});
