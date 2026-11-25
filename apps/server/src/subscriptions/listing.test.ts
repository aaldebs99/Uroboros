import { fixture } from "@uroboros/ytdlp/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { listFeed } from "./listing.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;

beforeAll(async () => {
  t = await TestDb.create();
  h = await workerHarness(t.db);
});
afterAll(async () => {
  await h.close();
  await t.close();
});

describe("listFeed", () => {
  it("ties the ids of a page yt-dlp has no extractor for to each video's link", async () => {
    const listing = JSON.parse(await fixture("probe-playlist.json")) as {
      entries: Record<string, unknown>[];
    };
    const stdout = JSON.stringify({
      ...listing,
      extractor_key: "Generic",
      entries: listing.entries.map((e) => ({
        ...e,
        ie_key: null,
        url: `https://evil.example/${String(e.id)}.mp4`,
      })),
    });
    const deps = await h.deps({ steps: [{ stdout }] });
    const { entries } = await listFeed(deps, {
      name: "Videos",
      url: "https://evil.example/feed.html",
    });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.extractor).toBe("generic");
      expect(e.videoId).toMatch(/~[0-9a-f]{16}$/);
    }
  });
});
