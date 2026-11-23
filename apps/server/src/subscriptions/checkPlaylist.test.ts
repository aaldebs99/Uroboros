import type { Scenario } from "@uroboros/ytdlp/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedIn } from "../../test/auth.ts";
import { seededDefault } from "../../test/downloads.ts";
import { listing, type ListedVideo } from "../../test/listings.ts";
import { TestDb } from "../../test/testDb.ts";
import { workerHarness } from "../../test/workerDeps.ts";
import { checkProcessor } from "./check.ts";

let t: TestDb;
let h: Awaited<ReturnType<typeof workerHarness>>;
let profileId: string;

beforeAll(async () => {
  t = await TestDb.create();
  h = await workerHarness(t.db, 1000);
  profileId = (await seededDefault(t.db)).id;
});
afterAll(async () => {
  await h.close();
  await t.close();
});

const playlistUrl = "https://www.youtube.com/playlist?list=PLfollowed";
const channelVideos = "https://www.youtube.com/@BlenderOfficial/videos";
let n = 0;

async function follow(kind: "channel" | "playlist", url: string, sourceId: string) {
  const u = await signedIn(t.db, { username: `cp${String(++n)}` });
  const feeds = [{ name: kind === "playlist" ? "Playlist" : "Videos", url }];
  const row = await t.db
    .insertInto("subscriptions")
    .values({
      user_id: u.userId,
      kind,
      extractor: "youtube",
      source_id: sourceId,
      title: "Followed",
      url,
      feeds: JSON.stringify(feeds),
      tabs: JSON.stringify(feeds),
      profile_id: profileId,
      interval_minutes: 360,
      backfill: "none",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { userId: u.userId, id: row.id };
}

async function check(id: string, scenario: Scenario) {
  const deps = await h.deps(scenario);
  await checkProcessor(deps)({ data: { subscriptionId: id } });
}

const ids = (...names: string[]): ListedVideo[] => names.map((id) => ({ id }));

async function recorded(userId: string, sourceId: string) {
  const source = await t.db
    .selectFrom("sources as s")
    .innerJoin("user_sources as us", "us.source_id", "s.id")
    .select(["s.id", "s.title", "s.url"])
    .where("s.source_id", "=", sourceId)
    .where("us.user_id", "=", userId)
    .executeTakeFirst();
  if (source === undefined) return null;
  const items = await t.db
    .selectFrom("source_items")
    .select(["video_id", "position"])
    .where("source_id", "=", source.id)
    .orderBy("position")
    .execute();
  return { ...source, items: items.map((i) => [i.video_id, i.position]) };
}

describe("a subscription's check records the playlist it follows", () => {
  it("a playlist subscription's check records the playlist for its owner", async () => {
    const sub = await follow("playlist", playlistUrl, "PLrec1");
    await check(sub.id, { steps: [{ stdout: listing(playlistUrl, ids("a1", "a2", "a3")) }] });
    expect(await recorded(sub.userId, "PLrec1")).toMatchObject({
      title: "Followed",
      url: playlistUrl,
      items: [
        ["a1", 0],
        ["a2", 1],
        ["a3", 2],
      ],
    });
  });

  it("a later check moves positions and keeps unlisted items", async () => {
    const sub = await follow("playlist", playlistUrl, "PLrec2");
    await check(sub.id, { steps: [{ stdout: listing(playlistUrl, ids("b1", "b2", "b3")) }] });
    await check(sub.id, { steps: [{ stdout: listing(playlistUrl, ids("b0", "b2", "b1")) }] });
    expect((await recorded(sub.userId, "PLrec2"))?.items).toEqual([
      ["b0", 0],
      ["b2", 1],
      ["b1", 2],
      ["b3", 2],
    ]);
  });

  it("a channel subscription records no playlist", async () => {
    const sub = await follow("channel", channelVideos, "UCrec3");
    await check(sub.id, { steps: [{ stdout: listing(channelVideos, ids("c1")) }] });
    expect(await recorded(sub.userId, "UCrec3")).toBeNull();
    const any = await t.db
      .selectFrom("user_sources")
      .select("source_id")
      .where("user_id", "=", sub.userId)
      .execute();
    expect(any).toEqual([]);
  });
});
