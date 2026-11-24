import { DownloadRequest, QueueSelectionResult } from "@uroboros/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn, type SignedIn } from "../../test/auth.ts";
import { downloadHarness, post, seededDefault } from "../../test/downloads.ts";
import { TestDb } from "../../test/testDb.ts";
import { youtubeSearchUrl } from "./requests.ts";

let testDb: TestDb;
let h: Awaited<ReturnType<typeof downloadHarness>>;
let alice: SignedIn;

beforeAll(async () => {
  testDb = await TestDb.create();
  h = await downloadHarness(testDb.db);
  alice = await signedIn(testDb.db, { username: "salice" });
});
afterAll(async () => {
  await h.close();
  await testDb.close();
});

const result = (id: string) => ({
  id,
  extractor: "Youtube",
  url: `https://www.youtube.com/watch?v=${id}`,
  title: `Result ${id}`,
  duration: 60,
  uploader: "Blender Studio",
  thumbnailUrl: null,
});

/** A search the worker has listed. */
async function listed(ids: string[]): Promise<string> {
  const p = await seededDefault(testDb.db);
  const row = await testDb.db
    .insertInto("download_requests")
    .values({
      user_id: alice.userId,
      url: youtubeSearchUrl("blender"),
      profile_id: p.id,
      intent: "search",
      state: "choosing",
      kind: "playlist",
      title: "blender",
      entries: JSON.stringify([
        { name: "YouTube", ticked: false, truncated: false, entries: ids.map(result) },
      ]),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

describe("POST /api/downloads/search", () => {
  it("asks a worker to list YouTube's results page for the search, videos only", async () => {
    const res = await post(h.app(alice), "/api/downloads/search", {
      query: " blender open movie ",
    });
    expect(res.status).toBe(202);
    const req = DownloadRequest.parse(await res.json());
    expect(req).toMatchObject({ state: "probing", groups: [] });
    expect(req.url).toBe(
      "https://www.youtube.com/results?search_query=blender+open+movie&sp=EgIQAQ%3D%3D",
    );
    const row = await testDb.db
      .selectFrom("download_requests")
      .select("intent")
      .where("id", "=", req.id)
      .executeTakeFirstOrThrow();
    expect(row.intent).toBe("search");
    expect(await h.queues.probe.getJob(`probe|${req.id}`)).toBeDefined();
  });

  it("encodes what was typed, so it can't add parameters of its own", () => {
    expect(youtubeSearchUrl("a&sp=x #1")).toBe(
      "https://www.youtube.com/results?search_query=a%26sp%3Dx+%231&sp=EgIQAQ%3D%3D",
    );
  });

  it("refuses an empty or overlong search, or one with control characters (400)", async () => {
    for (const query of ["", "   ", "x".repeat(201), "a\nb"]) {
      expect((await post(h.app(alice), "/api/downloads/search", { query })).status).toBe(400);
    }
  });
});

describe("downloading a search's results", () => {
  it("keeps the search open, so its results download one by one", async () => {
    const id = await listed(["s1", "s2"]);
    const queue = async (entryId: string) =>
      QueueSelectionResult.parse(
        await (
          await post(h.app(alice), `/api/downloads/requests/${id}/queue`, { entryIds: [entryId] })
        ).json(),
      );
    expect(await queue("s1")).toEqual({ queued: 1, skipped: 0 });
    expect(await queue("s2")).toEqual({ queued: 1, skipped: 0 });
    // Asked for again while it is still being fetched: skipped, not downloaded twice.
    expect(await queue("s1")).toEqual({ queued: 0, skipped: 1 });
    const req = DownloadRequest.parse(
      await (await h.app(alice).request(`/api/downloads/requests/${id}`)).json(),
    );
    expect(req.state).toBe("choosing");
    const downloads = await testDb.db
      .selectFrom("downloads")
      .select(["video_id", "extractor"])
      .where("request_id", "=", id)
      .orderBy("video_id")
      .execute();
    expect(downloads).toEqual([
      { video_id: "s1", extractor: "youtube" },
      { video_id: "s2", extractor: "youtube" },
    ]);
  });

  it("records no playlist for a search", async () => {
    const id = await listed(["s3"]);
    await post(h.app(alice), `/api/downloads/requests/${id}/queue`, { entryIds: ["s3"] });
    const sources = await testDb.db
      .selectFrom("user_sources")
      .select("source_id")
      .where("user_id", "=", alice.userId)
      .execute();
    expect(sources).toEqual([]);
  });
});
