import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededDefault } from "../../test/downloads.ts";
import { insertSubscription } from "../../test/listings.ts";
import { TestDb } from "../../test/testDb.ts";
import { insertUser } from "../../test/users.ts";
import { listItems } from "./items.ts";

let t: TestDb;
let userId: string;
let profileId: string;

beforeAll(async () => {
  t = await TestDb.create();
  userId = await insertUser(t.db, { username: "items-alice" });
  profileId = (await seededDefault(t.db)).id;
});
afterAll(async () => {
  await t.close();
});

/** One of the person's downloads for the subscription, in `state`. */
async function download(subscriptionId: string, state: "running" | "failed" | "done") {
  const v = randomUUID();
  const row = await t.db
    .insertInto("downloads")
    .values({
      user_id: userId,
      profile_id: profileId,
      profile_revision: "rev",
      args: JSON.stringify({}),
      extractor: "youtube",
      video_id: v,
      url: `https://www.youtube.com/watch?v=${v}`,
      fetch_key: `fetch|youtube|${v}|p|rev`,
      subscription_id: subscriptionId,
      state,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

describe("listItems", () => {
  it("says how each queued video's download is doing, not only that it was queued", async () => {
    const sub = await insertSubscription(t.db, {
      userId,
      profileId,
      feeds: [{ name: "Videos", url: "https://www.youtube.com/@BlenderOfficial/videos" }],
      sourceId: `UC${randomUUID()}`,
    });
    for (const [videoId, downloadId] of [
      ["a-running", await download(sub, "running")],
      ["b-failed", await download(sub, "failed")],
      ["c-done", await download(sub, "done")],
      ["d-filtered", null],
    ] as const) {
      await t.db
        .insertInto("subscription_items")
        .values({
          subscription_id: sub,
          extractor: "youtube",
          video_id: videoId,
          url: "u",
          outcome: downloadId === null ? "filtered" : "queued",
          download_id: downloadId,
        })
        .execute();
    }
    const page = await listItems(t.db, userId, sub, undefined);
    expect(
      page.items
        .map((i) => [i.videoId, i.outcome, i.downloadState])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      ["a-running", "queued", "running"],
      ["b-failed", "queued", "failed"],
      ["c-done", "queued", "done"],
      ["d-filtered", "filtered", null],
    ]);
  });
});
